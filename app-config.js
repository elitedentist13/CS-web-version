// ════════════════════════════════════════════════════════════════
// app-config.js  — Configuration Module
// ════════════════════════════════════════════════════════════════
var CFG = (function () {

    // ── private state ─────────────────────────────────────────
    var _ready   = false;   // init() has wired DOM once
    var _tab     = null;    // currently active tab key

    // ── tab registry ─────────────────────────────────────────
    var TABS = [
        { key: 'clinic',    label: '🏥 Clinic Profile'   },
        { key: 'doctors',   label: '👨‍⚕️ Doctors'          },
        { key: 'payment',   label: '💳 Payment Methods'  },
        { key: 'treatment', label: '🦷 Treatment Items'  },
        // Must match index.html: data-tab="program" + pane id="cfgPane-program"
        { key: 'program',   label: '⚙️ Program Settings' },
        { key: 'users',     label: '👤 Users'            },
        { key: 'templates', label: '📄 Templates'        },
        { key: 'print',     label: '🖨️ Print'            },
        { key: 'data',      label: '💾 Data / Backup'    }
    ];

    // ════════════════════════════════════════════════════════
    // UTILITIES
    // ════════════════════════════════════════════════════════
    function g(id)  { return document.getElementById(id); }
    function esc(s) {
        return String(s || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function ctr(key) {
        return (typeof t === 'function') ? t(key) : key;
    }
    function cfgRptLbl(key) {
        return ctr('cfg.print.rpt.' + key);
    }
    function ctrRepl(key, pairs) {
        var s = ctr(key);
        if (pairs) {
            for (var p in pairs) {
                if (Object.prototype.hasOwnProperty.call(pairs, p)) {
                    s = s.replace(new RegExp('\\{' + p + '\\}', 'g'), pairs[p]);
                }
            }
        }
        return s;
    }

    // ── toast ─────────────────────────────────────────────────
    function toast(msg, isErr) {
        var t = g('cfgToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'cfgToast';
            t.style.cssText =
                'position:fixed;bottom:28px;right:28px;z-index:9999;' +
                'padding:12px 22px;border-radius:8px;font-size:14px;' +
                'color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
                'transition:opacity .4s;pointer-events:none;opacity:0;';
            document.body.appendChild(t);
        }
        t.textContent    = msg;
        t.style.background = isErr ? '#dc3545' : '#198754';
        t.style.opacity  = '1';
        clearTimeout(t._tid);
        t._tid = setTimeout(function () { t.style.opacity = '0'; }, 3000);
    }

    // -- confirm overlay -----------------------------------------------
    function confirm(msg, onYes) {
        // Remove any stale overlay first
        var old = document.getElementById('cfgConfirmOv');
        if (old) old.parentNode.removeChild(old);

        // Build a fresh overlay every call
        var ov = document.createElement('div');
        ov.id = 'cfgConfirmOv';
        ov.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.55);' +
            'z-index:99999;display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText =
            'background:#fff;border-radius:10px;padding:32px 28px;' +
            'max-width:380px;width:90%;' +
            'box-shadow:0 8px 32px rgba(0,0,0,.3);text-align:center;';

        var msgEl = document.createElement('p');
        msgEl.style.cssText = 'margin:0 0 24px;font-size:15px;color:#333;line-height:1.5;';
        msgEl.textContent = msg;

        var yesBtn = document.createElement('button');
        yesBtn.textContent = ctr('cfg.btn.delete');
        yesBtn.style.cssText =
            'background:#dc3545;color:#fff;border:none;padding:10px 28px;' +
            'border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;margin-right:12px;';

        var noBtn = document.createElement('button');
        noBtn.textContent = ctr('cfg.btn.cancel');
        noBtn.style.cssText =
            'background:#6c757d;color:#fff;border:none;padding:10px 28px;' +
            'border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;';

        function close() {
            if (ov.parentNode) ov.parentNode.removeChild(ov);
        }

        yesBtn.addEventListener('click', function () { close(); onYes(); });
        noBtn.addEventListener('click', close);
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

        box.appendChild(msgEl);
        box.appendChild(yesBtn);
        box.appendChild(noBtn);
        ov.appendChild(box);
        document.body.appendChild(ov);
    }

    // ════════════════════════════════════════════════════════
    // LAYOUT — build sidebar + pane shell (once)
    // ════════════════════════════════════════════════════════
    function buildShell() {
        var sec = g('sectionConfig');
        if (!sec) return;

        sec.innerHTML =
            '<div style="display:flex;height:100%;min-height:100vh;' +
            'background:#f4f6f9;">' +

            // back button bar
            '<div style="position:absolute;top:0;left:0;right:0;' +
            'height:52px;background:#1a1a2e;display:flex;' +
            'align-items:center;padding:0 20px;z-index:10;">' +
            '<button id="cfgBackBtn" style="background:none;border:none;' +
            'color:#fff;font-size:22px;cursor:pointer;margin-right:14px;">' +
            '&#8592;</button>' +
            '<span id="cfgPageTitle" style="color:#fff;font-size:17px;font-weight:600;">' +
            esc(ctr('cfg.navTitle')) + '</span></div>' +

            // sidebar
            '<nav id="cfgSidebar" style="width:220px;min-width:220px;' +
            'background:#1a1a2e;padding-top:64px;' +
            'box-shadow:2px 0 8px rgba(0,0,0,.15);z-index:5;">' +
            buildSidebarHTML() +
            '</nav>' +

            // content area
            '<main id="cfgMain" style="flex:1;padding:80px 32px 32px;' +
            'overflow-y:auto;">' +
            buildPanesHTML() +
            '</main>' +

            '</div>';
    }

    function buildSidebarHTML() {
        return TABS.map(function (t) {
            return '<div class="cfg-nav-item" data-tab="' + t.key + '" ' +
                'style="padding:13px 22px;cursor:pointer;color:#ccc;' +
                'font-size:14px;border-left:3px solid transparent;' +
                'transition:all .2s;user-select:none;">' +
                esc(ctr('cfg.nav.' + t.key)) + '</div>';
        }).join('');
    }

    function refreshCfgNavLabels() {
        var title = g('cfgPageTitle');
        var sidebarTitle = document.querySelector('.cfg-sidebar__title');
        if (title) title.textContent = ctr('cfg.navTitle');
        if (sidebarTitle) sidebarTitle.textContent = ctr('cfg.navTitle');
        var sidebar = g('cfgSidebar') || document.querySelector('.cfg-sidebar');
        if (!sidebar) return;
        var items = sidebar.querySelectorAll('.cfg-nav-item');
        TABS.forEach(function (tab, i) {
            if (!items[i]) return;
            if (!items[i].getAttribute('data-i18n')) {
                items[i].textContent = ctr('cfg.nav.' + tab.key);
            }
        });
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(sidebar);
    }

    /** Remove dead English fallback markup from index.html (live UI loads into #cfgPane-*). */
    function stripCfgStalePaneBodies() {
        TABS.forEach(function (t) {
            var pane = g('cfgPane-' + t.key);
            if (pane) pane.innerHTML = '';
        });
    }

    function buildPanesHTML() {
        return TABS.map(function (t) {
            return '<div id="cfgPane-' + t.key + '" class="cfg-pane" ' +
                'style="display:none;"></div>';
        }).join('');
    }

    // ════════════════════════════════════════════════════════
    // NAVIGATION
    // ════════════════════════════════════════════════════════
    function wireNav() {
        // sidebar items (using querySelectorAll on the actual nav element)
        var sidebar = document.querySelector('.cfg-sidebar');
        if (!sidebar) return;
        
        var items = sidebar.querySelectorAll('.cfg-nav-item');
        items.forEach(function (item) {
            // Remove any existing listeners by cloning
            var newItem = item.cloneNode(true);
            item.parentNode.replaceChild(newItem, item);
        });
        
        // Attach fresh listeners
        items = sidebar.querySelectorAll('.cfg-nav-item');
        items.forEach(function (item) {
            item.addEventListener('click', function () {
                var tab = this.getAttribute('data-tab');
                if (tab) switchTab(tab);
            });
        });
    }

    function switchTab(key) {
        if (!cfgTabVisible(key)) {
            if (typeof permToastDenied === 'function') permToastDenied();
            else toast(ctr('cfg.msg.adminRequired'), true);
            return;
        }
        _tab = key;

        // update sidebar highlight
        var sidebar = document.querySelector('.cfg-sidebar');
        if (sidebar) {
            sidebar.querySelectorAll('.cfg-nav-item')
            .forEach(function (item) {
                var active = item.getAttribute('data-tab') === key;
                if (active) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }

        // show correct pane
        document.querySelectorAll('.cfg-pane').forEach(function (p) {
            p.style.display = 'none';
        });
        var pane = g('cfgPane-' + key);
        if (pane) {
            pane.style.display = 'flex';
            pane.classList.add('active');
        }

        // load content
        var loaders = {
            clinic:    loadClinic,
            doctors:   loadDoctors,
            payment:   loadPayment,
            treatment: loadTreatment,
            program:   loadSettings,
            users:     loadUsers,
            templates: loadTemplates,
            print:     loadPrint,
            data:      loadData
        };
        if (loaders[key]) loaders[key]();
        var userPanel = g('cfgUserPanel');
        if (userPanel && key !== 'users' && key !== 'doctors') {
            userPanel.style.display = 'none';
        }
    }

    function cfgTabVisible(key) {
        if (typeof hasAppPermission !== 'function') return true;
        if (currentUserPermissions === null) return true;
        if (key === 'users') return hasAppPermission('config_user_info');
        if (key === 'program') return hasAppPermission('config_program_setting');
        return hasAppPermission('config');
    }

    function applyCfgNavPermissionGuards() {
        var sidebar = document.querySelector('.cfg-sidebar');
        if (!sidebar) return;
        sidebar.querySelectorAll('.cfg-nav-item').forEach(function (item) {
            var tab = item.getAttribute('data-tab');
            var show = cfgTabVisible(tab);
            item.style.display = show ? '' : 'none';
            item.setAttribute('aria-hidden', show ? 'false' : 'true');
        });
    }

    function firstAllowedCfgTab() {
        for (var i = 0; i < TABS.length; i++) {
            if (cfgTabVisible(TABS[i].key)) return TABS[i].key;
        }
        return 'clinic';
    }

    // ════════════════════════════════════════════════════════
    // INIT  (public — called by app.js card click)
    // ════════════════════════════════════════════════════════
    function init() {
        if (typeof canAccessConfiguration === 'function') {
            if (!canAccessConfiguration()) {
                toast(ctr('cfg.msg.adminRequired'), true);
                return;
            }
        } else if (typeof currentRole !== 'undefined' && currentRole !== 'admin') {
            toast(ctr('cfg.msg.adminRequired'), true);
            return;
        }
        _ready = true;
        wireNav();
        applyCfgNavPermissionGuards();
        switchTab(firstAllowedCfgTab());
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: CLINIC PROFILE ──────────────────────────────────
    // ════════════════════════════════════════════════════════
    var _clinicEditId = null;
  var _activeClinicId = null;
  var _selectedClinicIds = [];

    function loadClinic() {
        var pane = g('cfgPane-clinic');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(ctr('common.loadingEllipsis')) + '</p>';

        SB.from('clinics').select('*').order('clinic_code')
        .then(function (r) {
            var rows = r.data || [];
            var html =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin-bottom:20px;">' +
                '<h2 style="margin:0;font-size:20px;">' + esc(ctr('cfg.clinicHeader')) + '</h2>' +
                '<div style="display:flex;gap:10px;">' +
                '<button id="btnPrintClinics" onclick="CFG._printSelectedClinics()" ' +
                'disabled style="padding:9px 20px;background:#6c757d;color:#fff;' +
                'border:none;border-radius:6px;cursor:not-allowed;' +
                'font-size:13px;">' + esc(ctr('cfg.btn.printSelected')) + '</button>' +
                '<button onclick="CFG._openClinicPanel()" style="' +
                'padding:9px 20px;background:#0d6efd;color:#fff;' +
                'border:none;border-radius:6px;cursor:pointer;' +
                'font-size:13px;">' + esc(ctr('cfg.btn.addClinic')) + '</button></div></div>' +
                '<div id="clinicList">' + renderClinicCards(rows) + '</div>' +
                clinicPanelHTML();
            pane.innerHTML = html;
        })
        .catch(function (e) {
            pane.innerHTML = '<p style="color:red;">' + esc(ctrRepl('appt.msg.error', { MSG: e.message })) + '</p>';
        });
    }

    function renderClinicCards(rows) {
        if (!rows.length) {
            return '<p style="color:#888;text-align:center;padding:40px 0;">' +
                esc(ctr('cfg.msg.noClinics')) + '</p>';
        }
      
        var html = '<div style="background:#fff;border-radius:8px;overflow:hidden;' +
            'box-shadow:0 1px 4px rgba(0,0,0,.08);">' +
            '<table style="width:100%;border-collapse:collapse;">' +
            '<thead>' +
            '<tr style="background:#f0f7ff;">' +
            '<th style="padding:12px 10px;text-align:center;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'width:50px;">' +
            '<input type="checkbox" id="checkAllClinics" ' +
            'onchange="CFG._toggleAllClinics(this.checked)" ' +
            'style="cursor:pointer;"></th>' +
            '<th style="padding:12px 10px;text-align:center;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'width:80px;text-transform:uppercase;letter-spacing:0.5px;">' + esc(ctr('cfg.label.active')) + '</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">' + esc(ctr('cfg.th.clinicCode')) + '</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">' + esc(ctr('cfg.th.englishName')) + '</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">' + esc(ctr('cfg.th.chineseName')) + '</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">' + esc(ctr('cfg.th.address')) + '</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">' + esc(ctr('cfg.th.tel')) + '</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">' + esc(ctr('cfg.th.openClose')) + '</th>' +
            '<th style="padding:12px 14px;text-align:center;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">' + esc(ctr('cfg.th.actions')) + '</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody>';
      
        rows.forEach(function (c) {
            var isActive = (_activeClinicId === c.id);
            var isChecked = (_selectedClinicIds.indexOf(c.id) !== -1);
          
            html += '<tr style="border-bottom:1px solid #f0f0f0;" ' +
                'onmouseover="this.style.background=\'#f5f9ff\'" ' +
                'onmouseout="this.style.background=\'#fff\'">' +
                '<td style="padding:12px 10px;text-align:center;vertical-align:top;">' +
                '<input type="checkbox" class="clinic-checkbox" ' +
                'data-id="' + c.id + '" ' +
                (isChecked ? 'checked ' : '') +
                'onchange="CFG._toggleClinicSelect(\'' + c.id + '\', this.checked)" ' +
                'onclick="event.stopPropagation()" ' +
                'style="cursor:pointer;"></td>' +
                '<td style="padding:12px 10px;text-align:center;vertical-align:top;">' +
                '<label class="switch" style="position:relative;display:inline-block;' +
                'width:44px;height:24px;" ' +
                'onclick="event.stopPropagation();">' +
                '<input type="checkbox" ' +
                (isActive ? 'checked ' : '') +
                'onchange="CFG._setActiveClinic(\'' + c.id + '\', this.checked)" ' +
                'style="opacity:0;width:0;height:0;">' +
                '<span class="slider" style="position:absolute;cursor:pointer;' +
                'top:0;left:0;right:0;bottom:0;background-color:' +
                (isActive ? '#28a745' : '#ccc') + ';' +
                'transition:.3s;border-radius:24px;">' +
                '<span style="position:absolute;content:\'\';height:18px;width:18px;' +
                'left:' + (isActive ? '23px' : '3px') + ';bottom:3px;' +
                'background-color:white;transition:.3s;border-radius:50%;"></span>' +
                '</span></label></td>' +
                '<td style="padding:12px 14px;font-size:13px;font-weight:600;' +
                'color:#0d6efd;vertical-align:top;cursor:pointer;" ' +
                'onclick="CFG._openClinicPanel(\'' + c.id + '\')">' +
                esc(c.clinic_code || '-') + '</td>' +
                '<td style="padding:12px 14px;font-size:13px;vertical-align:top;' +
                'cursor:pointer;" onclick="CFG._openClinicPanel(\'' + c.id + '\')">' +
                esc(c.english_name || '-') + '</td>' +
                '<td style="padding:12px 14px;font-size:13px;vertical-align:top;' +
                'cursor:pointer;" onclick="CFG._openClinicPanel(\'' + c.id + '\')">' +
                esc(c.chinese_name || '-') + '</td>' +
                '<td style="padding:12px 14px;font-size:12px;color:#555;' +
                'max-width:200px;vertical-align:top;cursor:pointer;" ' +
                'onclick="CFG._openClinicPanel(\'' + c.id + '\')">' +
                esc(c.address || '-') + '</td>' +
                '<td style="padding:12px 14px;font-size:12px;vertical-align:top;' +
                'white-space:nowrap;cursor:pointer;" ' +
                'onclick="CFG._openClinicPanel(\'' + c.id + '\')">' +
                esc(c.tel || '-') +
                (c.fax ? '<br><small style="color:#888;">' + esc(ctrRepl('cfg.label.faxPrefix', { FAX: c.fax })) + '</small>' : '') +
                '</td>' +
                '<td style="padding:12px 14px;font-size:12px;vertical-align:top;' +
                'white-space:nowrap;cursor:pointer;" ' +
                'onclick="CFG._openClinicPanel(\'' + c.id + '\')">' +
                esc(c.open_at || '-') + ' ~ ' + esc(c.close_at || '-') +
                (c.appt_interval ? '<br><small style="color:#888;">' +
                esc(ctrRepl('cfg.label.intervalPrefix', { N: String(c.appt_interval) })) + '</small>' : '') +
                '</td>' +
                '<td style="padding:12px 14px;text-align:center;vertical-align:top;">' +
                '<div style="display:flex;gap:6px;justify-content:center;">' +
                '<button onclick="event.stopPropagation();CFG._openClinicPanel(\'' +
                c.id + '\')" style="padding:5px 12px;background:#0d6efd;' +
                'color:#fff;border:none;border-radius:4px;cursor:pointer;' +
                'font-size:11px;font-weight:600;">' + esc(ctr('cfg.btn.edit')) + '</button>' +
                '<button onclick="event.stopPropagation();CFG._deleteClinic(\'' +
                c.id + '\',\'' + esc(c.english_name || c.clinic_code) +
                '\')" style="padding:5px 12px;background:#dc3545;color:#fff;' +
                'border:none;border-radius:4px;cursor:pointer;font-size:11px;' +
                'font-weight:600;">' + esc(ctr('cfg.btn.delete')) + '</button>' +
                '</div></td>' +
                '</tr>';
        });
      
        html += '</tbody></table></div>';
        return html;
    }

    function clinicPanelHTML() {
        return '<div id="clinicPanel" style="display:none;position:fixed;' +
            'top:0;right:0;width:450px;height:100%;background:#fff;' +
            'box-shadow:-4px 0 20px rgba(0,0,0,.15);z-index:1000;' +
            'padding:32px 28px;overflow-y:auto;box-sizing:border-box;">' +
            '<div style="display:flex;justify-content:space-between;' +
            'align-items:center;margin-bottom:24px;">' +
            '<h3 id="clinicPanelTitle" style="margin:0;font-size:17px;">' + esc(ctr('cfg.panel.addClinic')) + '</h3>' +
            '<button onclick="CFG._closeClinicPanel()" style="background:none;' +
            'border:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>' +
            '</div>' +
            fld('cfg.form.clinicCode',        'cl_code')   +
            fld('cfg.form.englishName',         'cl_ename')  +
            fld('cfg.form.chineseName',         'cl_cname')  +
            fld('cfg.form.qualification',        'cl_qual')   +
            '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">' + esc(ctr('cfg.form.address')) + '</label>' +
            '<textarea id="cl_addr" rows="3" style="' + inputStyle() + '"></textarea>' +
            '</div>' +
            fld('cfg.form.tel',                  'cl_tel')    +
            fld('cfg.form.fax',                  'cl_fax')    +
            fld('cfg.form.openAt',              'cl_open',  'time') +
            fld('cfg.form.closeAt',             'cl_close', 'time') +
            fld('cfg.form.apptInterval',  'cl_interval', 'number') +
            '<button onclick="CFG._saveClinic()" style="width:100%;' +
            'padding:11px;background:#0d6efd;color:#fff;border:none;' +
            'border-radius:6px;cursor:pointer;font-size:14px;">' +
            esc(ctr('cfg.btn.saveClinic')) + '</button>' +
            '</div>';
    }

    function _openClinicPanel(id) {
        _clinicEditId = id || null;
        var panel = g('clinicPanel');
        if (!panel) return;

        g('clinicPanelTitle').textContent = id ? ctr('cfg.panel.editClinic') : ctr('cfg.panel.addClinic');

        // clear
        ['cl_code','cl_ename','cl_cname','cl_qual','cl_addr','cl_tel',
         'cl_fax','cl_open','cl_close','cl_interval']
        .forEach(function (fid) { var e = g(fid); if (e) e.value = ''; });

        if (id) {
            SB.from('clinics').select('*').eq('id', id).single()
            .then(function (r) {
                var d = r.data || {};
                if (g('cl_code'))     g('cl_code').value     = d.clinic_code   || '';
                if (g('cl_ename'))    g('cl_ename').value    = d.english_name  || '';
                if (g('cl_cname'))    g('cl_cname').value    = d.chinese_name  || '';
                if (g('cl_qual'))     g('cl_qual').value     = d.qualification || '';
                if (g('cl_addr'))     g('cl_addr').value     = d.address       || '';
                if (g('cl_tel'))      g('cl_tel').value      = d.tel           || '';
                if (g('cl_fax'))      g('cl_fax').value      = d.fax           || '';
                if (g('cl_open'))     g('cl_open').value     = d.open_at       || '';
                if (g('cl_close'))    g('cl_close').value    = d.close_at      || '';
                if (g('cl_interval')) g('cl_interval').value = d.appt_interval || '';
            });
        }
        panel.style.display = 'block';
    }

    function _closeClinicPanel() {
        var p = g('clinicPanel');
        if (p) p.style.display = 'none';
        _clinicEditId = null;
    }

    function _saveClinic() {
        var code = (g('cl_code') || {}).value.trim();
        if (!code) { toast(ctr('cfg.msg.clinicCodeRequired'), true); return; }

        var payload = {
            clinic_code:   code,
            english_name:  (g('cl_ename')    || {}).value.trim(),
            chinese_name:  (g('cl_cname')    || {}).value.trim(),
            qualification: (g('cl_qual')     || {}).value.trim(),
            address:       (g('cl_addr')     || {}).value.trim(),
            tel:           (g('cl_tel')      || {}).value.trim(),
            fax:           (g('cl_fax')      || {}).value.trim(),
            open_at:       (g('cl_open')     || {}).value || null,
            close_at:      (g('cl_close')    || {}).value || null,
            appt_interval: parseInt((g('cl_interval') || {}).value) || 30
        };

        var op = _clinicEditId
            ? SB.from('clinics').update(payload).eq('id', _clinicEditId)
            : SB.from('clinics').insert(payload);

        op.then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(_clinicEditId ? ctr('cfg.msg.clinicUpdated') : ctr('cfg.msg.clinicAdded'));
            _closeClinicPanel();
            loadClinic();
        });
    }

    function _deleteClinic(id, name) {
        confirm(ctrRepl('cfg.confirm.deleteClinic', { NAME: name }), function () {
            SB.from('clinics').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast(ctr('cfg.msg.clinicDeleted'));
                loadClinic();
            });
        });
    }

    function inputStyle() {
        return 'width:100%;padding:8px 10px;border:1px solid #ddd;' +
               'border-radius:6px;font-size:14px;box-sizing:border-box;';
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: DOCTORS ─────────────────────────────────────────
    // ════════════════════════════════════════════════════════
        var _docEditId = null;
        var _selectedDoctorIds = [];
        var _docClinics = [];
        var _docSelectedClinicId = null;

        function cfgClinicLabel(c) {
            if (!c) return ctr('cfg.label.clinic');
            return (typeof clinicDisplayName === 'function')
                ? clinicDisplayName(c)
                : (c.english_name || c.chinese_name || ctr('cfg.label.clinic'));
        }

        function _onDocClinicChange(clinicId) {
            _docSelectedClinicId = clinicId || null;
            _selectedDoctorIds = [];
            loadDoctors();
        }

            function loadDoctors() {
            var pane = g('cfgPane-doctors');
            if (!pane) return;
            pane.innerHTML = '<p style="color:#888;">' + esc(ctr('common.loadingEllipsis')) + '</p>';

            Promise.all([
                SB.from('clinics').select('id,clinic_code,english_name,chinese_name').order('clinic_code'),
                SB.from('doctors').select('*').order('doctor_code'),
                SB.from('app_users').select('*').order('user_id')
            ]).then(function (all) {
                if (all[0].error) {
                    pane.innerHTML = '<p style="color:red;">' + esc(ctrRepl('appt.msg.error', { MSG: all[0].error.message })) + '</p>';
                    return;
                }
                _docClinics = all[0].data || [];
                var allDocs = (all[1] && all[1].data) ? all[1].data : [];
                var allUsers = (all[2] && all[2].data) ? all[2].data : [];
                if (!_docSelectedClinicId && _docClinics.length) {
                    _docSelectedClinicId = _docClinics[0].id;
                }
                var clinicDocs = allDocs.filter(function (d) {
                    return d.clinic_id === _docSelectedClinicId;
                });
                var recepUsers = allUsers.filter(function (u) {
                    return u.role === 'receptionist' && u.clinic_id === _docSelectedClinicId;
                });
                var adminUsers = allUsers.filter(function (u) {
                    return u.role === 'admin';
                });
                _usrClinics = _docClinics.slice();
                _usrDoctors = allDocs.filter(function (d) { return d.is_active !== false; });
                var clinicOpts = _docClinics.length
                    ? _docClinics.map(function (c) {
                        var sel = c.id === _docSelectedClinicId ? ' selected' : '';
                        return '<option value="' + esc(c.id) + '"' + sel + '>' +
                            esc(cfgClinicLabel(c)) + '</option>';
                    }).join('')
                    : '<option value="">' + esc(ctr('cfg.msg.noClinicsSelect')) + '</option>';
                var rows = clinicDocs;
                var html =
                    '<div style="display:flex;justify-content:space-between;' +
                    'align-items:center;margin-bottom:20px;">' +
                    '<h2 style="margin:0;font-size:20px;">' + esc(ctr('cfg.header.doctorsRecep')) + '</h2>' +
                    '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                    '<button id="btnPrintDoctors" onclick="CFG._printSelectedDoctors()" ' +
                    'disabled style="padding:9px 20px;background:#6c757d;color:#fff;' +
                    'border:none;border-radius:6px;cursor:not-allowed;' +
                    'font-size:13px;">' + esc(ctr('cfg.btn.printSelected')) + '</button>' +
                    '<button onclick="CFG._openDocPanel()" style="' +
                    'padding:9px 20px;background:#0d6efd;color:#fff;' +
                    'border:none;border-radius:6px;cursor:pointer;' +
                    'font-size:13px;">' + esc(ctr('cfg.btn.addDoctor')) + '</button></div></div>' +
                    '<div style="margin-bottom:18px;max-width:420px;">' +
                    '<label style="display:block;font-size:12px;font-weight:700;color:#555;margin-bottom:6px;">' + esc(ctr('cfg.label.clinic')) + '</label>' +
                    '<select id="docClinicSelect" onchange="CFG._onDocClinicChange(this.value)" style="' +
                    inputStyle() + '">' + clinicOpts + '</select>' +
                    '<div style="font-size:11px;color:#888;margin-top:6px;">' +
                    esc(ctr('cfg.label.adminHint')) + '</div>' +
                    '</div>' +
                    '<div id="docList">' + renderDocCards(rows, adminUsers) + '</div>' +
                    renderReceptionSection(recepUsers) +
                    docPanelHTML();
                pane.innerHTML = html;
                _selectedDoctorIds = [];
                _updateDoctorPrintBtn();
            }).catch(function (e) {
                pane.innerHTML = '<p style="color:red;">' + esc(ctrRepl('appt.msg.error', { MSG: e.message })) + '</p>';
            });
        }

        function renderReceptionSection(rows) {
            var TH = 'padding:11px 12px;text-align:left;font-size:12px;font-weight:800;' +
                'color:#0d6efd;border-bottom:2px solid #dde8f5;text-transform:uppercase;letter-spacing:.4px;';
            var TD = 'padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:middle;';
            var body = '';
        if (!rows.length) {
                body = '<tr><td colspan="4" style="padding:16px;text-align:center;color:#888;">' +
                    esc(ctr('cfg.msg.noReceptionUsers')) + '</td></tr>';
            } else {
                rows.forEach(function (u) {
                    var active = u.is_active !== false;
                    body +=
                        '<tr onmouseover="this.style.background=\'#f5f9ff\'" ' +
                        'onmouseout="this.style.background=\'#fff\'">' +
                        '<td style="' + TD + 'font-weight:800;color:#0d6efd;">' + esc(u.user_id || '-') + '</td>' +
                        '<td style="' + TD + '">' + esc(u.display_name || '-') + '</td>' +
                        '<td style="' + TD + 'text-align:center;">' +
                        (active
                            ? '<span style="padding:3px 10px;border-radius:999px;background:#d4edda;color:#155724;font-size:11px;font-weight:800;">' + esc(ctr('cfg.tpl.yes')) + '</span>'
                            : '<span style="padding:3px 10px;border-radius:999px;background:#f8d7da;color:#721c24;font-size:11px;font-weight:800;">' + esc(ctr('cfg.tpl.no')) + '</span>') +
                        '</td>' +
                        '<td style="' + TD + 'text-align:center;">' +
                        '<button onclick="CFG._openRecepUserPanel(\'' + esc(u.id) + '\')" ' +
                        'style="padding:6px 12px;background:#0d6efd;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:800;margin-right:4px;">' + esc(ctr('cfg.btn.edit')) + '</button>' +
                        '<button onclick="CFG._openCopyToClinic(\'reception\',\'' + esc(u.id) + '\')" ' +
                        'style="padding:6px 10px;background:#17a2b8;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:800;margin-right:4px;">' + esc(ctr('cfg.btn.copy')) + '</button>' +
                        '<button onclick="CFG._deleteUser(\'' + esc(u.id) + '\',\'' + esc(u.user_id) + '\')" ' +
                        'style="padding:6px 12px;background:#dc3545;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:800;">' + esc(ctr('cfg.btn.delete')) + '</button>' +
                        '</td></tr>';
                });
            }
            return '<div style="margin-top:28px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
                '<h3 style="margin:0;font-size:17px;color:#333;">' + esc(ctr('cfg.header.receptionUsers')) + '</h3>' +
                '<button onclick="CFG._openRecepUserPanel()" style="padding:8px 16px;background:#0d6efd;color:#fff;' +
                'border:none;border-radius:6px;cursor:pointer;font-size:13px;">' + esc(ctr('cfg.btn.addReception')) + '</button>' +
                '</div>' +
                '<div style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">' +
                '<table style="width:100%;border-collapse:collapse;">' +
                '<thead><tr style="background:#f0f7ff;">' +
                '<th style="' + TH + 'width:160px;">' + esc(ctr('cfg.th.userId')) + '</th>' +
                '<th style="' + TH + '">' + esc(ctr('cfg.th.displayName')) + '</th>' +
                '<th style="' + TH + 'width:90px;text-align:center;">' + esc(ctr('cfg.label.active')) + '</th>' +
                '<th style="' + TH + 'width:240px;text-align:center;">' + esc(ctr('cfg.th.actions')) + '</th>' +
                '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
        }

        function _openRecepUserPanel(id) {
            if (!_docSelectedClinicId) {
                toast(ctr('cfg.msg.selectClinicFirst'), true);
                return;
            }
            _openUserPanel(id || null);
            cfgSv('usr_role', 'receptionist');
            cfgSv('usr_clinic_id', _docSelectedClinicId);
            _syncUserRoleFields();
            var t1 = g('cfgUserPanelTitle');
            if (t1) t1.textContent = id ? ctr('cfg.panel.editReceptionUser') : ctr('cfg.panel.newReceptionUser');
        }

        function _openAdminUserPanel(id) {
            _openUserPanel(id || null);
            if (!id) {
                cfgSv('usr_role', 'admin');
                cfgSv('usr_clinic_id', '');
                cfgSv('usr_doctor_id', '');
                cfgSv('usr_password', CFG_ADMIN_DEFAULT_PW);
            }
            _syncUserRoleFields();
            var t2 = g('cfgUserPanelTitle');
            if (t2) t2.textContent = id ? ctr('cfg.panel.editAdminLogin') : ctr('cfg.panel.newAdminLogin');
        }

        function _onUserRoleChange() {
            _syncUserRoleFields();
            var role = cfgSvGet('usr_role');
            if (role === 'admin' && !cfgSvGet('usr_password')) {
                cfgSv('usr_password', CFG_ADMIN_DEFAULT_PW);
            }
        }

        function _syncUserRoleFields() {
            var role = cfgSvGet('usr_role') || 'staff';
            var isAdmin = role === 'admin';
            var doctorWrap = _cfgUsrField('usr_doctor_wrap') || g('usr_doctor_wrap');
            if (doctorWrap) doctorWrap.style.display = isAdmin ? 'none' : 'block';
            if (isAdmin) cfgSv('usr_doctor_id', '');
        }

        var _copyPickerKind = null;
        var _copyPickerRecordId = null;

        function _clinicLabelById(clinicId) {
            var c = (_docClinics || []).find(function (x) { return x.id === clinicId; });
            return c ? cfgClinicLabel(c) : ctr('cfg.label.clinic');
        }

        function _showCopyToClinicPicker(kind, recordId, recordLabel) {
            _copyPickerKind = kind;
            _copyPickerRecordId = recordId;
            var others = (_docClinics || []).filter(function (c) {
                return c.id !== _docSelectedClinicId;
            });
            if (!others.length) {
                toast(ctr('cfg.msg.noOtherClinicCopy'), true);
                return;
            }

            var old = g('cfgCopyClinicOv');
            if (old && old.parentNode) old.parentNode.removeChild(old);

            var ov = document.createElement('div');
            ov.id = 'cfgCopyClinicOv';
            ov.style.cssText =
                'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100001;' +
                'display:flex;align-items:center;justify-content:center;';

            var box = document.createElement('div');
            box.style.cssText =
                'background:#fff;border-radius:10px;padding:28px 24px;max-width:420px;width:92%;' +
                'box-shadow:0 8px 32px rgba(0,0,0,.3);';

            var title = document.createElement('p');
            title.style.cssText = 'margin:0 0 8px;font-size:16px;font-weight:700;color:#0d6efd;';
            title.textContent = ctr('cfg.copy.title');

            var msgEl = document.createElement('p');
            msgEl.style.cssText = 'margin:0 0 16px;font-size:14px;color:#444;line-height:1.5;';
            var promptKey = kind === 'doctor' ? 'cfg.copy.promptDoctor' : 'cfg.copy.promptReception';
            msgEl.textContent = ctrRepl(promptKey, { NAME: recordLabel || '' });

            var lbl = document.createElement('label');
            lbl.style.cssText = 'display:block;font-size:12px;font-weight:700;color:#555;margin-bottom:6px;';
            lbl.textContent = ctr('cfg.copy.destinationClinic');

            var sel = document.createElement('select');
            sel.style.cssText = inputStyle();
            var ph = document.createElement('option');
            ph.value = '';
            ph.textContent = ctr('cfg.copy.selectClinicPh');
            sel.appendChild(ph);
            others.forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = cfgClinicLabel(c);
                sel.appendChild(opt);
            });

            var btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:10px;margin-top:20px;justify-content:flex-end;';

            function closeOv() {
                if (ov.parentNode) ov.parentNode.removeChild(ov);
                _copyPickerKind = null;
                _copyPickerRecordId = null;
            }

            var copyBtn = document.createElement('button');
            copyBtn.textContent = ctr('cfg.btn.copy');
            copyBtn.style.cssText =
                'background:#0d6efd;color:#fff;border:none;padding:10px 22px;border-radius:6px;' +
                'cursor:pointer;font-size:14px;font-weight:600;';
            copyBtn.addEventListener('click', function () {
                var targetId = sel.value;
                if (!targetId) {
                    toast(ctr('cfg.msg.selectDestinationClinic'), true);
                    return;
                }
                closeOv();
                if (kind === 'doctor') {
                    _copyDoctorToClinic(recordId, targetId);
                } else {
                    _copyRecepToClinic(recordId, targetId);
                }
            });

            var cancelBtn = document.createElement('button');
            cancelBtn.textContent = ctr('cfg.btn.cancel');
            cancelBtn.style.cssText =
                'background:#6c757d;color:#fff;border:none;padding:10px 22px;border-radius:6px;' +
                'cursor:pointer;font-size:14px;font-weight:600;';
            cancelBtn.addEventListener('click', closeOv);
            ov.addEventListener('click', function (e) { if (e.target === ov) closeOv(); });

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(copyBtn);
            box.appendChild(title);
            box.appendChild(msgEl);
            box.appendChild(lbl);
            box.appendChild(sel);
            box.appendChild(btnRow);
            ov.appendChild(box);
            document.body.appendChild(ov);
            sel.focus();
        }

        function _openCopyToClinic(kind, recordId) {
            if (!_docSelectedClinicId) {
                toast(ctr('cfg.msg.selectSourceClinicFirst'), true);
                return;
            }
            if (kind === 'doctor') {
                SB.from('doctors').select('doctor_code,english_name,chinese_name').eq('id', recordId).single()
                .then(function (r) {
                    var d = r.data || {};
                    var label = d.doctor_code || d.english_name || d.chinese_name || ctr('cfg.label.doctorFallback');
                    _showCopyToClinicPicker('doctor', recordId, label);
                });
                return;
            }
            SB.from('app_users').select('user_id,display_name').eq('id', recordId).single()
            .then(function (r) {
                var u = r.data || {};
                var label = u.user_id || u.display_name || ctr('cfg.label.receptionFallback');
                _showCopyToClinicPicker('reception', recordId, label);
            });
        }

        function _clinicCodeSuffix(clinicId) {
            var c = (_docClinics || []).find(function (x) { return x.id === clinicId; });
            if (c && c.clinic_code) {
                return String(c.clinic_code).replace(/[^a-zA-Z0-9]/g, '') || 'C';
            }
            return 'C';
        }

        /** doctor_code is globally unique in DB — suffix with target clinic code when copying. */
        function _uniqueDoctorCode(baseCode, targetClinicId, done) {
            var suffix = _clinicCodeSuffix(targetClinicId);
            var base = String(baseCode || 'DR').trim() || 'DR';
            var candidates = [];
            var first = base + '_' + suffix;
            if (first.length <= 32) candidates.push(first);
            candidates.push(base + '_' + suffix + '2');
            candidates.push(base + '_' + suffix + '3');
            candidates.push(base + '_' + suffix + '_' + String(Date.now()).slice(-5));

            var idx = 0;
            function tryNext() {
                if (idx >= candidates.length) {
                    done(base + '_' + suffix + '_' + Date.now());
                    return;
                }
                var candidate = candidates[idx++];
                SB.from('doctors').select('id').eq('doctor_code', candidate).limit(1)
                .then(function (r) {
                    if (r.data && r.data.length) tryNext();
                    else done(candidate);
                });
            }
            tryNext();
        }

        function _copyDoctorToClinic(doctorId, targetClinicId) {
            if (!doctorId || !targetClinicId) return;
            SB.from('doctors').select('*').eq('id', doctorId).single()
            .then(function (r) {
                if (r.error || !r.data) {
                    toast(ctr('cfg.msg.couldNotLoadDoctorCopy'), true);
                    return;
                }
                var d = r.data;
                _uniqueDoctorCode(d.doctor_code, targetClinicId, function (newCode) {
                    var payload = {
                        doctor_code:   newCode,
                        english_name:  d.english_name,
                        chinese_name:  d.chinese_name,
                        qualification: d.qualification,
                        tel:           d.tel,
                        email:         d.email,
                        color:         d.color || '#4A90D9',
                        is_active:     d.is_active !== false,
                        clinic_id:     targetClinicId
                    };
                    SB.from('doctors').insert(payload)
                    .then(function (ins) {
                        if (ins.error) { toast(ins.error.message, true); return; }
                        var msg = ctrRepl('cfg.msg.doctorCopiedTo', { CLINIC: _clinicLabelById(targetClinicId) });
                        if (newCode !== d.doctor_code) {
                            msg += ctrRepl('cfg.msg.doctorCopiedCodeChange', {
                                NEW: newCode,
                                OLD: d.doctor_code || ''
                            });
                        }
                        toast(msg);
                        if (typeof loadClinicsAndDoctorsForLogin === 'function') {
                            loadClinicsAndDoctorsForLogin();
                        }
                        if (_docSelectedClinicId === targetClinicId) loadDoctors();
                    });
                });
            });
        }

        function _uniqueRecepUserId(baseUserId, targetClinicId, done) {
            var suffix = _clinicCodeSuffix(targetClinicId);
            var base = String(baseUserId || 'recep').trim() || 'recep';
            var candidates = [
                base + '_' + suffix,
                base + '_' + suffix + '2',
                base + '_' + suffix + '3',
                base + '_' + suffix + '_' + String(Date.now()).slice(-5)
            ];
            var idx = 0;
            function tryNext() {
                if (idx >= candidates.length) {
                    done(base + '_' + suffix + '_' + Date.now());
                    return;
                }
                var candidate = candidates[idx++];
                SB.from('app_users').select('id').eq('user_id', candidate).limit(1)
                .then(function (r) {
                    if (r.data && r.data.length) tryNext();
                    else done(candidate);
                });
            }
            tryNext();
        }

        function _copyRecepToClinic(userDbId, targetClinicId) {
            if (!userDbId || !targetClinicId) return;
            SB.from('app_users').select('*').eq('id', userDbId).single()
            .then(function (r) {
                if (r.error || !r.data) {
                    toast(ctr('cfg.msg.couldNotLoadRecepCopy'), true);
                    return;
                }
                var u = r.data;
                _uniqueRecepUserId(u.user_id || 'recep', targetClinicId, function (newUserId) {
                    var payload = {
                        user_id: newUserId,
                        password: u.password || '1234',
                        display_name: u.display_name,
                        role: 'receptionist',
                        clinic_id: targetClinicId,
                        doctor_id: null,
                        is_active: u.is_active !== false,
                        permissions: u.permissions || collectPermissionsFromUserPanel()
                    };
                    SB.from('app_users').insert([payload])
                    .then(function (ins) {
                        if (ins.error) { toast(ins.error.message, true); return; }
                        toast(ctrRepl('cfg.msg.recepCopiedTo', {
                            CLINIC: _clinicLabelById(targetClinicId),
                            USER: newUserId
                        }));
                        if (_docSelectedClinicId === targetClinicId) loadDoctors();
                        loadUsers();
                    });
                });
            });
        }

        var BTN_COPY =
            'padding:4px 9px;background:#17a2b8;color:#fff;border:none;border-radius:4px;' +
            'cursor:pointer;font-size:11px;font-weight:600;';

        function renderAdminUserRows(adminUsers) {
            var TD0  = 'padding:11px 14px;font-size:13px;vertical-align:middle;border-bottom:1px solid #f0f0f0;';
            var TD0_C = 'padding:11px 10px;text-align:center;vertical-align:middle;border-bottom:1px solid #f0f0f0;';
            if (!adminUsers.length) {
                return '<tr style="background:#fffbf0;">' +
                    '<td colspan="9" style="padding:16px;text-align:center;color:#888;font-size:13px;">' +
                    esc(ctr('cfg.msg.noAdminLogin')) + ' ' +
                    '<button type="button" onclick="CFG._openAdminUserPanel()" ' +
                    'style="padding:4px 10px;background:#0d6efd;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;">' +
                    esc(ctr('cfg.btn.addAdmin')) + '</button></td></tr>';
            }
            return adminUsers.map(function (u) {
                var active = u.is_active !== false;
                var statusBg  = active ? '#d4edda' : '#f8d7da';
                var statusCol = active ? '#155724' : '#721c24';
                return '<tr style="background:#fffbf0;">' +
                    '<td style="' + TD0_C + 'color:#aaa;">—</td>' +
                    '<td style="' + TD0 + 'font-weight:700;color:#b8860b;">ADMIN</td>' +
                    '<td style="' + TD0 + 'font-weight:700;">' + esc(u.display_name || ctr('cfg.label.adminFallback')) + '</td>' +
                    '<td style="' + TD0 + '">管理員</td>' +
                    '<td style="' + TD0 + 'color:#0d6efd;font-weight:600;">' + esc(u.user_id || '-') + '</td>' +
                    '<td style="' + TD0 + 'color:#888;font-style:italic;">' + esc(ctr('cfg.label.loginUser')) + '</td>' +
                    '<td style="' + TD0_C + '"><div style="width:22px;height:22px;border-radius:50%;margin:0 auto;background:#6c757d;border:2px solid #ddd;"></div></td>' +
                    '<td style="' + TD0_C + '"><span style="display:inline-block;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;background:' +
                    statusBg + ';color:' + statusCol + ';">' + (active ? esc(ctr('cfg.label.active')) : esc(ctr('cfg.label.inactiveStatus'))) + '</span></td>' +
                    '<td style="' + TD0_C + '">' +
                    '<button onclick="CFG._openAdminUserPanel(\'' + esc(u.id) + '\')" ' +
                    'style="padding:4px 11px;background:#0d6efd;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">' +
                    esc(ctr('cfg.btn.editLogin')) + '</button>' +
                    '</td></tr>';
            }).join('');
        }

        function renderDocCards(rows, adminUsers) {
        adminUsers = adminUsers || [];
        var TH = 'padding:11px 14px;text-align:left;font-size:12px;font-weight:700;' +
            'color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;';
        var TH_C = 'padding:11px 10px;text-align:center;font-size:12px;font-weight:700;' +
            'color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;';
        var html =
            '<div style="background:#fff;border-radius:8px;overflow:hidden;' +
            'box-shadow:0 1px 4px rgba(0,0,0,.08);">' +
            '<table style="width:100%;border-collapse:collapse;">' +
            '<thead><tr style="background:#f0f7ff;">' +
            '<th style="' + TH_C + 'width:46px;">' +
                '<input type="checkbox" id="checkAllDoctors" ' +
                'onchange="CFG._toggleAllDoctors(this.checked)" ' +
                'style="cursor:pointer;"></th>' +
            '<th style="' + TH + '">' + esc(ctr('cfg.th.doctorCode')) + '</th>' +
            '<th style="' + TH + '">' + esc(ctr('cfg.th.englishName')) + '</th>' +
            '<th style="' + TH + '">' + esc(ctr('cfg.th.chineseName')) + '</th>' +
            '<th style="' + TH + '">' + esc(ctr('cfg.th.qualification')) + '</th>' +
            '<th style="' + TH + '">' + esc(ctr('cfg.th.tel')) + '</th>' +
            '<th style="' + TH_C + 'width:60px;">' + esc(ctr('cfg.th.color')) + '</th>' +
            '<th style="' + TH_C + 'width:80px;">' + esc(ctr('cfg.th.status')) + '</th>' +
            '<th style="' + TH_C + '">' + esc(ctr('cfg.th.actions')) + '</th>' +
            '</tr></thead><tbody>';

        html += renderAdminUserRows(adminUsers);

        rows.forEach(function (d) {
            var checked  = (_selectedDoctorIds.indexOf(d.id) !== -1);
            var TD  = 'padding:11px 14px;font-size:13px;vertical-align:middle;' +
                'cursor:pointer;border-bottom:1px solid #f0f0f0;';
            var TD_C = 'padding:11px 10px;text-align:center;vertical-align:middle;' +
                'border-bottom:1px solid #f0f0f0;';
            var statusBg  = d.is_active ? '#d4edda' : '#f8d7da';
            var statusCol = d.is_active ? '#155724' : '#721c24';
            html +=
                '<tr onmouseover="this.style.background=\'#f5f9ff\'" ' +
                'onmouseout="this.style.background=\'#fff\'">' +
                '<td style="' + TD_C + '">' +
                    '<input type="checkbox" class="doctor-checkbox" data-id="' + d.id + '" ' +
                    (checked ? 'checked ' : '') +
                    'onchange="CFG._toggleDoctorSelect(\'' + d.id + '\',this.checked)" ' +
                    'onclick="event.stopPropagation()" style="cursor:pointer;"></td>' +
                '<td style="' + TD + 'font-weight:600;color:#0d6efd;" ' +
                    'onclick="CFG._openDocPanel(\'' + d.id + '\')">' + esc(d.doctor_code || '-') + '</td>' +
                '<td style="' + TD + '" onclick="CFG._openDocPanel(\'' + d.id + '\')">' +
                    esc(d.english_name || '-') + '</td>' +
                '<td style="' + TD + '" onclick="CFG._openDocPanel(\'' + d.id + '\')">' +
                    esc(d.chinese_name || '-') + '</td>' +
                '<td style="' + TD + 'color:#555;" onclick="CFG._openDocPanel(\'' + d.id + '\')">' +
                    esc(d.qualification || '-') + '</td>' +
                '<td style="' + TD + 'white-space:nowrap;" onclick="CFG._openDocPanel(\'' + d.id + '\')">' +
                    esc(d.tel || '-') + '</td>' +
                '<td style="' + TD_C + '">' +
                    '<div style="width:22px;height:22px;border-radius:50%;margin:0 auto;' +
                    'background:' + esc(d.color || '#aaa') + ';border:2px solid #ddd;"></div></td>' +
                '<td style="' + TD_C + '">' +
                    '<span style="display:inline-block;padding:3px 9px;border-radius:12px;' +
                    'font-size:11px;font-weight:600;background:' + statusBg + ';color:' + statusCol + ';">' +
                    (d.is_active ? esc(ctr('cfg.label.active')) : esc(ctr('cfg.label.inactiveStatus'))) + '</span></td>' +
                '<td style="' + TD_C + '">' +
                    '<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">' +
                    '<button onclick="event.stopPropagation();CFG._openDocPanel(\'' + d.id + '\')" ' +
                    'style="padding:4px 11px;background:#0d6efd;color:#fff;border:none;' +
                    'border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">' + esc(ctr('cfg.btn.edit')) + '</button>' +
                    '<button onclick="event.stopPropagation();CFG._openCopyToClinic(\'doctor\',\'' + d.id + '\')" ' +
                    'style="' + BTN_COPY + '">' + esc(ctr('cfg.btn.copy')) + '</button>' +
                    '<button onclick="event.stopPropagation();CFG._deleteDoc(\'' + d.id + '\',\'' +
                    esc(d.english_name || d.doctor_code) + '\')" ' +
                    'style="padding:4px 11px;background:#dc3545;color:#fff;border:none;' +
                    'border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">' + esc(ctr('cfg.btn.delete')) + '</button>' +
                    '</div></td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function docPanelHTML() {
        return '<div id="docPanel" style="display:none;position:fixed;' +
            'top:0;right:0;width:400px;height:100%;background:#fff;' +
            'box-shadow:-4px 0 20px rgba(0,0,0,.15);z-index:1000;' +
            'padding:32px 28px;overflow-y:auto;box-sizing:border-box;">' +
            '<div style="display:flex;justify-content:space-between;' +
            'align-items:center;margin-bottom:24px;">' +
            '<h3 id="docPanelTitle" style="margin:0;font-size:17px;">' + esc(ctr('cfg.panel.addDoctor')) + '</h3>' +
            '<button onclick="CFG._closeDocPanel()" style="background:none;' +
            'border:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>' +
            '</div>' +
            fld('cfg.form.doctorCode', 'dp_code')   +
            fld('cfg.form.englishName',  'dp_ename')  +
            fld('cfg.form.chineseName',  'dp_cname')  +
            fld('cfg.form.qualification', 'dp_qual')   +
            fld('cfg.form.tel',           'dp_tel')    +
            fld('cfg.form.email',         'dp_email', 'email') +
            '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">' + esc(ctr('cfg.form.colour')) + '</label>' +
            '<input type="color" id="dp_color" value="#4A90D9" ' +
            'style="width:60px;height:36px;border:1px solid #ddd;' +
            'border-radius:6px;cursor:pointer;"></div>' +
            '<div style="margin-bottom:20px;">' +
            '<label style="font-size:13px;color:#555;">' +
            '<input type="checkbox" id="dp_active" checked ' +
            'style="margin-right:6px;">' + esc(ctr('cfg.label.active')) + '</label></div>' +
            '<button onclick="CFG._saveDoc()" style="width:100%;' +
            'padding:11px;background:#0d6efd;color:#fff;border:none;' +
            'border-radius:6px;cursor:pointer;font-size:14px;">' +
            esc(ctr('cfg.btn.saveDoctor')) + '</button>' +
            '</div>';
    }

    function fld(labelOrKey, id, type, placeholderKey) {
        type = type || 'text';
        var label = (String(labelOrKey).indexOf('cfg.') === 0) ? ctr(labelOrKey) : labelOrKey;
        var phAttr = '';
        if (placeholderKey) {
            phAttr = ' placeholder="' + esc(ctr(placeholderKey)).replace(/"/g, '&quot;') + '"';
        }
        return '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">' + esc(label) + '</label>' +
            '<input type="' + type + '" id="' + id + '"' + phAttr + ' style="' +
            inputStyle() + '"></div>';
    }

    var PAYMENT_GROUP_PAIRS = [
        ['Cash', 'bill.payGroup.cash'],
        ['Card', 'bill.payGroup.card'],
        ['Bank', 'bill.payGroup.bank'],
        ['EWallet', 'bill.payGroup.ewallet'],
        ['Other', 'bill.payGroup.other']
    ];

    var CFG_TPL_TYPE_PAIRS = [
        ['receipt', 'cfg.tpl.typeReceipt'],
        ['prescription', 'cfg.tpl.typePrescription'],
        ['consent', 'cfg.tpl.typeConsent'],
        ['report', 'cfg.tpl.typeReport']
    ];

    var CFG_USER_ROLE_PAIRS = [
        ['admin', 'cfg.role.adminGlobal'],
        ['doctor', 'cfg.role.doctor'],
        ['staff', 'cfg.role.staff'],
        ['receptionist', 'cfg.role.receptionist'],
        ['nurse', 'cfg.role.nurse']
    ];

    function dispCfgTplType(raw) {
        var s = String(raw || '').trim().toLowerCase();
        if (!s) return '—';
        var i;
        for (i = 0; i < CFG_TPL_TYPE_PAIRS.length; i++) {
            if (CFG_TPL_TYPE_PAIRS[i][0] === s) return ctr(CFG_TPL_TYPE_PAIRS[i][1]);
        }
        return String(raw || '').trim() || '—';
    }

    function dispCfgUserRole(raw) {
        var s = String(raw || '').trim().toLowerCase();
        if (!s) return '—';
        var i;
        for (i = 0; i < CFG_USER_ROLE_PAIRS.length; i++) {
            if (CFG_USER_ROLE_PAIRS[i][0] === s) return ctr(CFG_USER_ROLE_PAIRS[i][1]);
        }
        return String(raw || '').trim() || '—';
    }

    function cfgTplTypeSelectHTML() {
        return CFG_TPL_TYPE_PAIRS.map(function (p) {
            return '<option value="' + esc(p[0]) + '">' + esc(ctr(p[1])) + '</option>';
        }).join('');
    }

    function cfgUserRoleSelectHTML() {
        return CFG_USER_ROLE_PAIRS.map(function (p) {
            return '<option value="' + esc(p[0]) + '">' + esc(ctr(p[1])) + '</option>';
        }).join('');
    }

    function refreshCfgTplTypeSelect() {
        var sel = g('tpl_type');
        if (!sel) return;
        var prev = sel.value || 'receipt';
        sel.innerHTML = cfgTplTypeSelectHTML();
        var has = false;
        var i;
        for (i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === prev) { has = true; break; }
        }
        sel.value = has ? prev : 'receipt';
    }

    function refreshCfgPmGroupSelect() {
        var sel = g('pm_group');
        if (!sel) return;
        var prev = sel.value || PAYMENT_GROUP_PAIRS[0][0];
        var html = '';
        PAYMENT_GROUP_PAIRS.forEach(function (pair) {
            html += '<option value="' + esc(pair[0]) + '">' +
                esc((typeof dispPayMethod === 'function') ? dispPayMethod(pair[0]) : ctr(pair[1])) +
                '</option>';
        });
        sel.innerHTML = html;
        var has = false;
        var i;
        for (i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === prev) { has = true; break; }
        }
        sel.value = has ? prev : PAYMENT_GROUP_PAIRS[0][0];
    }

    function refreshCfgUserRoleSelect() {
        var sel = g('usr_role');
        if (!sel) return;
        var prev = sel.value || 'staff';
        sel.innerHTML = cfgUserRoleSelectHTML();
        var has = false;
        var i;
        for (i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === prev) { has = true; break; }
        }
        sel.value = has ? prev : 'staff';
    }

    function pmGroupFieldHTML() {
        var html = '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">' + esc(ctr('cfg.form.typeGroup')) + '</label>' +
            '<select id="pm_group" style="' + inputStyle() + '">';
        PAYMENT_GROUP_PAIRS.forEach(function(pair) {
            html += '<option value="' + esc(pair[0]) + '">' +
                esc((typeof dispPayMethod === 'function') ? dispPayMethod(pair[0]) : ctr(pair[1])) +
                '</option>';
        });
        html += '</select></div>';
        return html;
    }

    function _openDocPanel(id) {
        _docEditId = id || null;
        var panel = g('docPanel');
        if (!panel) return;
        if (!id && !_docSelectedClinicId) {
            toast(ctr('cfg.msg.selectClinicFirst'), true);
            return;
        }

        g('docPanelTitle').textContent = id ? ctr('cfg.panel.editDoctor') : ctr('cfg.panel.addDoctor');

        // clear
        ['dp_code','dp_ename','dp_cname','dp_qual','dp_tel','dp_email']
        .forEach(function (fid) { var e = g(fid); if (e) e.value = ''; });
        var dc = g('dp_color');   if (dc) dc.value   = '#4A90D9';
        var da = g('dp_active');  if (da) da.checked = true;

        if (id) {
            SB.from('doctors').select('*').eq('id', id).single()
            .then(function (r) {
                var d = r.data || {};
                if (g('dp_code'))  g('dp_code').value  = d.doctor_code   || '';
                if (g('dp_ename')) g('dp_ename').value = d.english_name  || '';
                if (g('dp_cname')) g('dp_cname').value = d.chinese_name  || '';
                if (g('dp_qual'))  g('dp_qual').value  = d.qualification || '';
                if (g('dp_tel'))   g('dp_tel').value   = d.tel           || '';
                if (g('dp_email')) g('dp_email').value = d.email         || '';
                if (g('dp_color')) g('dp_color').value = d.color         || '#4A90D9';
                if (g('dp_active')) g('dp_active').checked = !!d.is_active;
            });
        }
        panel.style.display = 'block';
    }

    function _closeDocPanel() {
        var p = g('docPanel');
        if (p) p.style.display = 'none';
        _docEditId = null;
    }

    function _saveDoc() {
        var code = (g('dp_code') || {}).value.trim();
        if (!code) { toast(ctr('cfg.msg.doctorCodeRequired'), true); return; }
        if (!_docEditId && !_docSelectedClinicId) {
            toast(ctr('cfg.msg.selectClinicFirst'), true);
            return;
        }

        var payload = {
            doctor_code:   code,
            english_name:  (g('dp_ename')  || {}).value.trim(),
            chinese_name:  (g('dp_cname')  || {}).value.trim(),
            qualification: (g('dp_qual')   || {}).value.trim(),
            tel:           (g('dp_tel')    || {}).value.trim(),
            email:         (g('dp_email')  || {}).value.trim(),
            color:         (g('dp_color')  || {}).value,
            is_active:     (g('dp_active') || {}).checked !== false
        };
        if (!_docEditId) {
            payload.clinic_id = _docSelectedClinicId;
        }

        var op = _docEditId
            ? SB.from('doctors').update(payload).eq('id', _docEditId)
            : SB.from('doctors').insert(payload);

        op.then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(_docEditId ? ctr('cfg.msg.doctorUpdated') : ctr('cfg.msg.doctorAdded'));
            _closeDocPanel();
            loadDoctors();
            if (typeof loadClinicsAndDoctorsForLogin === 'function') {
                loadClinicsAndDoctorsForLogin();
            }
        });
    }

    function _deleteDoc(id, name) {
        confirm(ctrRepl('cfg.confirm.deleteDoctor', { NAME: name }), function () {
            SB.from('doctors').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast(ctr('cfg.msg.doctorDeleted'));
                loadDoctors();
            });
        });
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: PAYMENT METHODS ─────────────────────────────────
    // ════════════════════════════════════════════════════════
    var _pmEditId = null;

    function loadPayment() {
        var pane = g('cfgPane-payment');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(ctr('common.loadingEllipsis')) + '</p>';

        SB.from('bill_types').select('*').order('sort_order')
        .then(function (r) {
            var rows = r.data || [];
            var html =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin-bottom:20px;">' +
                '<h2 style="margin:0;font-size:20px;">' + esc(ctr('cfg.header.payment')) + '</h2>' +
                '<button onclick="CFG._openPmPanel()" style="' +
                'padding:9px 20px;background:#0d6efd;color:#fff;' +
                'border:none;border-radius:6px;cursor:pointer;' +
                'font-size:13px;">' + esc(ctr('cfg.btn.addMethod')) + '</button></div>' +
                '<div id="pmList">' + renderPmCards(rows) + '</div>' +
                pmPanelHTML();
            pane.innerHTML = html;
        });
    }

    function renderPmCards(rows) {
        if (!rows.length) return '<p style="color:#888;">' + esc(ctr('cfg.msg.noPaymentMethods')) + '</p>';
        return rows.map(function (d) {
            var dot = d.color_hex
                ? '<span style="display:inline-block;width:12px;height:12px;' +
                  'border-radius:50%;background:' + esc(d.color_hex) +
                  ';margin-right:8px;vertical-align:middle;"></span>'
                : '';
            return '<div style="background:#fff;border-radius:8px;' +
                'padding:14px 18px;margin-bottom:8px;' +
                'box-shadow:0 1px 4px rgba(0,0,0,.08);' +
                'display:flex;justify-content:space-between;align-items:center;">' +
                '<div>' + dot +
                '<strong>' + esc(d.name) + '</strong>' +
                ' <span style="color:#888;font-size:12px;">[' + esc(d.type_code) + ']</span>' +
                (d.is_default ? ' <span style="background:#0d6efd;color:#fff;' +
                'font-size:11px;padding:2px 7px;border-radius:10px;">' + esc(ctr('cfg.label.default')) + '</span>' : '') +
                (d.is_active ? '' : ' <span style="color:#dc3545;font-size:12px;">' + esc(ctr('cfg.label.inactive')) + '</span>') +
                '<div style="font-size:12px;color:#888;margin-top:3px;">' +
                esc(ctr('cfg.label.group')) + ' ' +
                esc(d.type_group
                    ? ((typeof dispPayMethod === 'function')
                        ? dispPayMethod(d.type_group)
                        : d.type_group)
                    : '-') +
                (d.surcharge_pct ? esc(ctrRepl('cfg.label.surcharge', { PCT: String(d.surcharge_pct) })) : '') +
                '</div></div>' +
                '<div>' +
                '<button onclick="CFG._openPmPanel(\'' + d.id + '\')" style="' +
                'padding:6px 14px;background:#0d6efd;color:#fff;border:none;' +
                'border-radius:5px;cursor:pointer;font-size:12px;margin-right:6px;">' +
                esc(ctr('cfg.btn.edit')) + '</button>' +
                '<button onclick="CFG._deletePm(\'' + d.id + '\',\'' +
                esc(d.name) + '\')" style="' +
                'padding:6px 14px;background:#dc3545;color:#fff;border:none;' +
                'border-radius:5px;cursor:pointer;font-size:12px;">' + esc(ctr('cfg.btn.delete')) + '</button>' +
                '</div></div>';
        }).join('');
    }

    function pmPanelHTML() {
        return '<div id="pmPanel" style="display:none;position:fixed;' +
            'top:0;right:0;width:400px;height:100%;background:#fff;' +
            'box-shadow:-4px 0 20px rgba(0,0,0,.15);z-index:1000;' +
            'padding:32px 28px;overflow-y:auto;box-sizing:border-box;">' +
            '<div style="display:flex;justify-content:space-between;' +
            'align-items:center;margin-bottom:24px;">' +
            '<h3 id="pmPanelTitle" style="margin:0;font-size:17px;">' + esc(ctr('cfg.panel.addPayment')) + '</h3>' +
            '<button onclick="CFG._closePmPanel()" data-i18n-aria-label="common.closeAria" aria-label="' + esc(ctr('common.closeAria')) + '" style="background:none;' +
            'border:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>' +
            '</div>' +
            fld('cfg.form.typeCode',  'pm_code')   +
            fld('cfg.form.nameRequired',       'pm_name')   +
            fld('cfg.form.typeName',    'pm_tname')  +
            pmGroupFieldHTML()  +
            fld('cfg.form.surchargePct',  'pm_surch', 'number') +
            fld('cfg.form.sortOrder',   'pm_sort',  'number') +
            '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">' + esc(ctr('cfg.form.colour')) + '</label>' +
            '<input type="color" id="pm_color" value="#4A90D9" ' +
            'style="width:60px;height:36px;border:1px solid #ddd;' +
            'border-radius:6px;cursor:pointer;"></div>' +
            '<div style="margin-bottom:8px;">' +
            '<label style="font-size:13px;color:#555;">' +
            '<input type="checkbox" id="pm_default" ' +
            'style="margin-right:6px;">' + esc(ctr('cfg.label.default')) + '</label></div>' +
            '<div style="margin-bottom:20px;">' +
            '<label style="font-size:13px;color:#555;">' +
            '<input type="checkbox" id="pm_active" checked ' +
            'style="margin-right:6px;">' + esc(ctr('cfg.label.active')) + '</label></div>' +
            '<button onclick="CFG._savePm()" style="width:100%;' +
            'padding:11px;background:#0d6efd;color:#fff;border:none;' +
            'border-radius:6px;cursor:pointer;font-size:14px;">' +
            esc(ctr('cfg.btn.saveMethod')) + '</button>' +
            '</div>';
    }

    function _openPmPanel(id) {
        _pmEditId = id || null;
        var panel = g('pmPanel');
        if (!panel) return;
        g('pmPanelTitle').textContent = id ? ctr('cfg.panel.editPayment') : ctr('cfg.panel.addPayment');

        ['pm_code','pm_name','pm_tname','pm_group','pm_surch','pm_sort']
        .forEach(function (fid) { var e = g(fid); if (e) e.value = ''; });
        var pc = g('pm_color');   if (pc) pc.value   = '#4A90D9';
        var pd = g('pm_default'); if (pd) pd.checked = false;
        var pa = g('pm_active');  if (pa) pa.checked = true;

        if (id) {
            SB.from('bill_types').select('*').eq('id', id).single()
            .then(function (r) {
                var d = r.data || {};
                if (g('pm_code'))    g('pm_code').value    = d.type_code     || '';
                if (g('pm_name'))    g('pm_name').value    = d.name          || '';
                if (g('pm_tname'))   g('pm_tname').value   = d.type_name     || '';
                if (g('pm_group'))   g('pm_group').value   = d.type_group    || '';
                if (g('pm_surch'))   g('pm_surch').value   = d.surcharge_pct || '';
                if (g('pm_sort'))    g('pm_sort').value    = d.sort_order    || '';
                if (g('pm_color'))   g('pm_color').value   = d.color_hex     || '#4A90D9';
                if (g('pm_default')) g('pm_default').checked = !!d.is_default;
                if (g('pm_active'))  g('pm_active').checked  = !!d.is_active;
            });
        }
        panel.style.display = 'block';
    }

    function _closePmPanel() {
        var p = g('pmPanel');
        if (p) p.style.display = 'none';
        _pmEditId = null;
    }

    function _savePm() {
        var code = (g('pm_code') || {}).value.trim();
        var name = (g('pm_name') || {}).value.trim();
        if (!code || !name) { toast(ctr('cfg.msg.codeNameRequired'), true); return; }

        var payload = {
            type_code:     code,
            name:          name,
            type_name:     (g('pm_tname')   || {}).value.trim(),
            type_group:    (g('pm_group')   || {}).value.trim(),
            surcharge_pct: parseFloat((g('pm_surch') || {}).value) || 0,
            sort_order:    parseInt((g('pm_sort')   || {}).value)  || 0,
            color_hex:     (g('pm_color')   || {}).value,
            is_default:    (g('pm_default') || {}).checked === true,
            is_active:     (g('pm_active')  || {}).checked !== false
        };

        var op = _pmEditId
            ? SB.from('bill_types').update(payload).eq('id', _pmEditId)
            : SB.from('bill_types').insert(payload);

        op.then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(_pmEditId ? ctr('cfg.msg.paymentUpdated') : ctr('cfg.msg.paymentAdded'));
            _closePmPanel();
            loadPayment();
        });
    }

    function _deletePm(id, name) {
        confirm(ctrRepl('cfg.confirm.deletePayment', { NAME: name }), function () {
            SB.from('bill_types').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast(ctr('cfg.msg.paymentDeleted'));
                loadPayment();
            });
        });
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: TREATMENT ITEMS ─────────────────────────────────
    // ════════════════════════════════════════════════════════
    var _txEditId = null;

    function loadTreatment() {
        var pane = g('cfgPane-treatment');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(ctr('common.loadingEllipsis')) + '</p>';

        SB.from('treatment_items').select('*').eq('is_active', true).order('item_name')
        .then(function (r) {
            var rows = (r.data || []).slice().sort(function(a, b) {
                return String(a.item_name || '').localeCompare(String(b.item_name || ''), 'en', { sensitivity: 'base' });
            });
            var html =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">' +
                '<h2 style="margin:0;font-size:20px;">' + esc(ctr('cfg.header.treatment')) + '</h2>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                '<button onclick="CFG._renewTreatmentCatalog()" style="' +
                'padding:9px 16px;background:#6f42c1;color:#fff;' +
                'border:none;border-radius:6px;cursor:pointer;' +
                'font-size:13px;">' + esc(ctr('cfg.btn.renewTreatmentCatalog')) + '</button>' +
                '<button onclick="CFG._openTxPanel()" style="' +
                'padding:9px 20px;background:#0d6efd;color:#fff;' +
                'border:none;border-radius:6px;cursor:pointer;' +
                'font-size:13px;">' + esc(ctr('cfg.btn.addItem')) + '</button></div></div>' +
                '<div id="txList">' + renderTxCards(rows) + '</div>' +
                txPanelHTML();
            pane.innerHTML = html;
        });
    }

    function renderTxCards(rows) {
        if (!rows.length) return '<p style="color:#888;">' + esc(ctr('cfg.msg.noTreatmentItems')) + '</p>';
        return rows.map(function (d) {
            return '<div style="background:#fff;border-radius:8px;' +
                'padding:14px 18px;margin-bottom:8px;' +
                'box-shadow:0 1px 4px rgba(0,0,0,.08);' +
                'display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + esc(d.item_name) + '</strong>' +
                ' <span style="color:#888;font-size:12px;">[' + esc(d.item_code) + ']</span>' +
                (d.is_active ? '' : ' <span style="color:#dc3545;font-size:12px;">' + esc(ctr('cfg.label.inactive')) + '</span>') +
                '<div style="font-size:12px;color:#888;margin-top:3px;">' +
                (d.category || '') + (d.sub_category ? ' / ' + d.sub_category : '') +
                ' · $' + parseFloat(d.unit_price || 0).toFixed(2) +
                (d.unit ? ' / ' + d.unit : '') + '</div></div>' +
                '<div>' +
                '<button onclick="CFG._openTxPanel(\'' + d.id + '\')" style="' +
                'padding:6px 14px;background:#0d6efd;color:#fff;border:none;' +
                'border-radius:5px;cursor:pointer;font-size:12px;margin-right:6px;">' +
                esc(ctr('cfg.btn.edit')) + '</button>' +
                '<button onclick="CFG._deleteTx(\'' + d.id + '\',\'' +
                esc(d.item_name) + '\')" style="' +
                'padding:6px 14px;background:#dc3545;color:#fff;border:none;' +
                'border-radius:5px;cursor:pointer;font-size:12px;">' + esc(ctr('cfg.btn.delete')) + '</button>' +
                '</div></div>';
        }).join('');
    }

    function txPanelHTML() {
        return '<div id="txPanel" style="display:none;position:fixed;' +
            'top:0;right:0;width:400px;height:100%;background:#fff;' +
            'box-shadow:-4px 0 20px rgba(0,0,0,.15);z-index:1000;' +
            'padding:32px 28px;overflow-y:auto;box-sizing:border-box;">' +
            '<div style="display:flex;justify-content:space-between;' +
            'align-items:center;margin-bottom:24px;">' +
            '<h3 id="txPanelTitle" style="margin:0;font-size:17px;">' + esc(ctr('cfg.panel.addTreatment')) + '</h3>' +
            '<button onclick="CFG._closeTxPanel()" style="background:none;' +
            'border:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>' +
            '</div>' +
            fld('cfg.form.itemCode',   'tx_code')              +
            fld('cfg.form.itemName',   'tx_name')              +
            fld('cfg.form.category',      'tx_cat')               +
            fld('cfg.form.subCategoryDash',  'tx_subcat')            +
            fld('cfg.form.unitPrice',    'tx_price',  'number')  +
            fld('cfg.form.unit',          'tx_unit',  'text', 'cfg.form.unitPh') +
            '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">' + esc(ctr('cfg.form.colour')) + '</label>' +
            '<input type="color" id="tx_color" value="#4A90D9" ' +
            'style="width:60px;height:36px;border:1px solid #ddd;' +
            'border-radius:6px;cursor:pointer;"></div>' +
            '<div style="margin-bottom:20px;">' +
            '<label style="font-size:13px;color:#555;">' +
            '<input type="checkbox" id="tx_active" checked ' +
            'style="margin-right:6px;">' + esc(ctr('cfg.label.active')) + '</label></div>' +
            '<button onclick="CFG._saveTx()" style="width:100%;' +
            'padding:11px;background:#0d6efd;color:#fff;border:none;' +
            'border-radius:6px;cursor:pointer;font-size:14px;">' +
            esc(ctr('cfg.btn.saveItem')) + '</button>' +
            '</div>';
    }

    function _openTxPanel(id) {
        _txEditId = id || null;
        var panel = g('txPanel');
        if (!panel) return;
        g('txPanelTitle').textContent = id ? ctr('cfg.panel.editTreatment') : ctr('cfg.panel.addTreatment');

        ['tx_code','tx_name','tx_cat','tx_subcat','tx_price','tx_unit']
        .forEach(function (fid) { var e = g(fid); if (e) e.value = ''; });
        var tc = g('tx_color');  if (tc) tc.value   = '#4A90D9';
        var ta = g('tx_active'); if (ta) ta.checked = true;

        if (id) {
            SB.from('treatment_items').select('*').eq('id', id).single()
            .then(function (r) {
                var d = r.data || {};
                if (g('tx_code'))   g('tx_code').value   = d.item_code    || '';
                if (g('tx_name'))   g('tx_name').value   = d.item_name    || '';
                if (g('tx_cat'))    g('tx_cat').value    = d.category     || '';
                if (g('tx_subcat')) g('tx_subcat').value = d.sub_category || '';
                if (g('tx_price'))  g('tx_price').value  = d.unit_price   || '';
                if (g('tx_unit'))   g('tx_unit').value   = d.unit         || '';
                if (g('tx_color'))  g('tx_color').value  = d.color_hex    || '#4A90D9';
                if (g('tx_active')) g('tx_active').checked = !!d.is_active;
            });
        }
        panel.style.display = 'block';
    }

    function _closeTxPanel() {
        var p = g('txPanel');
        if (p) p.style.display = 'none';
        _txEditId = null;
    }

    function _saveTx() {
        var code = (g('tx_code') || {}).value.trim();
        var name = (g('tx_name') || {}).value.trim();
        if (!code || !name) { toast(ctr('cfg.msg.codeNameRequired'), true); return; }

        var payload = {
            item_code:    code,
            item_name:    name,
            category:     (g('tx_cat')    || {}).value.trim(),
            sub_category: (g('tx_subcat') || {}).value.trim(),
            unit_price:   parseFloat((g('tx_price') || {}).value) || 0,
            unit:         (g('tx_unit')   || {}).value.trim(),
            color_hex:    (g('tx_color')  || {}).value,
            is_active:    (g('tx_active') || {}).checked !== false
        };

        var op = _txEditId
            ? SB.from('treatment_items').update(payload).eq('id', _txEditId)
            : SB.from('treatment_items').insert(payload);

        op.then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(_txEditId ? ctr('cfg.msg.itemUpdated') : ctr('cfg.msg.itemAdded'));
            _closeTxPanel();
            loadTreatment();
        });
    }

    function _deleteTx(id, name) {
        confirm(ctrRepl('cfg.confirm.deleteTreatment', { NAME: name }), function () {
            SB.from('treatment_items').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast(ctr('cfg.msg.itemDeleted'));
                loadTreatment();
            });
        });
    }

    /**
     * Replace active treatment picker list with TREATMENT_ITEMS_CATALOG.
     * Old rows are kept in DB as inactive so historical bill line text is untouched.
     */
    function _renewTreatmentCatalog() {
        if (typeof buildTreatmentItemSeedRows !== 'function') {
            toast(ctr('cfg.msg.treatmentCatalogMissing'), true);
            return;
        }
        var seedRows = buildTreatmentItemSeedRows();
        confirm(ctrRepl('cfg.confirm.renewTreatmentCatalog', { N: String(seedRows.length) }), function () {
            toast(ctr('cfg.msg.renewTreatmentWorking'));
            SB.from('treatment_items').update({ is_active: false }).eq('is_active', true)
            .then(function(deact) {
                if (deact.error) { toast(deact.error.message, true); return null; }
                return SB.from('treatment_items').insert(seedRows);
            })
            .then(function(ins) {
                if (!ins) return;
                if (ins.error) { toast(ins.error.message, true); return; }
                toast(ctrRepl('cfg.msg.renewTreatmentDone', { N: String(seedRows.length) }));
                loadTreatment();
            })
            .catch(function(e) {
                toast(String(e && e.message ? e.message : e), true);
            });
        });
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: PROGRAM SETTINGS ────────────────────────────────
    // ════════════════════════════════════════════════════════
    var SETTING_KEYS = [
        { key: 'patient_no_prefix',        labelKey: 'cfg.setting.patientNoPrefix',        type: 'text'     },
        { key: 'patient_no_digits',         labelKey: 'cfg.setting.patientNoDigits',        type: 'number'   },
        { key: 'auto_generate_patient_code',labelKey: 'cfg.setting.autoPatientCode',        type: 'checkbox' },
        { key: 'appt_default_duration',     labelKey: 'cfg.setting.apptDuration',           type: 'number'  },
        { key: 'currency_symbol',           labelKey: 'cfg.setting.currencySymbol',         type: 'text'     },
        { key: 'default_dentist',           labelKey: 'cfg.setting.defaultDentist',         type: 'text'     },
        { key: 'default_patient_female',    labelKey: 'cfg.setting.defaultFemale',          type: 'checkbox' },
        { key: 'zero_ar',                   labelKey: 'cfg.setting.zeroAr',                 type: 'checkbox' },
        { key: 'lock_medical_notes',        labelKey: 'cfg.setting.lockMedNotes',           type: 'checkbox' },
        { key: 'modify_medical_notes',      labelKey: 'cfg.setting.modifyMedNotes',         type: 'checkbox' },
        { key: 'add_medical_term',          labelKey: 'cfg.setting.addMedTerm',             type: 'checkbox' },
        { key: 'audit_trail',               labelKey: 'cfg.setting.auditTrail',             type: 'checkbox' },
        { key: 'login_timeout_minutes',     labelKey: 'cfg.setting.loginTimeout',           type: 'number'   },
        { key: 'queue_refresh_interval',    labelKey: 'cfg.setting.queueRefresh',           type: 'number'   },
        { key: 'bill_pending_refresh_interval', labelKey: 'cfg.setting.billPendingRefresh', type: 'number'   },
        { key: 'receipt_header',            labelKey: 'cfg.setting.receiptHeader',          type: 'textarea' },
        { key: 'receipt_footer',            labelKey: 'cfg.setting.receiptFooter',          type: 'textarea' },
        { key: 'smtp_email',               labelKey: 'cfg.setting.smtpEmail',               type: 'text'     },
        { key: 'sms_config',               labelKey: 'cfg.setting.smsConfig',               type: 'text'     }
    ];

    function loadSettings() {
        // Must match index.html pane id="cfgPane-program"
        var pane = g('cfgPane-program');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(ctr('common.loadingEllipsis')) + '</p>';

        SB.from('program_settings').select('setting_key,setting_value')
        .then(function (r) {
            if (r.error) {
                pane.innerHTML = '<p style="color:#dc3545;padding:8px 0;line-height:1.5;">' +
                    esc(r.error.message) + '</p>';
                toast(r.error.message, true);
                return;
            }

            var map = {};
            (r.data || []).forEach(function (row) {
                map[row.setting_key] = row.setting_value;
            });

            var html = '<h2 style="margin:0 0 24px;font-size:20px;">' +
                esc(ctr('cfg.header.program')) + '</h2>' +
                '<div style="max-width:600px;">';

            SETTING_KEYS.forEach(function (s) {
                var val = map[s.key] !== undefined ? map[s.key] : '';
                html += '<div style="margin-bottom:16px;">' +
                    '<label style="display:block;font-size:13px;color:#555;' +
                    'margin-bottom:4px;">' + esc(ctr(s.labelKey)) + '</label>';

                if (s.type === 'checkbox') {
                    html += '<input type="checkbox" id="set_' + s.key + '" ' +
                        (val === 'true' ? 'checked' : '') + '>';
                } else if (s.type === 'textarea') {
                    html += '<textarea id="set_' + s.key + '" rows="3" style="' +
                        inputStyle() + '">' + esc(val) + '</textarea>';
                } else {
                    html += '<input type="' + s.type + '" id="set_' + s.key +
                        '" value="' + esc(val) + '" style="' + inputStyle() + '">';
                }
                if (s.key === 'bill_pending_refresh_interval') {
                    html += '<div style="font-size:12px;color:#888;margin-top:4px;">' +
                        esc(ctr('cfg.setting.billPendingRefreshHint')) +
                        '</div>';
                }
                html += '</div>';
            });

            html += '<button onclick="CFG._saveSettings()" style="' +
                'margin-top:8px;padding:10px 28px;background:#0d6efd;' +
                'color:#fff;border:none;border-radius:6px;' +
                'cursor:pointer;font-size:14px;">' + esc(ctr('cfg.btn.saveSettings')) + '</button>' +
                '</div>';

            pane.innerHTML = html;
        })
        .catch(function (err) {
            pane.innerHTML = '<p style="color:#dc3545;padding:8px 0;line-height:1.5;">' +
                esc((err && err.message) ? String(err.message) : String(err)) + '</p>';
            try {
                toast((err && err.message) ? String(err.message) : String(err), true);
            } catch (_) {}
        });
    }

    /** PATCH by key, then INSERT if no row matched — avoids bulk upsert/onConflict mismatches vs DB constraints. */
    function _persistProgramSettingRow(row) {
        return SB.from('program_settings')
            .update({ setting_value: row.setting_value })
            .eq('setting_key', row.setting_key)
            .select('setting_key')
            .then(function (up) {
                if (up.error) return up;
                if (up.data && up.data.length) return up;
                return SB.from('program_settings').insert([row])
                    .then(function (ins) { return ins; });
            });
    }

    function _saveSettings() {
        if (!SB || typeof SB.from !== 'function') {
            toast('Database client is not available.', true);
            return;
        }
        var upserts = SETTING_KEYS.map(function (s) {
            var el  = g('set_' + s.key);
            var val = el
                ? (s.type === 'checkbox' ? String(el.checked) : el.value)
                : '';
            return { setting_key: s.key, setting_value: val };
        });

        Promise.all(upserts.map(function (row) { return _persistProgramSettingRow(row); }))
            .then(function (results) {
                var msg = '';
                for (var i = 0; i < results.length; i++) {
                    if (results[i] && results[i].error) {
                        msg = results[i].error.message ? String(results[i].error.message) : String(results[i].error);
                        break;
                    }
                }
                if (msg) {
                    toast(msg, true);
                    return;
                }
                toast(ctr('cfg.msg.settingsSaved'));
                if (typeof restartApptAutoRefresh === 'function') {
                    restartApptAutoRefresh();
                }
                if (typeof restartBillPendingAutoRefresh === 'function') {
                    restartBillPendingAutoRefresh();
                }
            })
            .catch(function (err) {
                try {
                    toast((err && err.message) ? String(err.message) : String(err), true);
                } catch (_) {}
            });
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: USERS ───────────────────────────────────────────
    // ════════════════════════════════════════════════════════
    var _usrEditId = null;
    var _usrClinics = [];
    var _usrDoctors = [];
    var CFG_ADMIN_DEFAULT_PW = '1234';
    var _usrAuthBound = false;

    function userAuthLabelKey(key) {
        return 'cfg.auth.' + key;
    }

    function userAuthIndentStyle(parentKey) {
        if (!parentKey) return '';
        return 'padding-left:22px;';
    }

    function renderUserAuthPanelHTML() {
        var cols = [[], [], []];
        USER_PERM_REGISTRY.forEach(function (def) {
            var col = def.col >= 0 && def.col <= 2 ? def.col : 0;
            cols[col].push(def);
        });
        var chkStyle =
            'display:flex;align-items:flex-start;gap:6px;font-size:12px;' +
            'color:#333;font-weight:600;margin:4px 0;cursor:pointer;line-height:1.35;';
        var html =
            '<div id="usr_auth_section" style="margin-top:14px;padding-top:12px;border-top:1px solid #eef2f7;">' +
              '<div style="font-size:13px;font-weight:900;color:#0d6efd;margin-bottom:8px;" ' +
                'data-i18n="cfg.auth.sectionTitle"></div>' +
              '<div style="font-size:11px;color:#888;margin-bottom:10px;" data-i18n="cfg.auth.sectionHint"></div>' +
              '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 18px;">';
        for (var c = 0; c < 3; c++) {
            html += '<div class="cfg-user-auth-col">';
            cols[c].forEach(function (def) {
                var indent = userAuthIndentStyle(def.parent);
                html +=
                  '<label style="' + chkStyle + indent + '">' +
                    '<input type="checkbox" class="cfg-user-auth-chk" data-auth-key="' + esc(def.key) + '" ' +
                      (def.parent ? 'data-auth-parent="' + esc(def.parent) + '"' : '') +
                      ' style="margin-top:2px;flex-shrink:0;">' +
                    '<span data-i18n="' + esc(userAuthLabelKey(def.key)) + '"></span>' +
                  '</label>';
            });
            html += '</div>';
        }
        html += '</div></div>';
        return html;
    }

    function applyPermissionsToUserPanel(perms) {
        var merged = mergeUserPermissionsForEdit(perms);
        var panel = g('cfgUserPanel');
        if (!panel) return;
        panel.querySelectorAll('.cfg-user-auth-chk').forEach(function (el) {
            var key = el.getAttribute('data-auth-key');
            el.checked = merged[key] !== false;
        });
    }

    function collectPermissionsFromUserPanel() {
        var out = defaultUserPermissionsAllOn();
        var panel = g('cfgUserPanel');
        if (!panel) return out;
        panel.querySelectorAll('.cfg-user-auth-chk').forEach(function (el) {
            var key = el.getAttribute('data-auth-key');
            if (key) out[key] = el.checked === true;
        });
        return out;
    }

    function bindUserAuthPanelEvents() {
        if (_usrAuthBound) return;
        var panel = g('cfgUserPanel');
        if (!panel) return;
        _usrAuthBound = true;
        panel.addEventListener('change', function (e) {
            var t = e.target;
            if (!t || !t.classList || !t.classList.contains('cfg-user-auth-chk')) return;
            var key = t.getAttribute('data-auth-key');
            if (!key) return;
            if (t.checked) {
                var parentKey = t.getAttribute('data-auth-parent');
                while (parentKey) {
                    var pel = panel.querySelector('.cfg-user-auth-chk[data-auth-key="' + parentKey + '"]');
                    if (pel) pel.checked = true;
                    var pdef = USER_PERM_REGISTRY.find(function (d) { return d.key === parentKey; });
                    parentKey = pdef && pdef.parent ? pdef.parent : '';
                }
                return;
            }
            panel.querySelectorAll('.cfg-user-auth-chk[data-auth-parent="' + key + '"]').forEach(function (child) {
                child.checked = false;
                var childKey = child.getAttribute('data-auth-key');
                if (childKey) {
                    panel.querySelectorAll('.cfg-user-auth-chk[data-auth-parent="' + childKey + '"]')
                        .forEach(function (gc) { gc.checked = false; });
                }
            });
        });
    }

    function _cfgUsrField(fid) {
        var panel = g('cfgUserPanel');
        if (panel) {
            var el = panel.querySelector('#' + fid);
            if (el) return el;
        }
        return g(fid);
    }

    function cfgSv(fid, val) {
        var el = _cfgUsrField(fid);
        if (el && val !== undefined) el.value = val;
    }

    function cfgSvGet(fid) {
        var el = _cfgUsrField(fid);
        return el ? el.value : '';
    }

    function mountCfgUserPanel() {
        if (g('cfgUserPanel')) return;
        var mount = document.createElement('div');
        mount.id = 'cfgUserPanelMount';
        mount.style.cssText = 'margin:12px 0 0;max-width:1100px;';
        mount.innerHTML = userPanelHTML();
        var usersPane = g('cfgPane-users');
        if (usersPane && usersPane.parentNode) {
            usersPane.parentNode.insertBefore(mount, usersPane.nextSibling);
        }
    }

    function loadUsers() {
        var pane = g('cfgPane-users');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(ctr('common.loadingEllipsis')) + '</p>';

        Promise.all([
            SB.from('clinics').select('id,clinic_code,english_name').order('clinic_code'),
            SB.from('doctors').select('id,doctor_code,english_name,is_active').order('doctor_code'),
            SB.from('app_users').select('*').order('user_id')
        ]).then(function (all) {
            _usrClinics = (all[0] && all[0].data) ? all[0].data : [];
            _usrDoctors = (all[1] && all[1].data) ? all[1].data.filter(function (d) { return d.is_active !== false; }) : [];
            var usersRes = all[2] || {};
            var allRows = usersRes.data || [];
            var rows = allRows;

            var html =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
                  '<div>' +
                    '<h2 style="margin:0;font-size:20px;">' + esc(ctr('cfg.header.users')) + '</h2>' +
                    '<div style="font-size:12px;color:#888;margin-top:4px;">' +
                      esc(ctr('cfg.users.hint')) +
                    '</div>' +
                  '</div>' +
                  '<button class="btn btn--secondary" onclick="CFG._openAdminUserPanel()" style="margin-right:8px;">' +
                    esc(ctr('cfg.btn.addAdmin')) +
                  '</button>' +
                  '<button class="btn btn--primary" onclick="CFG._openUserPanel()">' +
                    esc(ctr('cfg.btn.addUser')) +
                  '</button>' +
                '</div>' +
                '<div style="margin-top:12px;">' +
                  renderUsersTable(rows) +
                '</div>';

            pane.innerHTML = html;
            mountCfgUserPanel();
        }).catch(function (e) {
            pane.innerHTML = '<p style="color:#dc3545;">' + esc(ctrRepl('appt.msg.error', { MSG: e.message })) + '</p>';
        });
    }

    function renderUsersTable(rows) {
        if (!rows.length) {
            return '<div style="background:#fff;border:1px dashed #d7d7d7;border-radius:10px;' +
                'padding:18px;color:#888;text-align:center;">' + esc(ctr('cfg.msg.noUsersFound')) + '</div>';
        }

        var TH = 'padding:11px 12px;text-align:left;font-size:12px;font-weight:800;' +
            'color:#0d6efd;border-bottom:2px solid #dde8f5;text-transform:uppercase;' +
            'letter-spacing:.4px;white-space:nowrap;';
        var TD = 'padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:middle;';

        function doctorLabel(id) {
            var d = _usrDoctors.find(function (x) { return x.id === id; });
            if (!d) return '-';
            return (typeof doctorDisplayName === 'function')
                ? (doctorDisplayName(d) || ctr('cfg.label.doctorFallback'))
                : (d.english_name || d.chinese_name || ctr('cfg.label.doctorFallback'));
        }

        var html =
            '<div style="background:#fff;border-radius:10px;overflow:hidden;' +
            'box-shadow:0 1px 4px rgba(0,0,0,.08);">' +
            '<table style="width:100%;border-collapse:collapse;">' +
            '<thead><tr style="background:#f0f7ff;">' +
              '<th style="' + TH + 'width:160px;">' + esc(ctr('cfg.th.userId')) + '</th>' +
              '<th style="' + TH + 'width:110px;">' + esc(ctr('cfg.th.password')) + '</th>' +
              '<th style="' + TH + 'width:130px;">' + esc(ctr('cfg.th.role')) + '</th>' +
              '<th style="' + TH + '">' + esc(ctr('cfg.th.doctorIdentity')) + '</th>' +
              '<th style="' + TH + 'width:90px;text-align:center;">' + esc(ctr('cfg.label.active')) + '</th>' +
              '<th style="' + TH + 'width:170px;text-align:center;">' + esc(ctr('cfg.th.actions')) + '</th>' +
            '</tr></thead><tbody>';

        rows.forEach(function (u) {
            var active = u.is_active !== false;
            html +=
              '<tr onmouseover="this.style.background=\'#f5f9ff\'" ' +
              'onmouseout="this.style.background=\'#fff\'">' +
                '<td style="' + TD + 'font-weight:900;color:#0d6efd;">' + esc(u.user_id || '-') + '</td>' +
                '<td style="' + TD + '">' +
                  '<input type="text" data-user-id="' + esc(u.id) + '" value="' + esc(u.password || '') + '" ' +
                  'onchange="CFG._saveUserPassword(this)" title="' + esc(ctr('cfg.title.editPassword')) + '" ' +
                  'style="width:96px;padding:5px 8px;border:1px solid #ccc;border-radius:5px;font-size:12px;font-family:monospace;">' +
                '</td>' +
                '<td style="' + TD + '">' + esc(dispCfgUserRole(u.role)) + '</td>' +
                '<td style="' + TD + '">' + esc(doctorLabel(u.doctor_id)) + '</td>' +
                '<td style="' + TD + 'text-align:center;">' +
                  (active
                    ? '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#d4edda;color:#155724;font-size:11px;font-weight:800;">' + esc(ctr('cfg.tpl.yes')) + '</span>'
                    : '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#f8d7da;color:#721c24;font-size:11px;font-weight:800;">' + esc(ctr('cfg.tpl.no')) + '</span>') +
                '</td>' +
                '<td style="' + TD + 'text-align:center;">' +
                  '<button onclick="CFG._openUserPanel(\'' + esc(u.id) + '\')" ' +
                    'style="padding:6px 12px;background:#0d6efd;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:800;margin-right:6px;">' + esc(ctr('cfg.btn.edit')) + '</button>' +
                  '<button onclick="CFG._deleteUser(\'' + esc(u.id) + '\',\'' + esc(u.user_id) + '\')" ' +
                    'style="padding:6px 12px;background:#dc3545;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:800;">' + esc(ctr('cfg.btn.delete')) + '</button>' +
                '</td>' +
              '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function userPanelHTML() {
        function opt(list, getLabel) {
            return '<option value="">' + esc(ctr('cfg.form.selectPh')) + '</option>' + list.map(function (x) {
                return '<option value="' + esc(x.id) + '">' + esc(getLabel(x)) + '</option>';
            }).join('');
        }
        var clinicOpts = opt(_usrClinics, function (c) {
            return (typeof clinicDisplayName === 'function')
                ? clinicDisplayName(c)
                : (c.english_name || c.chinese_name || ctr('cfg.label.clinic'));
        });
        var doctorOpts = opt(_usrDoctors, function (d) {
            return (typeof doctorDisplayName === 'function')
                ? (doctorDisplayName(d) || ctr('cfg.label.doctorFallback'))
                : (d.english_name || d.chinese_name || ctr('cfg.label.doctorFallback'));
        });

        return '' +
          '<div id="cfgUserPanel" style="display:none;">' +
            '<div style="background:#fff;border-radius:12px;border:1px solid #eef2f7;' +
              'box-shadow:0 1px 4px rgba(0,0,0,.08);padding:14px 14px 12px;">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
                '<div>' +
                  '<div id="cfgUserPanelTitle" style="font-size:15px;font-weight:900;color:#0d6efd;">' + esc(ctr('cfg.panel.newUser')) + '</div>' +
                  '<div style="font-size:12px;color:#888;margin-top:2px;">' + esc(ctr('cfg.users.panelHint')) + '</div>' +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                  '<button class="btn btn--ghost" onclick="CFG._closeUserPanel()">' + esc(ctr('cfg.btn.close')) + '</button>' +
                  '<button class="btn btn--primary" onclick="CFG._saveUser()">' + esc(ctr('cfg.btn.save')) + '</button>' +
                '</div>' +
              '</div>' +

              '<div style="display:grid;grid-template-columns:220px 220px 1fr;gap:10px;margin-top:12px;">' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">' + esc(ctr('cfg.form.userIdRequired')) + '</label>' +
                  '<input id="usr_user_id" style="' + inputStyle() + '">' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">' + esc(ctr('cfg.form.passwordRequired')) + '</label>' +
                  '<input id="usr_password" type="text" style="' + inputStyle() + '" placeholder="' + esc(ctr('cfg.form.passwordAdminPh')) + '">' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">' + esc(ctr('cfg.th.displayName')) + '</label>' +
                  '<input id="usr_display_name" style="' + inputStyle() + '" placeholder="' + esc(ctr('cfg.form.displayNameOptionalPh')) + '">' +
                '</div>' +
              '</div>' +

              '<div style="display:grid;grid-template-columns:220px 1fr 1fr;gap:10px;margin-top:10px;">' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">' + esc(ctr('cfg.th.role')) + '</label>' +
                  '<select id="usr_role" onchange="CFG._onUserRoleChange()" style="' + inputStyle() + '">' +
                    cfgUserRoleSelectHTML() +
                  '</select>' +
                '</div>' +
                '<div id="usr_doctor_wrap">' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">' + esc(ctr('cfg.form.doctorIdentityLogin')) + '</label>' +
                  '<select id="usr_doctor_id" style="' + inputStyle() + '">' +
                    doctorOpts +
                  '</select>' +
                '</div>' +
              '</div>' +

              '<div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;">' +
                '<label style="font-size:12px;color:#555;font-weight:900;">' +
                  '<input id="usr_active" type="checkbox" checked style="margin-right:6px;">' + esc(ctr('cfg.label.active')) +
                '</label>' +
                '<span style="color:#ddd;">|</span>' +
                '<button class="btn btn--secondary" onclick="CFG._ensureNurseLogin()">' +
                  esc(ctr('cfg.btn.ensureNurseLogin')) +
                '</button>' +
              '</div>' +
              renderUserAuthPanelHTML() +
            '</div>' +
          '</div>';
    }

    function _openUserPanel(id) {
        mountCfgUserPanel();
        _usrEditId = id || null;
        var panel = g('cfgUserPanel');
        if (!panel) {
            toast(ctr('cfg.msg.userFormNotReady'), true);
            return;
        }
        panel.style.display = 'block';
        if (panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        var titleEl = g('cfgUserPanelTitle');
        if (titleEl) titleEl.textContent = id ? ctr('cfg.panel.editUser') : ctr('cfg.panel.newUser');

        cfgSv('usr_user_id', '');
        cfgSv('usr_password', '');
        cfgSv('usr_display_name', '');
        cfgSv('usr_role', 'staff');
        cfgSv('usr_doctor_id', '');
        var act = _cfgUsrField('usr_active');
        if (act) act.checked = true;
        _syncUserRoleFields();
        applyPermissionsToUserPanel(null);
        bindUserAuthPanelEvents();
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(panel);

        if (!id) return;

        SB.from('app_users').select('*').eq('id', id).single()
        .then(function (r) {
            var u = r.data || {};
            cfgSv('usr_user_id', u.user_id || '');
            cfgSv('usr_password', u.password || '');
            cfgSv('usr_display_name', u.display_name || '');
            cfgSv('usr_role', u.role || 'staff');
            cfgSv('usr_doctor_id', u.doctor_id || '');
            var act2 = _cfgUsrField('usr_active');
            if (act2) act2.checked = u.is_active !== false;
            _syncUserRoleFields();
            applyPermissionsToUserPanel(u.permissions);
        });
    }

    function _closeUserPanel() {
        var panel = g('cfgUserPanel');
        if (panel) panel.style.display = 'none';
        _usrEditId = null;
    }

    function _saveUserPassword(inputEl) {
        if (!inputEl) return;
        var id = inputEl.getAttribute('data-user-id');
        var pw = (inputEl.value || '').trim();
        if (!id || !pw) {
            toast(ctr('cfg.msg.passwordEmpty'), true);
            return;
        }
        SB.from('app_users').update({ password: pw }).eq('id', id)
        .then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(ctr('cfg.msg.passwordSaved'));
        });
    }

    function _saveUser() {
        mountCfgUserPanel();
        var userId = cfgSvGet('usr_user_id').trim();
        var pw = cfgSvGet('usr_password');
        if (!userId || !pw) { toast(ctr('cfg.msg.userIdPasswordRequired'), true); return; }

        var roleVal = cfgSvGet('usr_role') || 'staff';
        var actEl = _cfgUsrField('usr_active');
        var payload = {
            user_id: userId,
            password: pw,
            display_name: cfgSvGet('usr_display_name').trim() || null,
            role: roleVal,
            clinic_id: null,
            doctor_id: roleVal === 'admin'
                ? null
                : (cfgSvGet('usr_doctor_id') || null),
            is_active: actEl ? actEl.checked !== false : true,
            permissions: collectPermissionsFromUserPanel()
        };

        var op = _usrEditId
            ? SB.from('app_users').update(payload).eq('id', _usrEditId)
            : SB.from('app_users').insert([payload]);

        op.then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(_usrEditId ? ctr('cfg.msg.userUpdated') : ctr('cfg.msg.userAdded'));
            _closeUserPanel();
            loadUsers();
            if (_docSelectedClinicId) loadDoctors();
        });
    }

    function _deleteUser(id, userId) {
        confirm(ctrRepl('cfg.confirm.deleteUser', { ID: userId }), function () {
            SB.from('app_users').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast(ctr('cfg.msg.userDeleted'));
                loadUsers();
                if (_docSelectedClinicId) loadDoctors();
            });
        });
    }

    function _ensureNurseLogin() {
        var payload = {
            user_id: 'nurse',
            password: 'nurse',
            role: 'nurse',
            display_name: 'Nurse',
            is_active: true
        };
        SB.from('app_users')
          .upsert([payload], { onConflict: 'user_id' })
        .then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(ctr('cfg.msg.nurseLoginEnsured'));
            loadUsers();
        });
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: TEMPLATES ───────────────────────────────────────
    // ════════════════════════════════════════════════════════
    var _tplEditId = null;
    var _tplRowsCache = [];

    var TEMPLATE_PLACEHOLDERS = [
        { labelKey: 'cfg.tpl.ph.patientNo', tag: '{patient_no}' },
        { labelKey: 'cfg.tpl.ph.patientName', tag: '{patient_name}' },
        { labelKey: 'cfg.tpl.ph.patientPhone', tag: '{patient_phone}' },
        { labelKey: 'cfg.tpl.ph.patientHkid', tag: '{patient_hkid}' },
        { labelKey: 'cfg.tpl.ph.patientDob', tag: '{patient_dob}' },
        { labelKey: 'cfg.tpl.ph.doctor', tag: '{doctor_name}' },
        { labelKey: 'cfg.tpl.ph.clinic', tag: '{clinic_name}' },
        { labelKey: 'cfg.tpl.ph.date', tag: '{date}' },
        { labelKey: 'cfg.tpl.ph.time', tag: '{time}' },
        { labelKey: 'cfg.tpl.ph.receiptNo', tag: '{receipt_no}' },
        { labelKey: 'cfg.tpl.ph.total', tag: '{total_amount}' }
    ];

    var SEED_TEMPLATES = [
        {
            nameKey: 'cfg.tpl.seed.simpleReceipt',
            contentKey: 'cfg.tpl.seed.simpleReceiptHtml',
            type: 'receipt'
        },
        {
            nameKey: 'cfg.tpl.seed.prescriptionHeader',
            contentKey: 'cfg.tpl.seed.prescriptionHeaderHtml',
            type: 'prescription'
        },
        {
            nameKey: 'cfg.tpl.seed.consentStarter',
            contentKey: 'cfg.tpl.seed.consentStarterHtml',
            type: 'consent'
        }
    ];

    function loadTemplates() {
        var pane = g('cfgPane-templates');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(ctr('common.loadingEllipsis')) + '</p>';

        SB.from('doc_templates').select('*').order('template_code')
        .then(function (r) {
            var rows = r.data || [];
            _tplRowsCache = rows;
            var html =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin:0 0 12px;">' +
                '<div>' +
                  '<h2 style="margin:0;font-size:20px;">' + esc(ctr('cfg.header.templates')) + '</h2>' +
                  '<div style="font-size:12px;color:#888;margin-top:4px;">' +
                    esc(ctr('cfg.tpl.tip')) +
                  '</div>' +
                '</div>' +
                '<div style="display:flex;gap:10px;align-items:center;">' +
                  '<input id="tplSearch" placeholder="' + esc(ctr('cfg.tpl.searchPh')).replace(/"/g, '&quot;') + '" ' +
                  'oninput="CFG._filterTemplates(this.value)" ' +
                  'style="width:240px;padding:9px 10px;border:1px solid #ddd;' +
                  'border-radius:8px;font-size:13px;">' +
                  '<button onclick="CFG._openTplEditor()" style="' +
                  'padding:9px 18px;background:#0d6efd;color:#fff;' +
                  'border:none;border-radius:8px;cursor:pointer;' +
                  'font-size:13px;font-weight:700;">' + esc(ctr('cfg.btn.addTemplate')) + '</button>' +
                '</div>' +
                '</div>' +
                tplEditorHTML() +
                '<div id="tplListRegion" style="margin-top:14px;">' +
                  renderTplTable(rows) +
                '</div>';
            pane.innerHTML = html;
        });
    }

    function renderTplTable(rows) {
        if (!rows.length) {
            return '<div style="background:#fff;border:1px dashed #d7d7d7;border-radius:10px;' +
                'padding:22px;color:#888;text-align:center;">' + esc(ctr('cfg.tpl.noTemplates')) + '</div>';
        }

        var TH = 'padding:11px 12px;text-align:left;font-size:12px;font-weight:800;' +
            'color:#0d6efd;border-bottom:2px solid #dde8f5;text-transform:uppercase;' +
            'letter-spacing:.4px;white-space:nowrap;';

        var TD = 'padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;' +
            'vertical-align:middle;';

        var html =
            '<div style="background:#fff;border-radius:10px;overflow:hidden;' +
            'box-shadow:0 1px 4px rgba(0,0,0,.08);">' +
            '<table style="width:100%;border-collapse:collapse;">' +
            '<thead><tr style="background:#f0f7ff;">' +
            '<th style="' + TH + 'width:160px;">' + esc(ctr('cfg.tpl.thCode')) + '</th>' +
            '<th style="' + TH + '">' + esc(ctr('cfg.tpl.thName')) + '</th>' +
            '<th style="' + TH + 'width:140px;">' + esc(ctr('cfg.tpl.thType')) + '</th>' +
            '<th style="' + TH + 'width:90px;text-align:center;">' + esc(ctr('cfg.label.active')) + '</th>' +
            '<th style="' + TH + 'width:160px;text-align:center;">' + esc(ctr('cfg.th.actions')) + '</th>' +
            '</tr></thead><tbody>';

        rows.forEach(function (t) {
            var active = (t.is_active !== false);
            var type = t.template_type || '';
            html +=
                '<tr style="cursor:pointer;" ' +
                'onmouseover="this.style.background=\'#f5f9ff\'" ' +
                'onmouseout="this.style.background=\'#fff\'" ' +
                'onclick="CFG._openTplEditor(\'' + t.id + '\')">' +
                '<td style="' + TD + 'font-weight:800;color:#0d6efd;">' + esc(t.template_code || '-') + '</td>' +
                '<td style="' + TD + '">' + esc(t.template_name || '-') + '</td>' +
                '<td style="' + TD + 'color:#555;">' + esc(dispCfgTplType(type)) + '</td>' +
                '<td style="' + TD + 'text-align:center;">' +
                    (active
                        ? '<span style="display:inline-block;padding:3px 10px;border-radius:999px;' +
                          'background:#d4edda;color:#155724;font-size:11px;font-weight:800;">' + esc(ctr('cfg.tpl.yes')) + '</span>'
                        : '<span style="display:inline-block;padding:3px 10px;border-radius:999px;' +
                          'background:#f8d7da;color:#721c24;font-size:11px;font-weight:800;">' + esc(ctr('cfg.tpl.no')) + '</span>') +
                '</td>' +
                '<td style="' + TD + 'text-align:center;">' +
                    '<button onclick="event.stopPropagation();CFG._openTplEditor(\'' + t.id + '\')" ' +
                    'style="padding:6px 12px;background:#0d6efd;color:#fff;border:none;border-radius:7px;' +
                    'cursor:pointer;font-size:12px;font-weight:700;margin-right:6px;">' + esc(ctr('cfg.btn.edit')) + '</button>' +
                    '<button onclick="event.stopPropagation();CFG._deleteTpl(\'' + t.id + '\',\'' + esc(t.template_name) + '\')" ' +
                    'style="padding:6px 12px;background:#dc3545;color:#fff;border:none;border-radius:7px;' +
                    'cursor:pointer;font-size:12px;font-weight:700;">' + esc(ctr('cfg.btn.delete')) + '</button>' +
                '</td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function tplEditorHTML() {
        var phBtns = TEMPLATE_PLACEHOLDERS.map(function (p) {
            var tip = ctr(p.labelKey);
            return '<button type="button" onclick="CFG._insertTplTag(\'' + esc(p.tag) + '\')" ' +
                'title="' + esc(tip) + '" ' +
                'style="padding:6px 10px;border:1px solid #d6e7ff;background:#f0f7ff;' +
                'color:#0d6efd;border-radius:999px;cursor:pointer;font-size:12px;font-weight:800;">' +
                esc(p.tag) + '</button>';
        }).join(' ');

        var seedBtns = SEED_TEMPLATES.map(function (s, idx) {
            return '<button type="button" onclick="CFG._applySeedTemplate(' + idx + ')" ' +
                'style="padding:7px 10px;border:1px solid #eee;background:#fff;' +
                'border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;">' +
                esc(ctr(s.nameKey)) + '</button>';
        }).join(' ');

        return '' +
            '<div id="tplEditorWrap" style="display:none;">' +
              '<div style="max-width:980px;margin:0 auto 12px;">' +
                '<div style="background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);' +
                'border:1px solid #eef2f7;padding:16px 16px 14px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">' +
                    '<div>' +
                      '<div id="tplEditorTitle" style="font-size:15px;font-weight:900;color:#0d6efd;">' + esc(ctr('cfg.tpl.newTemplate')) + '</div>' +
                      '<div style="font-size:12px;color:#888;margin-top:2px;">' + esc(ctr('cfg.tpl.editHint')) + '</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;">' +
                      '<button type="button" onclick="CFG._closeTplEditor()" style="padding:9px 12px;background:#6c757d;' +
                      'color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;">' + esc(ctr('cfg.btn.close')) + '</button>' +
                      '<button type="button" onclick="CFG._saveTpl()" style="padding:9px 14px;background:#0d6efd;' +
                      'color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:900;">' + esc(ctr('cfg.btn.saveTemplate')) + '</button>' +
                    '</div>' +
                  '</div>' +

                  '<div style="display:grid;grid-template-columns:160px 1fr 160px;gap:10px;margin-top:12px;">' +
                    '<div>' +
                      '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">' + esc(ctr('cfg.tpl.templateCode')) + '</label>' +
                      '<input id="tpl_code" style="' + inputStyle() + '">' +
                    '</div>' +
                    '<div>' +
                      '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">' + esc(ctr('cfg.tpl.templateName')) + '</label>' +
                      '<input id="tpl_name" style="' + inputStyle() + '">' +
                    '</div>' +
                    '<div>' +
                      '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">' + esc(ctr('cfg.tpl.type')) + '</label>' +
                      '<select id="tpl_type" style="' + inputStyle() + '">' +
                        cfgTplTypeSelectHTML() +
                      '</select>' +
                    '</div>' +
                  '</div>' +

                  '<div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap;">' +
                    '<label style="font-size:12px;color:#555;font-weight:800;">' +
                      '<input type="checkbox" id="tpl_active" checked style="margin-right:6px;">' + esc(ctr('cfg.label.active')) +
                    '</label>' +
                    '<span style="color:#ddd;">|</span>' +
                    '<span style="font-size:12px;color:#555;font-weight:800;">' + esc(ctr('cfg.tpl.seedLabel')) + '</span>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + seedBtns + '</div>' +
                  '</div>' +

                  '<div style="margin-top:12px;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
                      '<div style="font-size:12px;color:#555;font-weight:800;">' + esc(ctr('cfg.tpl.placeholders')) + '</div>' +
                      '<button type="button" onclick="CFG._insertTplTag(\'{ }\')" ' +
                        'style="padding:6px 10px;border:1px solid #eee;background:#fff;border-radius:8px;' +
                        'cursor:pointer;font-size:12px;font-weight:800;">' + esc(ctr('cfg.tpl.insertCustom')) + '</button>' +
                    '</div>' +
                    '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' + phBtns + '</div>' +
                  '</div>' +

                  '<div style="margin-top:12px;">' +
                    '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:6px;">' + esc(ctr('cfg.tpl.documentHtml')) + '</label>' +
                    '<textarea id="tpl_content" rows="12" style="' + inputStyle() + 'font-family:ui-monospace,Consolas,monospace;"></textarea>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
    }

    function _openTplEditor(id) {
        _tplEditId = id || null;

        var wrap = g('tplEditorWrap');
        if (!wrap) return;
        wrap.style.display = 'block';

        var title = g('tplEditorTitle');
        if (title) title.textContent = id ? ctr('cfg.tpl.editTemplate') : ctr('cfg.tpl.newTemplate');

        // reset
        if (g('tpl_code')) g('tpl_code').value = '';
        if (g('tpl_name')) g('tpl_name').value = '';
        if (g('tpl_type')) g('tpl_type').value = 'receipt';
        if (g('tpl_content')) g('tpl_content').value = '';
        if (g('tpl_active')) g('tpl_active').checked = true;

        if (!id) {
            // focus first field for new templates
            setTimeout(function () { if (g('tpl_code')) g('tpl_code').focus(); }, 0);
            return;
        }

        SB.from('doc_templates').select('*').eq('id', id).single()
        .then(function (r) {
            var d = r.data || {};
            if (g('tpl_code'))    g('tpl_code').value    = d.template_code || '';
            if (g('tpl_name'))    g('tpl_name').value    = d.template_name || '';
            if (g('tpl_type'))    g('tpl_type').value    = d.template_type || 'receipt';
            if (g('tpl_content')) g('tpl_content').value = d.content       || '';
            if (g('tpl_active'))  g('tpl_active').checked = d.is_active !== false;
            setTimeout(function () { if (g('tpl_content')) g('tpl_content').focus(); }, 0);
        });
    }

    function _closeTplEditor() {
        var w = g('tplEditorWrap');
        if (w) w.style.display = 'none';
        _tplEditId = null;
    }

    function _saveTpl() {
        var code = (g('tpl_code') || {}).value.trim();
        var name = (g('tpl_name') || {}).value.trim();
        if (!code || !name) { toast(ctr('cfg.msg.codeNameRequired'), true); return; }

        var payload = {
            template_code: code,
            template_name: name,
            template_type: (g('tpl_type')    || {}).value.trim(),
            content:       (g('tpl_content') || {}).value,
            is_active:     (g('tpl_active')  || {}).checked !== false
        };

        var op = _tplEditId
            ? SB.from('doc_templates').update(payload).eq('id', _tplEditId)
            : SB.from('doc_templates').insert(payload);

        op.then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(_tplEditId ? ctr('cfg.msg.templateUpdated') : ctr('cfg.msg.templateAdded'));
            _closeTplEditor();
            loadTemplates();
        });
    }

    function _deleteTpl(id, name) {
        confirm(ctrRepl('cfg.confirm.deleteTemplate', { NAME: name }), function () {
            SB.from('doc_templates').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast(ctr('cfg.msg.templateDeleted'));
                loadTemplates();
            });
        });
    }

    function _insertTplTag(tag) {
        var ta = g('tpl_content');
        if (!ta) return;
        ta.focus();
        try {
            var start = ta.selectionStart || 0;
            var end   = ta.selectionEnd || 0;
            var v = ta.value || '';
            ta.value = v.slice(0, start) + tag + v.slice(end);
            var pos = start + tag.length;
            ta.selectionStart = ta.selectionEnd = pos;
        } catch (e) {
            ta.value = (ta.value || '') + tag;
        }
    }

    function _applySeedTemplate(idx) {
        var s = SEED_TEMPLATES[idx];
        if (!s) return;
        if (g('tpl_type')) g('tpl_type').value = s.type || 'receipt';
        if (g('tpl_content')) {
            g('tpl_content').value = s.contentKey ? ctr(s.contentKey) : (s.content || '');
        }
        if (g('tpl_content')) g('tpl_content').focus();
        toast(ctr('cfg.msg.seedInserted'));
    }

    function _filterTemplates(q) {
        q = String(q || '').trim().toLowerCase();
        var rows = _tplRowsCache || [];
        if (q) {
            rows = rows.filter(function (t) {
                var s = (t.template_code || '') + ' ' + (t.template_name || '') + ' ' + (t.template_type || '');
                return s.toLowerCase().indexOf(q) !== -1;
            });
        }
        var region = g('tplListRegion');
        if (region) region.innerHTML = renderTplTable(rows);
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: DATA / BACKUP ───────────────────────────────────
    // ════════════════════════════════════════════════════════
    function loadData() {
        var pane = g('cfgPane-data');
        if (!pane) return;

        pane.innerHTML =
            '<h2 style="margin:0 0 24px;font-size:20px;">' + esc(ctr('cfg.header.dataBackup')) + '</h2>' +
            '<p style="color:#555;margin-bottom:24px;">' + esc(ctr('cfg.data.exportHint')) + '</p>' +
            '<div style="display:flex;flex-wrap:wrap;gap:12px;">' +
            exportBtn(ctr('cfg.export.clinics'),         'clinics')          +
            exportBtn(ctr('cfg.export.doctors'),         'doctors')          +
            exportBtn(ctr('cfg.export.paymentMethods'), 'bill_types')       +
            exportBtn(ctr('cfg.export.treatmentItems'), 'treatment_items')  +
            exportBtn(ctr('cfg.export.patients'),        'patients')         +
            exportBtn(ctr('cfg.export.templates'),       'doc_templates')    +
            '</div>';
    }

    function exportBtn(label, table) {
        var safeLabel = String(label).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return '<button onclick="CFG._exportCSV(\'' + table + '\',\'' + safeLabel + '\')" style="padding:11px 22px;background:#0d6efd;' +
            'color:#fff;border:none;border-radius:6px;cursor:pointer;' +
            'font-size:13px;">' + esc(ctrRepl('cfg.btn.exportCsv', { LABEL: label })) + '</button>';
    }

    function _exportCSV(table, label) {
        SB.from(table).select('*')
        .then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            var rows = r.data || [];
            if (!rows.length) { toast(ctr('cfg.msg.noDataExport'), true); return; }

            var keys = Object.keys(rows[0]);
            var csv  = keys.join(',') + '\n' +
                rows.map(function (row) {
                    return keys.map(function (k) {
                        var v = row[k] === null || row[k] === undefined ? '' : row[k];
                        return '"' + String(v).replace(/"/g, '""') + '"';
                    }).join(',');
                }).join('\n');

            var blob = new Blob([csv], { type: 'text/csv' });
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href     = url;
            a.download = table + '_' + (typeof todayISO === 'function' ? todayISO() : '') + '.csv';
            a.click();
            URL.revokeObjectURL(url);
            toast(ctrRepl('cfg.msg.exported', { LABEL: label }));
        });
    }

    // ════════════════════════════════════════════════════════
    // PUBLIC API
    // ════════════════════════════════════════════════════════
        // ── Doctor Selection & Print Functions ──────────────────
        function _toggleDoctorSelect(id, checked) {
            var idx = _selectedDoctorIds.indexOf(id);
            if (checked && idx === -1)  _selectedDoctorIds.push(id);
            if (!checked && idx !== -1) _selectedDoctorIds.splice(idx, 1);
            _updateDoctorPrintBtn();
        }

        function _toggleAllDoctors(checked) {
            _selectedDoctorIds = [];
            document.querySelectorAll('.doctor-checkbox').forEach(function (cb) {
                cb.checked = checked;
                if (checked) _selectedDoctorIds.push(cb.dataset.id);
            });
            _updateDoctorPrintBtn();
        }

        function _updateDoctorPrintBtn() {
            var btn = g('btnPrintDoctors');
            if (!btn) return;
            var n = _selectedDoctorIds.length;
            if (n > 0) {
                btn.disabled = false;
                btn.style.background = '#28a745';
                btn.style.cursor = 'pointer';
                btn.textContent = ctrRepl('cfg.btn.printSelectedN', { N: String(n) });
            } else {
                btn.disabled = true;
                btn.style.background = '#6c757d';
                btn.style.cursor = 'not-allowed';
                btn.textContent = ctr('cfg.btn.printSelected');
            }
        }

        function _printSelectedDoctors() {
            if (!_selectedDoctorIds.length) {
                toast(ctr('cfg.msg.selectDoctorPrint'), true);
                return;
            }
            SB.from('doctors').select('*').in('id', _selectedDoctorIds)
            .then(function (r) {
                if (r.error || !r.data || !r.data.length) {
                    toast(ctr('cfg.msg.errorLoadDoctor'), true); return;
                }
                var css =
                    'body{font-family:Arial,sans-serif;padding:24px;color:#222;}' +
                    'h1{color:#0d6efd;border-bottom:3px solid #0d6efd;padding-bottom:10px;font-size:20px;}' +
                    'h2{color:#0d6efd;margin:0 0 12px;font-size:16px;}' +
                    '.doc{margin-bottom:40px;page-break-after:always;}' +
                    '.doc:last-child{page-break-after:auto;}' +
                    'table{width:100%;border-collapse:collapse;margin-top:8px;}' +
                    'td{padding:9px 12px;border:1px solid #e0e0e0;font-size:13px;}' +
                    '.lbl{font-weight:700;color:#555;width:35%;background:#f7f9ff;}' +
                    '.swatch{display:inline-block;width:18px;height:18px;border-radius:50%;' +
                    'vertical-align:middle;border:1px solid #ccc;margin-right:6px;}' +
                    '@media print{body{padding:0}}';
                var body = '<h1>' + esc(cfgRptLbl('doctorTitle')) + '</h1>' +
                    '<p style="color:#888;font-size:12px;margin-bottom:28px;">' + esc(cfgRptLbl('generated')) + ' ' +
                    new Date().toLocaleString(typeof appUiLocale === 'function' ? appUiLocale() : 'en-HK') + '</p>';
                r.data.forEach(function (d) {
                    body +=
                        '<div class="doc">' +
                        '<h2>' + esc(d.english_name || d.doctor_code) +
                        (d.chinese_name ? ' (' + esc(d.chinese_name) + ')' : '') + '</h2>' +
                        '<table>' +
                        '<tr><td class="lbl">' + esc(cfgRptLbl('doctorCode')) + '</td><td>'   + esc(d.doctor_code   || '-') + '</td></tr>' +
                        '<tr><td class="lbl">' + esc(cfgRptLbl('englishName')) + '</td><td>'  + esc(d.english_name  || '-') + '</td></tr>' +
                        '<tr><td class="lbl">' + esc(cfgRptLbl('chineseName')) + '</td><td>'  + esc(d.chinese_name  || '-') + '</td></tr>' +
                        '<tr><td class="lbl">' + esc(cfgRptLbl('qualification')) + '</td><td>' + esc(d.qualification || '-') + '</td></tr>' +
                        '<tr><td class="lbl">' + esc(cfgRptLbl('telephone')) + '</td><td>'     + esc(d.tel           || '-') + '</td></tr>' +
                        '<tr><td class="lbl">' + esc(cfgRptLbl('email')) + '</td><td>'         + esc(d.email         || '-') + '</td></tr>' +
                        '<tr><td class="lbl">' + esc(cfgRptLbl('calendarColor')) + '</td><td>' +
                            '<span class="swatch" style="background:' + esc(d.color || '#aaa') + ';"></span>' +
                            esc(d.color || '-') + '</td></tr>' +
                        '<tr><td class="lbl">' + esc(cfgRptLbl('status')) + '</td><td>' +
                            (d.is_active
                                ? '<strong style="color:#28a745;">' + esc(ctr('cfg.label.active')) + '</strong>'
                                : '<strong style="color:#dc3545;">' + esc(ctr('cfg.label.inactiveStatus')) + '</strong>') +
                        '</td></tr>' +
                        '</table></div>';
                });
                var win = window.open('', '_blank', 'width=720,height=600');
                if (!win) { toast(ctr('cfg.msg.allowPopupsPrint'), true); return; }
                win.document.write(
                    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
                    '<title>' + esc(cfgRptLbl('windowDoctor')) + '</title>' +
                    '<style>' + css + '</style></head><body>' +
                    body + '</body></html>'
                );
                win.document.close();
                setTimeout(function () { win.focus(); win.print(); }, 300);
            });
        }

        // ── Clinic Selection & Print Functions ───────────────────
        function _toggleClinicSelect(id, checked) {
            var idx = _selectedClinicIds.indexOf(id);
            if (checked && idx === -1) {
                _selectedClinicIds.push(id);
            } else if (!checked && idx !== -1) {
                _selectedClinicIds.splice(idx, 1);
            }
            _updatePrintButton();
        }

        function _toggleAllClinics(checked) {
            var checkboxes = document.querySelectorAll('.clinic-checkbox');
            _selectedClinicIds = [];
            checkboxes.forEach(function(cb) {
                cb.checked = checked;
                if (checked) {
                    _selectedClinicIds.push(cb.dataset.id);
                }
            });
            _updatePrintButton();
        }

        function _updatePrintButton() {
            var btn = g('btnPrintClinics');
            if (!btn) return;
            if (_selectedClinicIds.length > 0) {
                btn.disabled = false;
                btn.style.background = '#28a745';
                btn.style.cursor = 'pointer';
                btn.textContent = ctrRepl('cfg.btn.printSelectedN', { N: String(_selectedClinicIds.length) });
            } else {
                btn.disabled = true;
                btn.style.background = '#6c757d';
                btn.style.cursor = 'not-allowed';
                btn.textContent = ctr('cfg.btn.printSelected');
            }
        }

        function _setActiveClinic(id, checked) {
            if (checked) {
                _activeClinicId = id;
                // Update all sliders
                var sliders = document.querySelectorAll('.slider');
                var checkboxes = document.querySelectorAll('.switch input[type="checkbox"]');
                checkboxes.forEach(function(cb, idx) {
                    var parentTd = cb.closest('td');
                    var row = parentTd.closest('tr');
                    var rowId = row.querySelector('.clinic-checkbox').dataset.id;
                    if (rowId === id) {
                        cb.checked = true;
                        sliders[idx].style.backgroundColor = '#28a745';
                        sliders[idx].querySelector('span').style.left = '23px';
                    } else {
                        cb.checked = false;
                        sliders[idx].style.backgroundColor = '#ccc';
                        sliders[idx].querySelector('span').style.left = '3px';
                    }
                });
                toast(ctrRepl('cfg.msg.activeClinicUpdated', { ID: id }));
            } else {
                // Don't allow unchecking without selecting another
                toast(ctr('cfg.msg.selectActiveClinicFirst'), true);
                loadClinic(); // Refresh to reset the toggle
            }
        }

        function _printSelectedClinics() {
            if (!_selectedClinicIds.length) {
                toast(ctr('cfg.msg.selectClinicPrint'), true);
                return;
            }

            SB.from('clinics').select('*')
                .in('id', _selectedClinicIds)
            .then(function(r) {
                if (r.error || !r.data || !r.data.length) {
                    toast(ctr('cfg.msg.errorLoadClinic'), true);
                    return;
                }

                var clinics = r.data;
                var printContent = '<html><head><title>' + esc(cfgRptLbl('windowClinic')) + '</title>' +
                    '<style>' +
                    'body { font-family: Arial, sans-serif; padding: 20px; }' +
                    'h1 { color: #0d6efd; border-bottom: 3px solid #0d6efd; padding-bottom: 10px; }' +
                    '.clinic { page-break-after: always; margin-bottom: 40px; }' +
                    '.clinic:last-child { page-break-after: auto; }' +
                    'h2 { color: #0d6efd; margin-top: 0; }' +
                    'table { width: 100%; border-collapse: collapse; margin-top: 20px; }' +
                    'th { background: #f0f7ff; padding: 12px; text-align: left; ' +
                    'border: 1px solid #dde8f5; font-weight: 700; }' +
                    'td { padding: 12px; border: 1px solid #e0e0e0; }' +
                    '.label { font-weight: 600; color: #555; width: 30%; }' +
                    '@media print { .no-print { display: none; } }' +
                    '</style></head><body>' +
                    '<h1>' + esc(cfgRptLbl('clinicTitle')) + '</h1>' +
                    '<p style="color:#666;margin-bottom:30px;">' + esc(cfgRptLbl('generated')) + ' ' +
                    new Date().toLocaleString(typeof appUiLocale === 'function' ? appUiLocale() : 'en-HK') + '</p>';

                clinics.forEach(function(c) {
                    printContent +=
                        '<div class="clinic">' +
                        '<h2>' + esc(c.english_name || c.clinic_code) +
                        (c.chinese_name ? ' (' + esc(c.chinese_name) + ')' : '') + '</h2>' +
                        '<table>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('clinicCode')) + '</td><td>' + esc(c.clinic_code || '-') + '</td></tr>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('englishName')) + '</td><td>' + esc(c.english_name || '-') + '</td></tr>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('chineseName')) + '</td><td>' + esc(c.chinese_name || '-') + '</td></tr>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('qualification')) + '</td><td>' + esc(c.qualification || '-') + '</td></tr>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('address')) + '</td><td>' + esc(c.address || '-') + '</td></tr>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('telephone')) + '</td><td>' + esc(c.tel || '-') + '</td></tr>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('fax')) + '</td><td>' + esc(c.fax || '-') + '</td></tr>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('openingHours')) + '</td><td>' +
                        esc(c.open_at || '-') + ' ~ ' + esc(c.close_at || '-') + '</td></tr>' +
                        '<tr><td class="label">' + esc(cfgRptLbl('apptInterval')) + '</td><td>' +
                        (c.appt_interval ? c.appt_interval + ' ' + esc(cfgRptLbl('minutes')) : '-') + '</td></tr>' +
                        '</table></div>';
                });

                printContent += '</body></html>';

                var printWindow = window.open('', '_blank');
                if (!printWindow) {
                    toast(ctr('cfg.msg.allowPopupsPrint'), true);
                    return;
                }
                printWindow.document.write(printContent);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(function() {
                    printWindow.print();
                }, 250);
            });
        }

    // ════════════════════════════════════════════════════════
    // ── TAB: PRINT SETTINGS (per clinic) ───────────────────
    // ════════════════════════════════════════════════════════
    var PRINT_LS_KEY = 'jsm_clinic_print_settings_v1';
    var PRINTERS_LS_KEY = 'jsm_known_printers_v1';
    var _cachedSystemPrinters = [];
    var _printClinics = [];
    var _printRowsByClinic = {};
    var _printEditDocType = null;

    var PRINT_DOC_TYPES = [
        { key: 'bill',           paper: 'A4',          m: { l: 10, r: 10, t: 10, b: 10 }, scale_percent: 130 },
        { key: 'drug_label',     paper: '50mm x 60mm', m: { l: 2, r: 2, t: 2, b: 2 } },
        { key: 'letters',        paper: 'A4',          m: { l: 15, r: 15, t: 15, b: 15 } },
        { key: 'report',         paper: 'A4',          m: { l: 12, r: 12, t: 12, b: 12 } },
        { key: 'charting',       paper: 'A4',          m: { l: 10, r: 10, t: 10, b: 10 } },
        { key: 'appointment',    paper: 'A4',          m: { l: 10, r: 10, t: 10, b: 10 } },
        { key: 'today_appt',     paper: 'A4',          m: { l: 10, r: 10, t: 10, b: 10 } },
        { key: 'prescription',   paper: 'A5',          m: { l: 10, r: 10, t: 10, b: 10 } },
        { key: 'patient_export', paper: 'A4',          m: { l: 10, r: 10, t: 10, b: 10 } },
        { key: 'treatment_notes', paper: 'A4',       m: { l: 12, r: 12, t: 12, b: 12 } }
    ];

    var PRINT_PAPER_DIMS_MM = {
        'A4': [210, 297],
        'A5': [148, 210],
        'Letter': [216, 279],
        '80mm roll': [80, 297],
        '50mm x 60mm': [50, 60]
    };

    function defaultPrintExtras() {
        return {
            print_logo: false,
            logo_data_url: '',
            logo_left_mm: 0,
            logo_top_mm: 0,
            logo_right_mm: 0,
            logo_bottom_mm: 0,
            header_style: 'form_a',
            header_type: 'clinic',
            font_header: 'Times New Roman|bold|14',
            font_qualification: 'Times New Roman|normal|12',
            font_address: 'Times New Roman|normal|12',
            font_doc_title: 'Times New Roman|normal|12',
            font_content: 'Times New Roman|normal|12',
            footnote_html: ''
        };
    }

    function mergePrintExtras(stored) {
        var base = defaultPrintExtras();
        if (!stored || typeof stored !== 'object') return base;
        Object.keys(base).forEach(function (k) {
            if (stored[k] !== undefined && stored[k] !== null) base[k] = stored[k];
        });
        return base;
    }

    function parsePrintFontToken(raw) {
        var s = String(raw || '').trim();
        if (!s) return { family: 'Times New Roman', bold: false, size: 12 };
        var pts = s.split('|');
        return {
            family: pts[0] || 'Times New Roman',
            bold: String(pts[1] || '').toLowerCase() === 'bold',
            size: Math.max(6, parseInt(pts[2], 10) || 12)
        };
    }

    function formatPrintFontToken(family, bold, size) {
        return String(family || 'Times New Roman').trim() + '|' +
            (bold ? 'bold' : 'normal') + '|' +
            String(Math.max(6, parseInt(size, 10) || 12));
    }

    function displayPrintFontToken(raw) {
        var f = parsePrintFontToken(raw);
        return f.family + ', ' + (f.bold ? 'Bold' : 'Regular') + ' (' + f.size + ' pt)';
    }

    function syncPrintFontDisplays(form) {
        if (!form) return;
        ['font_header', 'font_qualification', 'font_address', 'font_doc_title', 'font_content']
            .forEach(function (key) {
                var inp = form.querySelector('[name="' + key + '"]');
                var disp = g('cfgPrintFontDisp_' + key);
                if (inp && disp) disp.textContent = displayPrintFontToken(inp.value);
            });
    }

    function syncPrintPaperDimensions(form) {
        if (!form) return;
        var sel = form.querySelector('[name="paper_size"]') || g('cfgPrintPaper');
        var wEl = form.querySelector('[name="paper_width_mm"]');
        var hEl = form.querySelector('[name="paper_height_mm"]');
        if (!sel || !wEl || !hEl) return;
        var sz = String(sel.value || 'A4');
        var custom = sz === 'Custom';
        wEl.readOnly = !custom;
        hEl.readOnly = !custom;
        if (!custom && PRINT_PAPER_DIMS_MM[sz]) {
            wEl.value = PRINT_PAPER_DIMS_MM[sz][0].toFixed(2);
            hEl.value = PRINT_PAPER_DIMS_MM[sz][1].toFixed(2);
        }
    }

    function updatePrintLogoPreview(dataUrl) {
        var box = g('cfgPrintLogoPreview');
        var hidden = g('cfgPrintLogoData');
        if (hidden) hidden.value = dataUrl || '';
        if (!box) return;
        if (dataUrl) {
            box.innerHTML = '';
            var img = document.createElement('img');
            img.src = dataUrl;
            img.alt = '';
            box.appendChild(img);
            box.classList.add('has-image');
        } else {
            box.innerHTML = '';
            box.classList.remove('has-image');
        }
    }

    function readPrintExtrasFromForm(form) {
        if (!form) return defaultPrintExtras();
        function num(name, fb) {
            var el = form.querySelector('[name="' + name + '"]');
            var n = el ? parseFloat(el.value) : NaN;
            return isFinite(n) ? n : fb;
        }
        function chk(name) {
            var el = form.querySelector('[name="' + name + '"]');
            return !!(el && el.checked);
        }
        function val(name, fb) {
            var el = form.querySelector('[name="' + name + '"]');
            return el ? String(el.value || '').trim() : (fb || '');
        }
        var headerType = 'clinic';
        form.querySelectorAll('[name="header_type"]').forEach(function (r) {
            if (r.checked) headerType = r.value;
        });
        var footEl = g('cfgPrintFootnoteHtml');
        return {
            print_logo: chk('print_logo'),
            logo_data_url: val('logo_data_url', ''),
            logo_left_mm: num('logo_left_mm', 0),
            logo_top_mm: num('logo_top_mm', 0),
            logo_right_mm: num('logo_right_mm', 0),
            logo_bottom_mm: num('logo_bottom_mm', 0),
            header_style: val('header_style', 'form_a') || 'form_a',
            header_type: headerType === 'doctor' ? 'doctor' : 'clinic',
            font_header: val('font_header', defaultPrintExtras().font_header),
            font_qualification: val('font_qualification', defaultPrintExtras().font_qualification),
            font_address: val('font_address', defaultPrintExtras().font_address),
            font_doc_title: val('font_doc_title', defaultPrintExtras().font_doc_title),
            font_content: val('font_content', defaultPrintExtras().font_content),
            footnote_html: footEl ? footEl.value : val('footnote_html', '')
        };
    }

    function fillPrintExtrasForm(form, extras) {
        if (!form) return;
        extras = mergePrintExtras(extras);
        function setVal(name, val) {
            var el = form.querySelector('[name="' + name + '"]');
            if (!el) return;
            if (el.type === 'checkbox') el.checked = !!val;
            else if (el.type === 'radio') el.checked = String(el.value) === String(val);
            else el.value = val === null || val === undefined ? '' : String(val);
        }
        setVal('print_logo', extras.print_logo);
        setVal('logo_left_mm', extras.logo_left_mm);
        setVal('logo_top_mm', extras.logo_top_mm);
        setVal('logo_right_mm', extras.logo_right_mm);
        setVal('logo_bottom_mm', extras.logo_bottom_mm);
        setVal('header_style', extras.header_style);
        form.querySelectorAll('[name="header_type"]').forEach(function (r) {
            r.checked = String(r.value) === String(extras.header_type || 'clinic');
        });
        setVal('font_header', extras.font_header);
        setVal('font_qualification', extras.font_qualification);
        setVal('font_address', extras.font_address);
        setVal('font_doc_title', extras.font_doc_title);
        setVal('font_content', extras.font_content);
        updatePrintLogoPreview(extras.logo_data_url);
        var footHidden = g('cfgPrintFootnoteHtml');
        var footEdit = g('cfgPrintFootnoteEditor');
        if (footHidden) footHidden.value = extras.footnote_html || '';
        if (footEdit) footEdit.innerHTML = extras.footnote_html || '';
        syncPrintFontDisplays(form);
    }

    var _printFontEditField = null;

    function wirePrintDetailExtras(form) {
        if (!form || form.dataset.printExtrasWired === '1') return;
        form.dataset.printExtrasWired = '1';

        var paperSel = g('cfgPrintPaper');
        if (paperSel) {
            paperSel.addEventListener('change', function () {
                syncPrintPaperDimensions(form);
            });
        }

        var logoBrowse = g('cfgPrintLogoBrowseBtn');
        var logoFile = g('cfgPrintLogoFile');
        if (logoBrowse && logoFile) {
            logoBrowse.addEventListener('click', function () { logoFile.click(); });
            logoFile.addEventListener('change', function () {
                var f = logoFile.files && logoFile.files[0];
                if (!f) return;
                var reader = new FileReader();
                reader.onload = function () {
                    updatePrintLogoPreview(String(reader.result || ''));
                    var chk = g('cfgPrintLogoEnable');
                    if (chk) chk.checked = true;
                };
                reader.readAsDataURL(f);
            });
        }

        form.querySelectorAll('.cfg-print-font-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _printFontEditField = btn.getAttribute('data-font-field');
                var editor = g('cfgPrintFontEditor');
                var inp = form.querySelector('[name="' + _printFontEditField + '"]');
                if (!editor || !inp) return;
                var tok = parsePrintFontToken(inp.value);
                var fam = g('cfgPrintFontFamily');
                var sz = g('cfgPrintFontSize');
                var bld = g('cfgPrintFontBold');
                if (fam) fam.value = tok.family;
                if (sz) sz.value = tok.size;
                if (bld) bld.checked = tok.bold;
                editor.classList.remove('hidden');
            });
        });

        var fontApply = g('cfgPrintFontApplyBtn');
        if (fontApply) {
            fontApply.addEventListener('click', function () {
                if (!_printFontEditField) return;
                var inp = form.querySelector('[name="' + _printFontEditField + '"]');
                var fam = g('cfgPrintFontFamily');
                var sz = g('cfgPrintFontSize');
                var bld = g('cfgPrintFontBold');
                if (inp) {
                    inp.value = formatPrintFontToken(
                        fam ? fam.value : 'Times New Roman',
                        !!(bld && bld.checked),
                        sz ? sz.value : 12
                    );
                }
                syncPrintFontDisplays(form);
                var editor = g('cfgPrintFontEditor');
                if (editor) editor.classList.add('hidden');
                _printFontEditField = null;
            });
        }
        var fontCancel = g('cfgPrintFontCancelBtn');
        if (fontCancel) {
            fontCancel.addEventListener('click', function () {
                var editor = g('cfgPrintFontEditor');
                if (editor) editor.classList.add('hidden');
                _printFontEditField = null;
            });
        }

        var toolbar = g('cfgPrintFootnoteToolbar');
        var footEdit = g('cfgPrintFootnoteEditor');
        var footHidden = g('cfgPrintFootnoteHtml');
        if (toolbar && footEdit) {
            toolbar.querySelectorAll('button[data-cmd]').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    footEdit.focus();
                    try {
                        document.execCommand(btn.getAttribute('data-cmd'), false, null);
                    } catch (_) {}
                    if (footHidden) footHidden.value = footEdit.innerHTML;
                });
            });
            footEdit.addEventListener('input', function () {
                if (footHidden) footHidden.value = footEdit.innerHTML;
            });
        }
    }

    function defaultPrintRow(docType) {
        var def = PRINT_DOC_TYPES.find(function (d) { return d.key === docType; });
        var m = def && def.m ? def.m : { l: 10, r: 10, t: 10, b: 10 };
        return {
            doc_type:       docType,
            printer_name:   '',
            paper_size:     def ? def.paper : 'A4',
            paper_width_mm: null,
            paper_height_mm: null,
            margin_left:    m.l,
            margin_right:   m.r,
            margin_top:     m.t,
            margin_bottom:  m.b,
            orientation:    'portrait',
            scale_percent:  def && def.scale_percent != null ? Number(def.scale_percent) : 100,
            copies:         1,
            color_mode:     'color',
            fit_to_page:    true,
            show_header:    true,
            notes:          '',
            extras:         defaultPrintExtras()
        };
    }

    function mergePrintRow(docType, stored) {
        var base = defaultPrintRow(docType);
        if (!stored) return base;
        var extras = mergePrintExtras(stored.extras || stored);
        return {
            doc_type:       docType,
            printer_name:   stored.printer_name != null ? String(stored.printer_name) : base.printer_name,
            paper_size:     stored.paper_size || base.paper_size,
            paper_width_mm: stored.paper_width_mm != null ? stored.paper_width_mm : null,
            paper_height_mm: stored.paper_height_mm != null ? stored.paper_height_mm : null,
            margin_left:    stored.margin_left != null ? Number(stored.margin_left) : base.margin_left,
            margin_right:   stored.margin_right != null ? Number(stored.margin_right) : base.margin_right,
            margin_top:     stored.margin_top != null ? Number(stored.margin_top) : base.margin_top,
            margin_bottom:  stored.margin_bottom != null ? Number(stored.margin_bottom) : base.margin_bottom,
            orientation:    stored.orientation || base.orientation,
            scale_percent:  stored.scale_percent != null ? Number(stored.scale_percent) : base.scale_percent,
            copies:         stored.copies != null ? Number(stored.copies) : base.copies,
            color_mode:     stored.color_mode || base.color_mode,
            fit_to_page:    stored.fit_to_page !== false,
            show_header:    stored.show_header !== false,
            notes:          stored.notes != null ? String(stored.notes) : '',
            extras:         extras
        };
    }

    function readPrintLocalStore() {
        try {
            var raw = localStorage.getItem(PRINT_LS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function writePrintLocalStore(all) {
        try {
            localStorage.setItem(PRINT_LS_KEY, JSON.stringify(all || {}));
        } catch (e) {}
    }

    function rowsMapFromDbList(list) {
        var map = {};
        (list || []).forEach(function (row) {
            if (row && row.doc_type) map[row.doc_type] = row;
        });
        return map;
    }

    function fullRowsForClinic(storedMap) {
        return PRINT_DOC_TYPES.map(function (d) {
            return mergePrintRow(d.key, storedMap[d.key]);
        });
    }

    function loadPrintRowsForClinic(clinicId, callback) {
        if (!clinicId) {
            callback(fullRowsForClinic({}));
            return;
        }
        SB.from('clinic_print_settings')
            .select('*')
            .eq('clinic_id', clinicId)
        .then(function (r) {
            var all = readPrintLocalStore();
            var localMap = all[clinicId] || {};
            var mergedMap = {};
            if (!r.error && r.data) {
                var dbMap = rowsMapFromDbList(r.data);
                PRINT_DOC_TYPES.forEach(function (d) {
                    mergedMap[d.key] = mergePrintRow(
                        d.key,
                        Object.assign({}, localMap[d.key], dbMap[d.key])
                    );
                });
            } else {
                PRINT_DOC_TYPES.forEach(function (d) {
                    mergedMap[d.key] = mergePrintRow(d.key, localMap[d.key]);
                });
            }
            _printRowsByClinic[clinicId] = fullRowsForClinic(mergedMap);
            all[clinicId] = {};
            _printRowsByClinic[clinicId].forEach(function (row) {
                all[clinicId][row.doc_type] = row;
            });
            writePrintLocalStore(all);
            callback(_printRowsByClinic[clinicId]);
        });
    }

    function savePrintRowsForClinic(clinicId, rows, callback) {
        if (!clinicId) {
            if (callback) callback(false);
            return;
        }
        var map = {};
        rows.forEach(function (row) {
            map[row.doc_type] = row;
        });
        var all = readPrintLocalStore();
        all[clinicId] = map;
        writePrintLocalStore(all);
        _printRowsByClinic[clinicId] = rows;
        rows.forEach(function (row) {
            if (row.printer_name) addKnownPrinter(row.printer_name);
        });

        var payloads = rows.map(function (row) {
            return {
                clinic_id:       clinicId,
                doc_type:        row.doc_type,
                printer_name:    row.printer_name || '',
                paper_size:      row.paper_size || 'A4',
                paper_width_mm:  row.paper_width_mm,
                paper_height_mm: row.paper_height_mm,
                margin_left:     row.margin_left,
                margin_right:    row.margin_right,
                margin_top:      row.margin_top,
                margin_bottom:   row.margin_bottom,
                orientation:     row.orientation || 'portrait',
                scale_percent:   row.scale_percent,
                copies:          row.copies,
                color_mode:      row.color_mode || 'color',
                fit_to_page:     !!row.fit_to_page,
                show_header:     row.show_header !== false,
                notes:           row.notes || ''
            };
        });

        SB.from('clinic_print_settings')
            .upsert(payloads, { onConflict: 'clinic_id,doc_type' })
        .then(function (r) {
            if (!r.error) {
                if (callback) callback(true);
                return;
            }
            toast(r.error.message, true);
            if (callback) callback(false);
        })
        .catch(function (err) {
            try {
                toast((err && err.message) ? String(err.message) : String(err), true);
            } catch (_) {}
            if (callback) callback(false);
        });
    }

    function printDocLabel(docType) {
        var key = 'cfg.print.doc.' + docType;
        var translated = ctr(key);
        if (translated !== key) return translated;
        return docType;
    }

    function dispCfgPaperSize(raw) {
        var s = String(raw || '').trim();
        if (!s) return '—';
        if (s === 'Custom') return ctr('cfg.print.paperCustom');
        if (s === '80mm roll') return ctr('cfg.print.paper80mm');
        if (s === '50mm x 60mm') return ctr('cfg.print.paper50mm');
        var keyMap = { A4: 'cfg.print.paperA4', A5: 'cfg.print.paperA5', Letter: 'cfg.print.paperLetter' };
        if (keyMap[s]) return ctr(keyMap[s]);
        return s;
    }

    function refreshCfgPrintPaperSelect() {
        var sel = g('cfgPrintPaper');
        if (!sel) return;
        var prev = sel.value || 'A4';
        var opts = [
            { v: 'A4', k: 'cfg.print.paperA4' },
            { v: 'A5', k: 'cfg.print.paperA5' },
            { v: 'Letter', k: 'cfg.print.paperLetter' },
            { v: '80mm roll', k: 'cfg.print.paper80mm' },
            { v: '50mm x 60mm', k: 'cfg.print.paper50mm' },
            { v: 'Custom', k: 'cfg.print.paperCustom' }
        ];
        sel.innerHTML = opts.map(function (o) {
            return '<option value="' + esc(o.v) + '">' + esc(ctr(o.k)) + '</option>';
        }).join('');
        var has = false;
        var i;
        for (i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === prev) { has = true; break; }
        }
        sel.value = has ? prev : 'A4';
    }

    function renderPrintTable(rows) {
        var TH = 'padding:10px 12px;text-align:left;font-size:11px;font-weight:800;' +
            'color:#0d6efd;border-bottom:2px solid #dde8f5;text-transform:uppercase;' +
            'letter-spacing:.35px;white-space:nowrap;';
        var TD = 'padding:9px 12px;border-bottom:1px solid #eef2f7;font-size:13px;vertical-align:middle;';

        var html =
            '<div class="cfg-print-table-wrap">' +
            '<table class="cfg-print-table">' +
            '<thead><tr style="background:#f0f7ff;">' +
            '<th style="' + TH + '">' + esc(ctr('cfg.print.thDocType')) + '</th>' +
            '<th style="' + TH + '">' + esc(ctr('cfg.print.thPrinter')) + '</th>' +
            '<th style="' + TH + '">' + esc(ctr('cfg.print.thPaper')) + '</th>' +
            '<th style="' + TH + 'text-align:right;">' + esc(ctr('cfg.print.thMarginLeft')) + '</th>' +
            '<th style="' + TH + 'text-align:right;">' + esc(ctr('cfg.print.thMarginRight')) + '</th>' +
            '<th style="' + TH + 'text-align:right;">' + esc(ctr('cfg.print.thMarginTop')) + '</th>' +
            '<th style="' + TH + 'text-align:right;">' + esc(ctr('cfg.print.thMarginBottom')) + '</th>' +
            '</tr></thead><tbody>';

        rows.forEach(function (row, idx) {
            var paper;
            if (row.paper_size === 'Custom' && row.paper_width_mm && row.paper_height_mm) {
                paper = row.paper_width_mm + '×' + row.paper_height_mm + ' mm';
            } else {
                paper = dispCfgPaperSize(row.paper_size);
            }
            html +=
                '<tr class="cfg-print-row" data-doc-type="' + esc(row.doc_type) + '" data-idx="' + idx + '">' +
                '<td style="' + TD + 'font-weight:700;">' + esc(printDocLabel(row.doc_type)) + '</td>' +
                '<td style="' + TD + '">' + esc(row.printer_name || '—') + '</td>' +
                '<td style="' + TD + '">' + esc(paper) + '</td>' +
                '<td style="' + TD + 'text-align:right;">' + esc(row.margin_left) + ' mm</td>' +
                '<td style="' + TD + 'text-align:right;">' + esc(row.margin_right) + ' mm</td>' +
                '<td style="' + TD + 'text-align:right;">' + esc(row.margin_top) + ' mm</td>' +
                '<td style="' + TD + 'text-align:right;">' + esc(row.margin_bottom) + ' mm</td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function getSelectedPrintClinicId() {
        var sel = g('cfgPrintClinicSelect');
        return sel ? String(sel.value || '').trim() : '';
    }

    function refreshPrintTable() {
        var clinicId = getSelectedPrintClinicId();
        var region = g('cfgPrintTableRegion');
        if (!region) return;
        region.innerHTML = '<p style="color:#888;padding:16px;">' + esc(ctr('common.loadingEllipsis')) + '</p>';
        loadPrintRowsForClinic(clinicId, function (rows) {
            region.innerHTML = renderPrintTable(rows);
            region.querySelectorAll('.cfg-print-row').forEach(function (tr) {
                tr.addEventListener('dblclick', function () {
                    var dt = tr.getAttribute('data-doc-type');
                    var idx = parseInt(tr.getAttribute('data-idx'), 10);
                    _openPrintDetailModal(dt, rows[idx]);
                });
            });
        });
    }

    function loadPrint() {
        var pane = g('cfgPane-print');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(ctr('common.loadingEllipsis')) + '</p>';

        SB.from('clinics').select('id,clinic_code,english_name,chinese_name').order('clinic_code')
        .then(function (r) {
            _printClinics = r.data || [];
            var defaultId = (typeof currentClinicId !== 'undefined' && currentClinicId)
                ? String(currentClinicId) : '';

            var opts = '<option value="">' + esc(ctr('cfg.print.selectClinicPh')) + '</option>';
            _printClinics.forEach(function (c) {
                var label = (typeof clinicDisplayName === 'function')
                    ? clinicDisplayName(c)
                    : (c.english_name || c.chinese_name || ctr('cfg.label.clinic'));
                var sel = String(c.id) === defaultId ? ' selected' : '';
                opts += '<option value="' + esc(c.id) + '"' + sel + '>' + esc(label) + '</option>';
            });

            pane.innerHTML =
                '<div class="cfg-print-pane">' +
                '<div class="cfg-print-header">' +
                '<div>' +
                '<h2 style="margin:0;font-size:20px;">' + esc(ctr('cfg.header.printSettings')) + '</h2>' +
                '<p class="cfg-print-sub">' + esc(ctr('cfg.print.subHint')) + '</p>' +
                '</div>' +
                '<div class="cfg-print-clinic-bar">' +
                '<label for="cfgPrintClinicSelect">' + esc(ctr('cfg.label.clinic')) + '</label>' +
                '<select id="cfgPrintClinicSelect" class="cfg-print-clinic-select">' + opts + '</select>' +
                '<button type="button" class="btn btn--primary" id="cfgPrintSaveAllBtn">' + esc(ctr('cfg.print.saveAllRows')) + '</button>' +
                '</div>' +
                '</div>' +
                '<div id="cfgPrintTableRegion" class="cfg-print-table-region"></div>' +
                '</div>';

            var selEl = g('cfgPrintClinicSelect');
            if (selEl) {
                selEl.addEventListener('change', refreshPrintTable);
            }
            var saveAll = g('cfgPrintSaveAllBtn');
            if (saveAll) {
                saveAll.addEventListener('click', function () {
                    var cid = getSelectedPrintClinicId();
                    if (!cid) { toast(ctr('cfg.msg.selectClinicFirst'), true); return; }
                    var rows = _printRowsByClinic[cid];
                    if (!rows) { toast(ctr('cfg.msg.nothingToSave'), true); return; }
                    savePrintRowsForClinic(cid, rows, function (ok) {
                        if (!ok) return;
                        toast(ctr('cfg.msg.printSettingsSaved'));
                    });
                });
            }
            wirePrintModal();
            wirePrinterCombo();
            refreshPrinterLists(false);
            refreshPrintTable();
        });
    }

    function readKnownPrinters() {
        try {
            var raw = localStorage.getItem(PRINTERS_LS_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.filter(function (n) { return String(n || '').trim(); }) : [];
        } catch (e) {
            return [];
        }
    }

    function addKnownPrinter(name) {
        var n = String(name || '').trim();
        if (!n) return;
        var list = readKnownPrinters();
        if (list.indexOf(n) >= 0) return;
        list.push(n);
        list.sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); });
        try {
            localStorage.setItem(PRINTERS_LS_KEY, JSON.stringify(list));
        } catch (e) {}
    }

    function collectPrintersFromSavedSettings() {
        var names = [];
        function add(n) {
            var s = String(n || '').trim();
            if (s && names.indexOf(s) < 0) names.push(s);
        }
        Object.keys(_printRowsByClinic || {}).forEach(function (cid) {
            (_printRowsByClinic[cid] || []).forEach(function (row) {
                add(row.printer_name);
            });
        });
        try {
            var all = readPrintLocalStore();
            Object.keys(all).forEach(function (cid) {
                var map = all[cid] || {};
                Object.keys(map).forEach(function (dt) {
                    add(map[dt] && map[dt].printer_name);
                });
            });
        } catch (e) {}
        readKnownPrinters().forEach(add);
        return names.sort(function (a, b) {
            return a.localeCompare(b, undefined, { sensitivity: 'base' });
        });
    }

    function enumerateSystemPrintersAsync() {
        return new Promise(function (resolve) {
            var names = [];
            function add(n) {
                var s = String(n || '').trim();
                if (s && names.indexOf(s) < 0) names.push(s);
            }

            var tasks = [];

            if (typeof navigator !== 'undefined' && navigator.printers &&
                typeof navigator.printers.getPrinters === 'function') {
                tasks.push(
                    navigator.printers.getPrinters().then(function (list) {
                        (list || []).forEach(function (p) {
                            if (typeof p === 'string') add(p);
                            else add(p.name || p.deviceName || p.displayName || p.id);
                        });
                    }).catch(function () {})
                );
            }

            if (typeof printing !== 'undefined' && printing &&
                typeof printing.getPrinters === 'function') {
                tasks.push(
                    printing.getPrinters().then(function (list) {
                        (list || []).forEach(function (p) {
                            if (typeof p === 'string') add(p);
                            else add(p.name || p.id);
                        });
                    }).catch(function () {})
                );
            }

            Promise.all(tasks.length ? tasks : [Promise.resolve()]).then(function () {
                resolve(names);
            });
        });
    }

    function mergedPrinterNameList() {
        var map = {};
        function add(n) {
            var s = String(n || '').trim();
            if (s) map[s] = true;
        }
        _cachedSystemPrinters.forEach(add);
        collectPrintersFromSavedSettings().forEach(add);
        return Object.keys(map).sort(function (a, b) {
            return a.localeCompare(b, undefined, { sensitivity: 'base' });
        });
    }

    function syncPrinterComboFromValueFor(selId, inpId, val) {
        var sel = selId ? g(selId) : null;
        var inp = inpId ? g(inpId) : null;
        if (!inp) return;
        var v = String(val || '').trim();
        inp.value = v;
        if (!sel) return;
        var matched = false;
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === v && v) {
                sel.value = v;
                matched = true;
                break;
            }
        }
        if (!matched) sel.value = v ? '__custom__' : '';
    }

    function syncPrinterComboFromValue(val) {
        syncPrinterComboFromValueFor('cfgPrintPrinterSelect', 'cfgPrintPrinter', val);
    }

    function rebuildPrinterPickOptionsFor(selId, listId, inpId, currentValue) {
        var sel = selId ? g(selId) : null;
        var dl = listId ? g(listId) : null;
        if (!sel) return;

        var names = mergedPrinterNameList();
        var cur = String(currentValue || '').trim();
        if (!cur && inpId) {
            var inpEl = g(inpId);
            if (inpEl) cur = String(inpEl.value || '').trim();
        }
        if (cur && names.indexOf(cur) < 0) names.push(cur);
        names.sort(function (a, b) {
            return a.localeCompare(b, undefined, { sensitivity: 'base' });
        });

        var html = '<option value="">' + esc(ctr('cfg.print.selectPrinter')) + '</option>';
        names.forEach(function (n) {
            html += '<option value="' + esc(n) + '">' + esc(n) + '</option>';
        });
        html += '<option value="__custom__">' + esc(ctr('cfg.print.customOption')) + '</option>';
        sel.innerHTML = html;

        if (dl) {
            dl.innerHTML = names.map(function (n) {
                return '<option value="' + esc(n) + '">';
            }).join('');
        }

        syncPrinterComboFromValueFor(selId, inpId, cur);
    }

    function rebuildPrinterPickOptions(currentValue) {
        rebuildPrinterPickOptionsFor(
            'cfgPrintPrinterSelect', 'cfgPrintPrinterList', 'cfgPrintPrinter', currentValue
        );
    }

    function rebuildAllPrinterPickOptions() {
        var curCfg = g('cfgPrintPrinter') ? g('cfgPrintPrinter').value : '';
        rebuildPrinterPickOptions(curCfg);
    }

    function getResolvedPrinterNameFromForm(form) {
        var inp = form && form.querySelector('[name="printer_name"]');
        return inp ? String(inp.value || '').trim() : '';
    }

    function refreshPrinterLists(showToast) {
        var curCfg = g('cfgPrintPrinter') ? g('cfgPrintPrinter').value : '';
        return enumerateSystemPrintersAsync().then(function (sys) {
            _cachedSystemPrinters = sys || [];
            sys.forEach(function (n) { addKnownPrinter(n); });
            rebuildPrinterPickOptions(curCfg);
            if (showToast) {
                var n = mergedPrinterNameList().length;
                if (sys.length) {
                    toast(ctrRepl('cfg.msg.printersFound', { SYS: String(sys.length), TOTAL: String(n) }));
                } else {
                    toast(ctrRepl('cfg.msg.noSystemPrinters', { N: String(n) }), false);
                }
            }
        });
    }

    /** Preload system + saved printer names (Configuration + consultation print). */
    function preloadPrinterLists() {
        return refreshPrinterLists(false);
    }

    function wirePrinterCombo() {
        var sel = g('cfgPrintPrinterSelect');
        var inp = g('cfgPrintPrinter');
        var refreshBtn = g('cfgPrintRefreshPrinters');

        if (sel && !sel.dataset.wired) {
            sel.dataset.wired = '1';
            sel.addEventListener('change', function () {
                if (!inp) return;
                if (sel.value === '__custom__') {
                    inp.focus();
                    return;
                }
                if (sel.value) inp.value = sel.value;
            });
        }

        if (inp && !inp.dataset.wired) {
            inp.dataset.wired = '1';
            inp.addEventListener('input', function () {
                if (!sel) return;
                var v = String(inp.value || '').trim();
                var matched = false;
                for (var i = 0; i < sel.options.length; i++) {
                    if (sel.options[i].value === v && v) {
                        sel.value = v;
                        matched = true;
                        break;
                    }
                }
                if (!matched) sel.value = v ? '__custom__' : '';
            });
        }

        if (refreshBtn && !refreshBtn.dataset.wired) {
            refreshBtn.dataset.wired = '1';
            refreshBtn.addEventListener('click', function () {
                refreshBtn.disabled = true;
                refreshPrinterLists(true).finally(function () {
                    refreshBtn.disabled = false;
                });
            });
        }

        var hintToggle = g('cfgPrintPrinterHintToggle');
        var hintPanel = g('cfgPrintPrinterHintPanel');
        if (hintToggle && hintPanel && !hintToggle.dataset.wired) {
            hintToggle.dataset.wired = '1';
            hintToggle.addEventListener('click', function () {
                hintPanel.classList.toggle('hidden');
                var expanded = !hintPanel.classList.contains('hidden');
                hintToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                var chev = hintToggle.querySelector('.cfg-printer-hint-toggle__chev');
                if (chev) chev.textContent = expanded ? '▾' : '▸';
            });
        }
    }

    function wirePrintModal() {
        refreshCfgPrintPaperSelect();
        var closeBtn = g('cfgPrintModalClose');
        var cancelBtn = g('cfgPrintModalCancel');
        var saveBtn = g('cfgPrintModalSave');
        var modal = g('cfgPrintModal');
        var paperSel = g('cfgPrintPaper');

        function closeModal() {
            if (modal) modal.classList.add('hidden');
            _printEditDocType = null;
        }

        if (closeBtn && !closeBtn.dataset.wired) {
            closeBtn.dataset.wired = '1';
            closeBtn.addEventListener('click', closeModal);
        }
        if (cancelBtn && !cancelBtn.dataset.wired) {
            cancelBtn.dataset.wired = '1';
            cancelBtn.addEventListener('click', closeModal);
        }
        if (modal && !modal.dataset.wired) {
            modal.dataset.wired = '1';
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeModal();
            });
        }
        if (paperSel && !paperSel.dataset.wired) {
            paperSel.dataset.wired = '1';
            paperSel.addEventListener('change', function () {
                var form = g('cfgPrintForm');
                if (form) syncPrintPaperDimensions(form);
            });
        }
        wirePrinterCombo();
        var formEl = g('cfgPrintForm');
        if (formEl) wirePrintDetailExtras(formEl);
        if (saveBtn && !saveBtn.dataset.wired) {
            saveBtn.dataset.wired = '1';
            saveBtn.addEventListener('click', function () {
                var cid = getSelectedPrintClinicId();
                if (!cid || !_printEditDocType) { closeModal(); return; }
                var form = g('cfgPrintForm');
                if (!form) return;
                var footEdit = g('cfgPrintFootnoteEditor');
                var footHidden = g('cfgPrintFootnoteHtml');
                if (footEdit && footHidden) footHidden.value = footEdit.innerHTML;
                var fd = new FormData(form);
                var fitEl = form.querySelector('[name="fit_to_page"]');
                var hdrEl = form.querySelector('[name="show_header"]');
                var row = {
                    doc_type:       _printEditDocType,
                    printer_name:   getResolvedPrinterNameFromForm(form),
                    paper_size:     String(fd.get('paper_size') || 'A4'),
                    paper_width_mm: fd.get('paper_width_mm') ? Number(fd.get('paper_width_mm')) : null,
                    paper_height_mm: fd.get('paper_height_mm') ? Number(fd.get('paper_height_mm')) : null,
                    margin_left:    Number(fd.get('margin_left')) || 0,
                    margin_right:   Number(fd.get('margin_right')) || 0,
                    margin_top:     Number(fd.get('margin_top')) || 0,
                    margin_bottom:  Number(fd.get('margin_bottom')) || 0,
                    orientation:    String(fd.get('orientation') || 'portrait'),
                    scale_percent:  Number(fd.get('scale_percent')) || 100,
                    copies:         Number(fd.get('copies')) || 1,
                    color_mode:     String(fd.get('color_mode') || 'color'),
                    fit_to_page:    !!(fitEl && fitEl.checked),
                    show_header:    hdrEl ? !!hdrEl.checked : true,
                    notes:          String(fd.get('notes') || '').trim(),
                    extras:         readPrintExtrasFromForm(form)
                };
                var rows = _printRowsByClinic[cid] || fullRowsForClinic({});
                var next = rows.map(function (r) {
                    return r.doc_type === _printEditDocType ? row : r;
                });
                var resolvedName = getResolvedPrinterNameFromForm(form);
                if (resolvedName) addKnownPrinter(resolvedName);
                savePrintRowsForClinic(cid, next, function (ok) {
                    if (!ok) return;
                    toast(ctr('cfg.msg.printSetupSaved'));
                    closeModal();
                    refreshPrintTable();
                });
            });
        }
    }

    function _openPrintDetailModal(docType, row) {
        var modal = g('cfgPrintModal');
        var form = g('cfgPrintForm');
        if (!modal || !form || !row) return;
        refreshCfgPrintPaperSelect();
        _printEditDocType = docType;

        var title = g('cfgPrintModalTitle');
        var docLbl = g('cfgPrintModalDocLabel');
        if (title) title.textContent = ctrRepl('cfg.print.setupTitleDoc', { DOC: printDocLabel(docType) });
        if (docLbl) docLbl.textContent = ctrRepl('cfg.print.documentDoc', { DOC: printDocLabel(docType) });

        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(modal);
        var footEdit = g('cfgPrintFootnoteEditor');
        if (footEdit) {
            footEdit.setAttribute('data-placeholder', ctr('cfg.print.footnotePh'));
        }

        function setVal(name, val) {
            var el = form.querySelector('[name="' + name + '"]');
            if (!el) return;
            if (el.type === 'checkbox') el.checked = !!val;
            else el.value = val === null || val === undefined ? '' : String(val);
        }

        rebuildPrinterPickOptions(row.printer_name);
        refreshPrinterLists(false);
        var hintPanel = g('cfgPrintPrinterHintPanel');
        var hintToggle = g('cfgPrintPrinterHintToggle');
        if (hintPanel) hintPanel.classList.add('hidden');
        if (hintToggle) {
            hintToggle.setAttribute('aria-expanded', 'false');
            var chev = hintToggle.querySelector('.cfg-printer-hint-toggle__chev');
            if (chev) chev.textContent = '▸';
        }
        setVal('paper_size', row.paper_size);
        setVal('paper_width_mm', row.paper_width_mm);
        setVal('paper_height_mm', row.paper_height_mm);
        setVal('margin_left', row.margin_left);
        setVal('margin_right', row.margin_right);
        setVal('margin_top', row.margin_top);
        setVal('margin_bottom', row.margin_bottom);
        setVal('orientation', row.orientation);
        setVal('scale_percent', row.scale_percent);
        setVal('copies', row.copies);
        setVal('color_mode', row.color_mode);
        setVal('fit_to_page', row.fit_to_page);
        setVal('show_header', row.show_header);
        setVal('notes', row.notes);
        fillPrintExtrasForm(form, row.extras);
        syncPrintPaperDimensions(form);

        var editor = g('cfgPrintFontEditor');
        if (editor) editor.classList.add('hidden');
        _printFontEditField = null;

        modal.classList.remove('hidden');
    }

    function prefetchPrintSettings(clinicId) {
        loadPrintRowsForClinic(clinicId || currentClinicId, function () {});
    }

    function refreshCfgDynamicConfirmI18n() {
        var ov = document.getElementById('cfgConfirmOv');
        if (!ov) return;
        var buttons = ov.querySelectorAll('button');
        if (buttons.length > 0) buttons[0].textContent = ctr('cfg.btn.delete');
        if (buttons.length > 1) buttons[1].textContent = ctr('cfg.btn.cancel');
    }

    function refreshCfgPrintModalOpenI18n() {
        var modal = g('cfgPrintModal');
        if (!modal || modal.classList.contains('hidden') || !_printEditDocType) return;
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(modal);
        refreshCfgPrintPaperSelect();
        var title = g('cfgPrintModalTitle');
        var docLbl = g('cfgPrintModalDocLabel');
        if (title) {
            title.textContent = ctrRepl('cfg.print.setupTitleDoc', {
                DOC: printDocLabel(_printEditDocType)
            });
        }
        if (docLbl) {
            docLbl.textContent = ctrRepl('cfg.print.documentDoc', {
                DOC: printDocLabel(_printEditDocType)
            });
        }
        var form = g('cfgPrintForm');
        if (form) syncPrintFontDisplays(form);
        var footEdit = g('cfgPrintFootnoteEditor');
        if (footEdit) {
            footEdit.setAttribute('data-placeholder', ctr('cfg.print.footnotePh'));
        }
    }

    function refreshCfgOverlayPanelI18n(panelId, titleId, titleText) {
        var panel = g(panelId);
        if (!panel) return;
        if (panel.style.display !== 'none' && typeof applyI18nInRoot === 'function') {
            applyI18nInRoot(panel);
        }
        if (titleId && titleText) {
            var titleEl = g(titleId);
            if (titleEl) titleEl.textContent = titleText;
        }
    }

    function refreshCfgOpenModalsI18n() {
        refreshCfgDynamicConfirmI18n();
        refreshCfgPrintModalOpenI18n();
        var dynOv = document.getElementById('cfgConfirmOv');
        if (dynOv && typeof applyI18nInRoot === 'function') applyI18nInRoot(dynOv);
        var staticOv = g('cfgConfirmOverlay');
        if (staticOv && !staticOv.classList.contains('hidden') &&
            typeof applyI18nInRoot === 'function') {
            applyI18nInRoot(staticOv);
        }
        refreshCfgOverlayPanelI18n('clinicPanel', 'clinicPanelTitle',
            _clinicEditId ? ctr('cfg.panel.editClinic') : ctr('cfg.panel.addClinic'));
        refreshCfgOverlayPanelI18n('docPanel', 'docPanelTitle',
            _docEditId ? ctr('cfg.panel.editDoctor') : ctr('cfg.panel.addDoctor'));
        refreshCfgOverlayPanelI18n('pmPanel', 'pmPanelTitle',
            _pmEditId ? ctr('cfg.panel.editPayment') : ctr('cfg.panel.addPayment'));
        refreshCfgOverlayPanelI18n('txPanel', 'txPanelTitle',
            _txEditId ? ctr('cfg.panel.editTreatment') : ctr('cfg.panel.addTreatment'));
        refreshCfgOverlayPanelI18n('cfgUserPanel');
    }

    function printSheetDimensionsMm(printRow) {
        if (!printRow) return { w: 210, h: 297 };
        var sz = String(printRow.paper_size || 'A4').trim();
        var pw = 210;
        var ph = 297;
        if (sz === 'A5') {
            pw = 148;
            ph = 210;
        } else if (sz === 'Letter') {
            pw = 216;
            ph = 279;
        } else if (sz === '80mm roll') {
            pw = 80;
            ph = 297;
        } else if (sz === '50mm x 60mm') {
            pw = 50;
            ph = 60;
        } else if (sz === 'Custom' && printRow.paper_width_mm && printRow.paper_height_mm) {
            pw = Math.max(20, Number(printRow.paper_width_mm) || pw);
            ph = Math.max(20, Number(printRow.paper_height_mm) || ph);
        }
        var orient = String(printRow.orientation || 'portrait').toLowerCase();
        if (orient === 'landscape') {
            var tmp = pw;
            pw = ph;
            ph = tmp;
        }
        return { w: pw, h: ph };
    }

    function printMarginsMmFromRow(printRow) {
        function n(v, fb) {
            var x = Number(v);
            return isFinite(x) && x >= 0 ? x : fb;
        }
        if (!printRow) {
            printRow = {};
        }
        return {
            t: n(printRow.margin_top, 15),
            r: n(printRow.margin_right, 15),
            b: n(printRow.margin_bottom, 15),
            l: n(printRow.margin_left, 15)
        };
    }

    /**
     * @page + preview shell (.print-sheet-outer) from a merged clinic_print_settings row.
     * Screen: centered white “sheet” on neutral gray gutter (readable in monochrome preview).
     * Print: white page, economy color adjustment — most clinic printers are grayscale; avoids
     * muddy pale fills when browsers map RGB to halftone gray.
     */
    function buildPrintSheetStylesCss(printRow) {
        var dim = printSheetDimensionsMm(printRow);
        var m = printMarginsMmFromRow(printRow);
        return (
            '@page{margin:' + m.t + 'mm ' + m.r + 'mm ' + m.b + 'mm ' + m.l + 'mm;' +
                'size:' + dim.w + 'mm ' + dim.h + 'mm;}' +
            'html{background:#d4d4d4;}' +
            'body{font-family:"Segoe UI",Arial,sans-serif;margin:0;color:#111;' +
                'background:#d4d4d4;}' +
            '.print-sheet-outer{' +
                'box-sizing:border-box;width:' + dim.w + 'mm;min-height:' + dim.h + 'mm;' +
                'padding:' + m.t + 'mm ' + m.r + 'mm ' + m.b + 'mm ' + m.l + 'mm;' +
                'margin:14px auto;background:#fff;' +
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

    function estimatePrintPopupSizePx(printRow) {
        function mmPx(mmVal) {
            return Math.round((Number(mmVal) || 0) * 96 / 25.4);
        }
        var dim = printSheetDimensionsMm(printRow);
        return {
            width: Math.min(1200, mmPx(dim.w) + 48),
            height: Math.min(1000, mmPx(dim.h) + 120)
        };
    }

    /** Used by print modules — merged settings row for active/login clinic. */
    function getPrintSettingsForDoc(docType, clinicIdOpt) {
        var cid = clinicIdOpt ||
            (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
        if (!cid) return defaultPrintRow(docType);
        if (_printRowsByClinic[cid]) {
            var hit = _printRowsByClinic[cid].find(function (r) { return r.doc_type === docType; });
            if (hit) return hit;
        }
        var all = readPrintLocalStore();
        return mergePrintRow(docType, (all[cid] || {})[docType]);
    }

    function fillPrintFormElement(form, row) {
        if (!form || !row) return;
        function setVal(name, val) {
            var el = form.querySelector('[name="' + name + '"]');
            if (!el) return;
            if (el.type === 'checkbox') el.checked = !!val;
            else el.value = val === null || val === undefined ? '' : String(val);
        }
        setVal('printer_name', row.printer_name);
        setVal('paper_size', row.paper_size);
        setVal('paper_width_mm', row.paper_width_mm);
        setVal('paper_height_mm', row.paper_height_mm);
        setVal('margin_left', row.margin_left);
        setVal('margin_right', row.margin_right);
        setVal('margin_top', row.margin_top);
        setVal('margin_bottom', row.margin_bottom);
        setVal('orientation', row.orientation);
        setVal('scale_percent', row.scale_percent);
        setVal('copies', row.copies);
        setVal('color_mode', row.color_mode);
        setVal('fit_to_page', row.fit_to_page);
        setVal('show_header', row.show_header);
        setVal('notes', row.notes);
        fillPrintExtrasForm(form, row.extras);
        syncPrintPaperDimensions(form);
    }

    function readPrintFormElement(form) {
        if (!form) return defaultPrintRow('letters');
        var footEdit = g('cfgPrintFootnoteEditor');
        var footHidden = g('cfgPrintFootnoteHtml');
        if (footEdit && footHidden) footHidden.value = footEdit.innerHTML;
        var fd = new FormData(form);
        var fitEl = form.querySelector('[name="fit_to_page"]');
        var hdrEl = form.querySelector('[name="show_header"]');
        var printerInp = form.querySelector('[name="printer_name"]');
        return {
            printer_name: printerInp ? String(printerInp.value || '').trim() : '',
            paper_size: String(fd.get('paper_size') || 'A4'),
            paper_width_mm: fd.get('paper_width_mm') ? Number(fd.get('paper_width_mm')) : null,
            paper_height_mm: fd.get('paper_height_mm') ? Number(fd.get('paper_height_mm')) : null,
            margin_left: Number(fd.get('margin_left')) || 0,
            margin_right: Number(fd.get('margin_right')) || 0,
            margin_top: Number(fd.get('margin_top')) || 0,
            margin_bottom: Number(fd.get('margin_bottom')) || 0,
            orientation: String(fd.get('orientation') || 'portrait'),
            scale_percent: Number(fd.get('scale_percent')) || 100,
            copies: Number(fd.get('copies')) || 1,
            color_mode: String(fd.get('color_mode') || 'color'),
            fit_to_page: !!(fitEl && fitEl.checked),
            show_header: hdrEl ? !!hdrEl.checked : true,
            notes: String(fd.get('notes') || '').trim(),
            extras: readPrintExtrasFromForm(form)
        };
    }

    /**
     * Open printable preview popup (sheet chrome from printRow).
     * opts: { title, bodyHtml, printRow, clinicId }
     */
    function openContentPrintPopup(opts) {
        opts = opts || {};
        var title = opts.title || 'Print';
        var bodyHtml = opts.bodyHtml || '';
        var cid = opts.clinicId ||
            (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
        var printRow = opts.printRow;
        if (!printRow && opts.docType) {
            printRow = getPrintSettingsForDoc(opts.docType, cid);
        }
        if (!printRow) printRow = defaultPrintRow('letters');

        if (typeof prefetchPrintSettings === 'function' && cid) {
            prefetchPrintSettings(cid);
        }

        var sheetCss = buildPrintSheetStylesCss(printRow);
        var wh = estimatePrintPopupSizePx(printRow);
        var popup = window.open('', '_blank',
            'width=' + wh.width + ',height=' + wh.height +
            ',scrollbars=1,resizable=1,toolbar=0,menubar=0'
        );
        if (!popup) return false;

        var contentCss =
            '.tn-print-hdr{margin-bottom:16px;border-bottom:2px solid #0d6efd;padding-bottom:10px;}' +
            '.tn-print-hdr h1{margin:0 0 6px;font-size:18px;color:#0d6efd;}' +
            '.tn-print-meta{font-size:12px;color:#555;line-height:1.5;}' +
            '.tn-print-date-sep{margin:14px 0 8px;font-weight:800;font-size:12px;color:#0d6efd;' +
                'border-bottom:1px solid #dde8f5;padding-bottom:4px;}' +
            '.tn-print-note{margin:0 0 10px;padding:8px 10px;border-left:3px solid #0d6efd;' +
                'background:#f8fafc;font-size:13px;line-height:1.45;white-space:pre-wrap;}' +
            '.tn-print-note-meta{font-size:11px;color:#888;margin-bottom:4px;}';

        popup.document.write(
            '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
            '<title>' + esc(title) + '</title>' +
            '<style>' + sheetCss + contentCss +
            '.print-sheet-outer img,.print-sheet-outer table{max-width:100%;}</style>' +
            '</head><body>' +
            '<div class="print-sheet-outer">' + (bodyHtml || '') + '</div>' +
            '<script>(function(){' +
            'function fitPageRatio(){' +
            'var de=document.documentElement,bd=document.body;if(!de||!bd)return;' +
            'de.style.zoom="";bd.style.zoom="";' +
            'var vw=Math.max(1,window.innerWidth||de.clientWidth||1);' +
            'var vh=Math.max(1,window.innerHeight||de.clientHeight||1);' +
            'var needW=Math.max(1,de.scrollWidth||bd.scrollWidth||vw);' +
            'var needH=Math.max(1,de.scrollHeight||bd.scrollHeight||vh);' +
            'var sc=Math.min(1,vw/needW,vh/needH);' +
            'if(!(sc>0&&sc<=1))sc=1;' +
            'sc=Math.max(0.42,Math.floor(sc*100)/100);' +
            'if(sc<1){de.style.zoom=String(sc);bd.style.zoom=String(sc);}' +
            '}' +
            'window.onload=function(){' +
            'try{fitPageRatio();}catch(e0){}' +
            'setTimeout(function(){window.print();},280);' +
            '};' +
            '})();<\/script>' +
            '</body></html>'
        );
        popup.document.close();
        return true;
    }

    return {
            init:                   init,
            isInitialized:          function () { return _ready; },
            refreshCfgNavLabels:    refreshCfgNavLabels,
            stripCfgStalePaneBodies: stripCfgStalePaneBodies,
            getPrintSettingsForDoc: getPrintSettingsForDoc,
            fillPrintFormElement:   fillPrintFormElement,
            readPrintFormElement:   readPrintFormElement,
            openContentPrintPopup:  openContentPrintPopup,
            prefetchPrintSettings:  prefetchPrintSettings,
            refreshPrinterLists:    refreshPrinterLists,
            preloadPrinterLists:    preloadPrinterLists,
            // Consultation letters + print preview: sheet CSS + popup sizing
            printSheetDimensionsMm: printSheetDimensionsMm,
            printMarginsMmFromRow:  printMarginsMmFromRow,
            buildPrintSheetStylesCss: buildPrintSheetStylesCss,
            estimatePrintPopupSizePx: estimatePrintPopupSizePx,
            loadPrint:              loadPrint,
            _reloadActiveTab:       function () {
                refreshCfgNavLabels();
                refreshCfgPrintPaperSelect();
                refreshCfgTplTypeSelect();
                refreshCfgPmGroupSelect();
                refreshCfgUserRoleSelect();
                if (_tab) switchTab(_tab);
            },
            refreshPrintPaperSelect: refreshCfgPrintPaperSelect,
            refreshTplTypeSelect:    refreshCfgTplTypeSelect,
            refreshPmGroupSelect:    refreshCfgPmGroupSelect,
            refreshUserRoleSelect:   refreshCfgUserRoleSelect,
            refreshOpenModalsI18n:   refreshCfgOpenModalsI18n,
            // clinic
            _openClinicPanel:       _openClinicPanel,
            _closeClinicPanel:      _closeClinicPanel,
            _saveClinic:            _saveClinic,
            _deleteClinic:          _deleteClinic,
            _toggleClinicSelect:    _toggleClinicSelect,
            _toggleAllClinics:      _toggleAllClinics,



            _setActiveClinic:       _setActiveClinic,
            _printSelectedClinics:  _printSelectedClinics,
                        // doctor
            _toggleDoctorSelect:   _toggleDoctorSelect,
            _toggleAllDoctors:     _toggleAllDoctors,
            _printSelectedDoctors: _printSelectedDoctors,
            _onDocClinicChange:    _onDocClinicChange,
            _openAdminUserPanel:   _openAdminUserPanel,
            _onUserRoleChange:     _onUserRoleChange,
            _openRecepUserPanel:   _openRecepUserPanel,
            _openCopyToClinic:     _openCopyToClinic,
            _openDocPanel:         _openDocPanel,
            _closeDocPanel:        _closeDocPanel,
            _saveDoc:              _saveDoc,
            _deleteDoc:            _deleteDoc,
        // payment
        _openPmPanel:   _openPmPanel,
        _closePmPanel:  _closePmPanel,
        _savePm:        _savePm,
        _deletePm:      _deletePm,
        // treatment
        _openTxPanel:   _openTxPanel,
        _closeTxPanel:  _closeTxPanel,
        _saveTx:        _saveTx,
        _deleteTx:      _deleteTx,
        _renewTreatmentCatalog: _renewTreatmentCatalog,
        // settings
        _saveSettings:  _saveSettings,
        // templates
        _openTplEditor: _openTplEditor,
        _closeTplEditor:_closeTplEditor,
        _saveTpl:       _saveTpl,
        _deleteTpl:     _deleteTpl,
        _insertTplTag:  _insertTplTag,
        _applySeedTemplate: _applySeedTemplate,
        _filterTemplates: _filterTemplates,
        // users
        _openUserPanel: _openUserPanel,
        _openAdminUserPanel: _openAdminUserPanel,
        _onUserRoleChange: _onUserRoleChange,
        _closeUserPanel: _closeUserPanel,
        _saveUser: _saveUser,
        _saveUserPassword: _saveUserPassword,
        _deleteUser: _deleteUser,
        _ensureNurseLogin: _ensureNurseLogin,
        // data
        _exportCSV:     _exportCSV
    };

})();

document.addEventListener('DOMContentLoaded', function () {
    if (typeof CFG !== 'undefined') {
        if (typeof CFG.stripCfgStalePaneBodies === 'function') CFG.stripCfgStalePaneBodies();
        if (typeof CFG.refreshCfgNavLabels === 'function') CFG.refreshCfgNavLabels();
        if (typeof CFG.refreshPrintPaperSelect === 'function') CFG.refreshPrintPaperSelect();
    }
});

document.addEventListener('app-lang-change', function () {
    if (typeof CFG !== 'undefined' && typeof CFG.refreshOpenModalsI18n === 'function') {
        CFG.refreshOpenModalsI18n();
    }
    var sec = document.getElementById('sectionConfig');
    var cfgReady = typeof CFG !== 'undefined' && typeof CFG.isInitialized === 'function' && CFG.isInitialized();
    if (sec && typeof applyI18nInRoot === 'function') {
        if (cfgReady || sec.style.display !== 'none') applyI18nInRoot(sec);
    }
    if (cfgReady && typeof CFG.refreshCfgNavLabels === 'function') {
        CFG.refreshCfgNavLabels();
    }
    if (cfgReady && typeof CFG._reloadActiveTab === 'function') {
        CFG._reloadActiveTab();
    }
});

