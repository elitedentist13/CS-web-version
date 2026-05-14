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
        yesBtn.textContent = 'Delete';
        yesBtn.style.cssText =
            'background:#dc3545;color:#fff;border:none;padding:10px 28px;' +
            'border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;margin-right:12px;';

        var noBtn = document.createElement('button');
        noBtn.textContent = 'Cancel';
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
            '<span style="color:#fff;font-size:17px;font-weight:600;">' +
            'Configuration</span></div>' +

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
                esc(t.label) + '</div>';
        }).join('');
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
            data:      loadData
        };
        if (loaders[key]) loaders[key]();
    }

    // ════════════════════════════════════════════════════════
    // INIT  (public — called by app.js card click)
    // ════════════════════════════════════════════════════════
        function init() {
        if (typeof currentRole !== 'undefined' && currentRole !== 'admin') {
            toast('Admin access required.', true);
            return;
        }
        // Don't rebuild shell - HTML already exists
        wireNav();
        switchTab('clinic');   // default tab
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
        pane.innerHTML = '<p style="color:#888;">Loading…</p>';

        SB.from('clinics').select('*').order('clinic_code')
        .then(function (r) {
            var rows = r.data || [];
            var html =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin-bottom:20px;">' +
                '<h2 style="margin:0;font-size:20px;">Clinic Profile</h2>' +
                '<div style="display:flex;gap:10px;">' +
                '<button id="btnPrintClinics" onclick="CFG._printSelectedClinics()" ' +
                'disabled style="padding:9px 20px;background:#6c757d;color:#fff;' +
                'border:none;border-radius:6px;cursor:not-allowed;' +
                'font-size:13px;">🖨️ Print Selected</button>' +
                '<button onclick="CFG._openClinicPanel()" style="' +
                'padding:9px 20px;background:#0d6efd;color:#fff;' +
                'border:none;border-radius:6px;cursor:pointer;' +
                'font-size:13px;">+ Add Clinic</button></div></div>' +
                '<div id="clinicList">' + renderClinicCards(rows) + '</div>' +
                clinicPanelHTML();
            pane.innerHTML = html;
        })
        .catch(function (e) {
            pane.innerHTML = '<p style="color:red;">Error: ' + esc(e.message) + '</p>';
        });
    }

    function renderClinicCards(rows) {
        if (!rows.length) {
            return '<p style="color:#888;text-align:center;padding:40px 0;">' +
                'No clinics found. Click "+ Add Clinic" to create one.</p>';
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
            'width:80px;text-transform:uppercase;letter-spacing:0.5px;">Active</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">Clinic Code</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">English Name</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">Chinese Name</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">Address</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">Tel</th>' +
            '<th style="padding:12px 14px;text-align:left;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">Open ~ Close</th>' +
            '<th style="padding:12px 14px;text-align:center;font-size:12px;' +
            'font-weight:700;color:#0d6efd;border-bottom:2px solid #dde8f5;' +
            'text-transform:uppercase;letter-spacing:0.5px;">Actions</th>' +
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
                (c.fax ? '<br><small style="color:#888;">Fax: ' + esc(c.fax) + '</small>' : '') +
                '</td>' +
                '<td style="padding:12px 14px;font-size:12px;vertical-align:top;' +
                'white-space:nowrap;cursor:pointer;" ' +
                'onclick="CFG._openClinicPanel(\'' + c.id + '\')">' +
                esc(c.open_at || '-') + ' ~ ' + esc(c.close_at || '-') +
                (c.appt_interval ? '<br><small style="color:#888;">Interval: ' +
                c.appt_interval + ' min</small>' : '') +
                '</td>' +
                '<td style="padding:12px 14px;text-align:center;vertical-align:top;">' +
                '<div style="display:flex;gap:6px;justify-content:center;">' +
                '<button onclick="event.stopPropagation();CFG._openClinicPanel(\'' +
                c.id + '\')" style="padding:5px 12px;background:#0d6efd;' +
                'color:#fff;border:none;border-radius:4px;cursor:pointer;' +
                'font-size:11px;font-weight:600;">Edit</button>' +
                '<button onclick="event.stopPropagation();CFG._deleteClinic(\'' +
                c.id + '\',\'' + esc(c.english_name || c.clinic_code) +
                '\')" style="padding:5px 12px;background:#dc3545;color:#fff;' +
                'border:none;border-radius:4px;cursor:pointer;font-size:11px;' +
                'font-weight:600;">Delete</button>' +
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
            '<h3 id="clinicPanelTitle" style="margin:0;font-size:17px;">Add Clinic</h3>' +
            '<button onclick="CFG._closeClinicPanel()" style="background:none;' +
            'border:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>' +
            '</div>' +
            fld('Clinic Code *',        'cl_code')   +
            fld('English Name',         'cl_ename')  +
            fld('Chinese Name',         'cl_cname')  +
            fld('Qualification',        'cl_qual')   +
            '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">Address</label>' +
            '<textarea id="cl_addr" rows="3" style="' + inputStyle() + '"></textarea>' +
            '</div>' +
            fld('Tel',                  'cl_tel')    +
            fld('Fax',                  'cl_fax')    +
            fld('Open At',              'cl_open',  'time') +
            fld('Close At',             'cl_close', 'time') +
            fld('Appt Interval (min)',  'cl_interval', 'number') +
            '<button onclick="CFG._saveClinic()" style="width:100%;' +
            'padding:11px;background:#0d6efd;color:#fff;border:none;' +
            'border-radius:6px;cursor:pointer;font-size:14px;">' +
            'Save Clinic</button>' +
            '</div>';
    }

    function _openClinicPanel(id) {
        _clinicEditId = id || null;
        var panel = g('clinicPanel');
        if (!panel) return;

        g('clinicPanelTitle').textContent = id ? 'Edit Clinic' : 'Add Clinic';

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
        if (!code) { toast('Clinic code is required.', true); return; }

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
            toast(_clinicEditId ? 'Clinic updated.' : 'Clinic added.');
            _closeClinicPanel();
            loadClinic();
        });
    }

    function _deleteClinic(id, name) {
        confirm('Delete clinic "' + name + '"? This cannot be undone.', function () {
            SB.from('clinics').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast('Clinic deleted.');
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

            function loadDoctors() {
            var pane = g('cfgPane-doctors');
            if (!pane) return;
            pane.innerHTML = '<p style="color:#888;">Loading…</p>';

            SB.from('doctors').select('*').order('doctor_code')
            .then(function (r) {
                var rows = r.data || [];
                var html =
                    '<div style="display:flex;justify-content:space-between;' +
                    'align-items:center;margin-bottom:20px;">' +
                    '<h2 style="margin:0;font-size:20px;">Doctors</h2>' +
                                        '<div style="display:flex;gap:10px;">' +
                    '<button id="btnPrintDoctors" onclick="CFG._printSelectedDoctors()" ' +
                    'disabled style="padding:9px 20px;background:#6c757d;color:#fff;' +
                    'border:none;border-radius:6px;cursor:not-allowed;' +
                    'font-size:13px;">🖨️ Print Selected</button>' +
                    '<button onclick="CFG._openDocPanel()" style="' +
                    'padding:9px 20px;background:#0d6efd;color:#fff;' +
                    'border:none;border-radius:6px;cursor:pointer;' +
                    'font-size:13px;">+ Add Doctor</button></div></div>' +
                                        '<div id="docList">' + renderDocCards(rows) + '</div>' +
                    docPanelHTML();
                pane.innerHTML = html;
                // reset selection state each time tab loads
                _selectedDoctorIds = [];
            })
            .catch(function (e) {
                pane.innerHTML = '<p style="color:red;">Error: ' + esc(e.message) + '</p>';
            });
        }

        function renderDocCards(rows) {
        if (!rows.length) {
            return '<p style="color:#888;text-align:center;padding:40px 0;">' +
                'No doctors found. Click "+ Add Doctor" to create one.</p>';
        }
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
            '<th style="' + TH + '">Doctor Code</th>' +
            '<th style="' + TH + '">English Name</th>' +
            '<th style="' + TH + '">Chinese Name</th>' +
            '<th style="' + TH + '">Qualification</th>' +
            '<th style="' + TH + '">Tel</th>' +
            '<th style="' + TH_C + 'width:60px;">Color</th>' +
            '<th style="' + TH_C + 'width:80px;">Status</th>' +
            '<th style="' + TH_C + '">Actions</th>' +
            '</tr></thead><tbody>';

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
                    (d.is_active ? 'Active' : 'Inactive') + '</span></td>' +
                '<td style="' + TD_C + '">' +
                    '<div style="display:flex;gap:5px;justify-content:center;">' +
                    '<button onclick="event.stopPropagation();CFG._openDocPanel(\'' + d.id + '\')" ' +
                    'style="padding:4px 11px;background:#0d6efd;color:#fff;border:none;' +
                    'border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">Edit</button>' +
                    '<button onclick="event.stopPropagation();CFG._deleteDoc(\'' + d.id + '\',\'' +
                    esc(d.english_name || d.doctor_code) + '\')" ' +
                    'style="padding:4px 11px;background:#dc3545;color:#fff;border:none;' +
                    'border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">Delete</button>' +
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
            '<h3 id="docPanelTitle" style="margin:0;font-size:17px;">Add Doctor</h3>' +
            '<button onclick="CFG._closeDocPanel()" style="background:none;' +
            'border:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>' +
            '</div>' +
            fld('Doctor Code *', 'dp_code')   +
            fld('English Name',  'dp_ename')  +
            fld('Chinese Name',  'dp_cname')  +
            fld('Qualification', 'dp_qual')   +
            fld('Tel',           'dp_tel')    +
            fld('Email',         'dp_email', 'email') +
            '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">Colour</label>' +
            '<input type="color" id="dp_color" value="#4A90D9" ' +
            'style="width:60px;height:36px;border:1px solid #ddd;' +
            'border-radius:6px;cursor:pointer;"></div>' +
            '<div style="margin-bottom:20px;">' +
            '<label style="font-size:13px;color:#555;">' +
            '<input type="checkbox" id="dp_active" checked ' +
            'style="margin-right:6px;">Active</label></div>' +
            '<button onclick="CFG._saveDoc()" style="width:100%;' +
            'padding:11px;background:#0d6efd;color:#fff;border:none;' +
            'border-radius:6px;cursor:pointer;font-size:14px;">' +
            'Save Doctor</button>' +
            '</div>';
    }

    function fld(label, id, type) {
        type = type || 'text';
        return '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">' + esc(label) + '</label>' +
            '<input type="' + type + '" id="' + id + '" style="' +
            inputStyle() + '"></div>';
    }

    function _openDocPanel(id) {
        _docEditId = id || null;
        var panel = g('docPanel');
        if (!panel) return;

        g('docPanelTitle').textContent = id ? 'Edit Doctor' : 'Add Doctor';

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
        if (!code) { toast('Doctor code is required.', true); return; }

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

        var op = _docEditId
            ? SB.from('doctors').update(payload).eq('id', _docEditId)
            : SB.from('doctors').insert(payload);

        op.then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(_docEditId ? 'Doctor updated.' : 'Doctor added.');
            _closeDocPanel();
            loadDoctors();
        });
    }

    function _deleteDoc(id, name) {
        confirm('Delete doctor "' + name + '"? This cannot be undone.', function () {
            SB.from('doctors').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast('Doctor deleted.');
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
        pane.innerHTML = '<p style="color:#888;">Loading…</p>';

        SB.from('bill_types').select('*').order('sort_order')
        .then(function (r) {
            var rows = r.data || [];
            var html =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin-bottom:20px;">' +
                '<h2 style="margin:0;font-size:20px;">Payment Methods</h2>' +
                '<button onclick="CFG._openPmPanel()" style="' +
                'padding:9px 20px;background:#0d6efd;color:#fff;' +
                'border:none;border-radius:6px;cursor:pointer;' +
                'font-size:13px;">+ Add Method</button></div>' +
                '<div id="pmList">' + renderPmCards(rows) + '</div>' +
                pmPanelHTML();
            pane.innerHTML = html;
        });
    }

    function renderPmCards(rows) {
        if (!rows.length) return '<p style="color:#888;">No payment methods found.</p>';
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
                'font-size:11px;padding:2px 7px;border-radius:10px;">Default</span>' : '') +
                (d.is_active ? '' : ' <span style="color:#dc3545;font-size:12px;">(Inactive)</span>') +
                '<div style="font-size:12px;color:#888;margin-top:3px;">' +
                'Group: ' + esc(d.type_group || '-') +
                (d.surcharge_pct ? ' · Surcharge: ' + d.surcharge_pct + '%' : '') +
                '</div></div>' +
                '<div>' +
                '<button onclick="CFG._openPmPanel(\'' + d.id + '\')" style="' +
                'padding:6px 14px;background:#0d6efd;color:#fff;border:none;' +
                'border-radius:5px;cursor:pointer;font-size:12px;margin-right:6px;">' +
                'Edit</button>' +
                '<button onclick="CFG._deletePm(\'' + d.id + '\',\'' +
                esc(d.name) + '\')" style="' +
                'padding:6px 14px;background:#dc3545;color:#fff;border:none;' +
                'border-radius:5px;cursor:pointer;font-size:12px;">Delete</button>' +
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
            '<h3 id="pmPanelTitle" style="margin:0;font-size:17px;">Add Payment Method</h3>' +
            '<button onclick="CFG._closePmPanel()" style="background:none;' +
            'border:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>' +
            '</div>' +
            fld('Type Code *',  'pm_code')   +
            fld('Name *',       'pm_name')   +
            fld('Type Name',    'pm_tname')  +
            fld('Type Group',   'pm_group')  +
            fld('Surcharge %',  'pm_surch', 'number') +
            fld('Sort Order',   'pm_sort',  'number') +
            '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">Colour</label>' +
            '<input type="color" id="pm_color" value="#4A90D9" ' +
            'style="width:60px;height:36px;border:1px solid #ddd;' +
            'border-radius:6px;cursor:pointer;"></div>' +
            '<div style="margin-bottom:8px;">' +
            '<label style="font-size:13px;color:#555;">' +
            '<input type="checkbox" id="pm_default" ' +
            'style="margin-right:6px;">Default</label></div>' +
            '<div style="margin-bottom:20px;">' +
            '<label style="font-size:13px;color:#555;">' +
            '<input type="checkbox" id="pm_active" checked ' +
            'style="margin-right:6px;">Active</label></div>' +
            '<button onclick="CFG._savePm()" style="width:100%;' +
            'padding:11px;background:#0d6efd;color:#fff;border:none;' +
            'border-radius:6px;cursor:pointer;font-size:14px;">' +
            'Save Method</button>' +
            '</div>';
    }

    function _openPmPanel(id) {
        _pmEditId = id || null;
        var panel = g('pmPanel');
        if (!panel) return;
        g('pmPanelTitle').textContent = id ? 'Edit Payment Method' : 'Add Payment Method';

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
        if (!code || !name) { toast('Code and Name are required.', true); return; }

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
            toast(_pmEditId ? 'Payment method updated.' : 'Payment method added.');
            _closePmPanel();
            loadPayment();
        });
    }

    function _deletePm(id, name) {
        confirm('Delete payment method "' + name + '"?', function () {
            SB.from('bill_types').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast('Payment method deleted.');
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
        pane.innerHTML = '<p style="color:#888;">Loading…</p>';

        SB.from('treatment_items').select('*').order('item_code')
        .then(function (r) {
            var rows = r.data || [];
            var html =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin-bottom:20px;">' +
                '<h2 style="margin:0;font-size:20px;">Treatment Items</h2>' +
                '<button onclick="CFG._openTxPanel()" style="' +
                'padding:9px 20px;background:#0d6efd;color:#fff;' +
                'border:none;border-radius:6px;cursor:pointer;' +
                'font-size:13px;">+ Add Item</button></div>' +
                '<div id="txList">' + renderTxCards(rows) + '</div>' +
                txPanelHTML();
            pane.innerHTML = html;
        });
    }

    function renderTxCards(rows) {
        if (!rows.length) return '<p style="color:#888;">No treatment items found.</p>';
        return rows.map(function (d) {
            return '<div style="background:#fff;border-radius:8px;' +
                'padding:14px 18px;margin-bottom:8px;' +
                'box-shadow:0 1px 4px rgba(0,0,0,.08);' +
                'display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + esc(d.item_name) + '</strong>' +
                ' <span style="color:#888;font-size:12px;">[' + esc(d.item_code) + ']</span>' +
                (d.is_active ? '' : ' <span style="color:#dc3545;font-size:12px;">(Inactive)</span>') +
                '<div style="font-size:12px;color:#888;margin-top:3px;">' +
                (d.category || '') + (d.sub_category ? ' / ' + d.sub_category : '') +
                ' · $' + parseFloat(d.unit_price || 0).toFixed(2) +
                (d.unit ? ' / ' + d.unit : '') + '</div></div>' +
                '<div>' +
                '<button onclick="CFG._openTxPanel(\'' + d.id + '\')" style="' +
                'padding:6px 14px;background:#0d6efd;color:#fff;border:none;' +
                'border-radius:5px;cursor:pointer;font-size:12px;margin-right:6px;">' +
                'Edit</button>' +
                '<button onclick="CFG._deleteTx(\'' + d.id + '\',\'' +
                esc(d.item_name) + '\')" style="' +
                'padding:6px 14px;background:#dc3545;color:#fff;border:none;' +
                'border-radius:5px;cursor:pointer;font-size:12px;">Delete</button>' +
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
            '<h3 id="txPanelTitle" style="margin:0;font-size:17px;">Add Treatment Item</h3>' +
            '<button onclick="CFG._closeTxPanel()" style="background:none;' +
            'border:none;font-size:22px;cursor:pointer;color:#666;">&times;</button>' +
            '</div>' +
            fld('Item Code *',   'tx_code')              +
            fld('Item Name *',   'tx_name')              +
            fld('Category',      'tx_cat')               +
            fld('Sub-Category',  'tx_subcat')            +
            fld('Unit Price',    'tx_price',  'number')  +
            fld('Unit',          'tx_unit')              +
            '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:13px;color:#555;' +
            'margin-bottom:4px;">Colour</label>' +
            '<input type="color" id="tx_color" value="#4A90D9" ' +
            'style="width:60px;height:36px;border:1px solid #ddd;' +
            'border-radius:6px;cursor:pointer;"></div>' +
            '<div style="margin-bottom:20px;">' +
            '<label style="font-size:13px;color:#555;">' +
            '<input type="checkbox" id="tx_active" checked ' +
            'style="margin-right:6px;">Active</label></div>' +
            '<button onclick="CFG._saveTx()" style="width:100%;' +
            'padding:11px;background:#0d6efd;color:#fff;border:none;' +
            'border-radius:6px;cursor:pointer;font-size:14px;">' +
            'Save Item</button>' +
            '</div>';
    }

    function _openTxPanel(id) {
        _txEditId = id || null;
        var panel = g('txPanel');
        if (!panel) return;
        g('txPanelTitle').textContent = id ? 'Edit Treatment Item' : 'Add Treatment Item';

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
        if (!code || !name) { toast('Code and Name are required.', true); return; }

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
            toast(_txEditId ? 'Item updated.' : 'Item added.');
            _closeTxPanel();
            loadTreatment();
        });
    }

    function _deleteTx(id, name) {
        confirm('Delete treatment item "' + name + '"?', function () {
            SB.from('treatment_items').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast('Item deleted.');
                loadTreatment();
            });
        });
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: PROGRAM SETTINGS ────────────────────────────────
    // ════════════════════════════════════════════════════════
    var SETTING_KEYS = [
        { key: 'patient_no_prefix',        label: 'Patient No. Prefix',        type: 'text'     },
        { key: 'patient_no_digits',         label: 'Patient No. Digits',        type: 'number'   },
        { key: 'auto_generate_patient_code',label: 'Auto-generate Patient Code',type: 'checkbox' },
        { key: 'appt_default_duration',     label: 'Default Appt Duration (min)',type: 'number'  },
        { key: 'currency_symbol',           label: 'Currency Symbol',           type: 'text'     },
        { key: 'default_dentist',           label: 'Default Dentist',           type: 'text'     },
        { key: 'default_patient_female',    label: 'Default Patient Gender Female', type: 'checkbox' },
        { key: 'zero_ar',                   label: 'Allow Zero A/R',            type: 'checkbox' },
        { key: 'lock_medical_notes',        label: 'Lock Medical Notes',        type: 'checkbox' },
        { key: 'modify_medical_notes',      label: 'Allow Modify Medical Notes',type: 'checkbox' },
        { key: 'add_medical_term',          label: 'Add Medical Terms',         type: 'checkbox' },
        { key: 'audit_trail',               label: 'Audit Trail',               type: 'checkbox' },
        { key: 'login_timeout_minutes',     label: 'Login Timeout (min)',       type: 'number'   },
        { key: 'queue_refresh_interval',    label: 'Queue Refresh Interval (s)',type: 'number'   },
        { key: 'receipt_header',            label: 'Receipt Header',            type: 'textarea' },
        { key: 'receipt_footer',            label: 'Receipt Footer',            type: 'textarea' },
        { key: 'smtp_email',               label: 'SMTP Email',                type: 'text'     },
        { key: 'sms_config',               label: 'SMS Config',                type: 'text'     }
    ];

    function loadSettings() {
        // Must match index.html pane id="cfgPane-program"
        var pane = g('cfgPane-program');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">Loading…</p>';

        SB.from('program_settings').select('setting_key,setting_value')
        .then(function (r) {
            var map = {};
            (r.data || []).forEach(function (row) {
                map[row.setting_key] = row.setting_value;
            });

            var html = '<h2 style="margin:0 0 24px;font-size:20px;">' +
                'Program Settings</h2>' +
                '<div style="max-width:600px;">';

            SETTING_KEYS.forEach(function (s) {
                var val = map[s.key] !== undefined ? map[s.key] : '';
                html += '<div style="margin-bottom:16px;">' +
                    '<label style="display:block;font-size:13px;color:#555;' +
                    'margin-bottom:4px;">' + esc(s.label) + '</label>';

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
                html += '</div>';
            });

            html += '<button onclick="CFG._saveSettings()" style="' +
                'margin-top:8px;padding:10px 28px;background:#0d6efd;' +
                'color:#fff;border:none;border-radius:6px;' +
                'cursor:pointer;font-size:14px;">Save Settings</button>' +
                '</div>';

            pane.innerHTML = html;
        });
    }

    function _saveSettings() {
        var upserts = SETTING_KEYS.map(function (s) {
            var el  = g('set_' + s.key);
            var val = el
                ? (s.type === 'checkbox' ? String(el.checked) : el.value)
                : '';
            return { setting_key: s.key, setting_value: val };
        });

        SB.from('program_settings')
        .upsert(upserts, { onConflict: 'setting_key' })
        .then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast('Settings saved.');
        });
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: USERS ───────────────────────────────────────────
    // ════════════════════════════════════════════════════════
    var _usrEditId = null;
    var _usrClinics = [];
    var _usrDoctors = [];

    function loadUsers() {
        var pane = g('cfgPane-users');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">Loading…</p>';

        Promise.all([
            SB.from('clinics').select('id,clinic_code,english_name').order('clinic_code'),
            SB.from('doctors').select('id,doctor_code,english_name,is_active').order('doctor_code'),
            SB.from('app_users').select('*').order('user_id')
        ]).then(function (all) {
            _usrClinics = (all[0] && all[0].data) ? all[0].data : [];
            _usrDoctors = (all[1] && all[1].data) ? all[1].data.filter(function (d) { return d.is_active !== false; }) : [];
            var usersRes = all[2] || {};
            var rows = usersRes.data || [];

            var html =
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
                  '<div>' +
                    '<h2 style="margin:0;font-size:20px;">Users</h2>' +
                    '<div style="font-size:12px;color:#888;margin-top:4px;">' +
                      'Admins can set User ID & Password for dentists and staff. Nurse login is fixed as <b>nurse / nurse</b>.' +
                    '</div>' +
                  '</div>' +
                  '<button class="btn btn--primary" onclick="CFG._openUserPanel()">' +
                    '+ Add User' +
                  '</button>' +
                '</div>' +
                userPanelHTML() +
                '<div style="margin-top:12px;">' +
                  renderUsersTable(rows) +
                '</div>';

            pane.innerHTML = html;
        }).catch(function (e) {
            pane.innerHTML = '<p style="color:#dc3545;">Error: ' + esc(e.message) + '</p>';
        });
    }

    function renderUsersTable(rows) {
        if (!rows.length) {
            return '<div style="background:#fff;border:1px dashed #d7d7d7;border-radius:10px;' +
                'padding:18px;color:#888;text-align:center;">No users found.</div>';
        }

        var TH = 'padding:11px 12px;text-align:left;font-size:12px;font-weight:800;' +
            'color:#0d6efd;border-bottom:2px solid #dde8f5;text-transform:uppercase;' +
            'letter-spacing:.4px;white-space:nowrap;';
        var TD = 'padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:middle;';

        function clinicLabel(id) {
            var c = _usrClinics.find(function (x) { return x.id === id; });
            if (!c) return '-';
            return (c.clinic_code ? ('[' + c.clinic_code + '] ') : '') + (c.english_name || 'Clinic');
        }
        function doctorLabel(id) {
            var d = _usrDoctors.find(function (x) { return x.id === id; });
            if (!d) return '-';
            return (d.doctor_code ? ('[' + d.doctor_code + '] ') : '') + (d.english_name || 'Doctor');
        }

        var html =
            '<div style="background:#fff;border-radius:10px;overflow:hidden;' +
            'box-shadow:0 1px 4px rgba(0,0,0,.08);">' +
            '<table style="width:100%;border-collapse:collapse;">' +
            '<thead><tr style="background:#f0f7ff;">' +
              '<th style="' + TH + 'width:160px;">User ID</th>' +
              '<th style="' + TH + 'width:130px;">Role</th>' +
              '<th style="' + TH + '">Clinic</th>' +
              '<th style="' + TH + '">Doctor</th>' +
              '<th style="' + TH + 'width:90px;text-align:center;">Active</th>' +
              '<th style="' + TH + 'width:170px;text-align:center;">Actions</th>' +
            '</tr></thead><tbody>';

        rows.forEach(function (u) {
            var active = u.is_active !== false;
            html +=
              '<tr onmouseover="this.style.background=\'#f5f9ff\'" ' +
              'onmouseout="this.style.background=\'#fff\'">' +
                '<td style="' + TD + 'font-weight:900;color:#0d6efd;">' + esc(u.user_id || '-') + '</td>' +
                '<td style="' + TD + '">' + esc(u.role || '-') + '</td>' +
                '<td style="' + TD + '">' + esc(clinicLabel(u.clinic_id)) + '</td>' +
                '<td style="' + TD + '">' + esc(doctorLabel(u.doctor_id)) + '</td>' +
                '<td style="' + TD + 'text-align:center;">' +
                  (active
                    ? '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#d4edda;color:#155724;font-size:11px;font-weight:800;">Yes</span>'
                    : '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#f8d7da;color:#721c24;font-size:11px;font-weight:800;">No</span>') +
                '</td>' +
                '<td style="' + TD + 'text-align:center;">' +
                  '<button onclick="CFG._openUserPanel(\'' + esc(u.id) + '\')" ' +
                    'style="padding:6px 12px;background:#0d6efd;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:800;margin-right:6px;">Edit</button>' +
                  '<button onclick="CFG._deleteUser(\'' + esc(u.id) + '\',\'' + esc(u.user_id) + '\')" ' +
                    'style="padding:6px 12px;background:#dc3545;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:800;">Delete</button>' +
                '</td>' +
              '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function userPanelHTML() {
        function opt(list, getLabel) {
            return '<option value="">-- Select --</option>' + list.map(function (x) {
                return '<option value="' + esc(x.id) + '">' + esc(getLabel(x)) + '</option>';
            }).join('');
        }
        var clinicOpts = opt(_usrClinics, function (c) {
            return (c.clinic_code ? ('[' + c.clinic_code + '] ') : '') + (c.english_name || 'Clinic');
        });
        var doctorOpts = opt(_usrDoctors, function (d) {
            return (d.doctor_code ? ('[' + d.doctor_code + '] ') : '') + (d.english_name || 'Doctor');
        });

        return '' +
          '<div id="userPanel" style="display:none;margin-top:12px;max-width:980px;">' +
            '<div style="background:#fff;border-radius:12px;border:1px solid #eef2f7;' +
              'box-shadow:0 1px 4px rgba(0,0,0,.08);padding:14px 14px 12px;">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
                '<div>' +
                  '<div id="userPanelTitle" style="font-size:15px;font-weight:900;color:#0d6efd;">New User</div>' +
                  '<div style="font-size:12px;color:#888;margin-top:2px;">Set credentials for dentist/staff logins.</div>' +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                  '<button class="btn btn--ghost" onclick="CFG._closeUserPanel()">Close</button>' +
                  '<button class="btn btn--primary" onclick="CFG._saveUser()">Save</button>' +
                '</div>' +
              '</div>' +

              '<div style="display:grid;grid-template-columns:220px 220px 1fr;gap:10px;margin-top:12px;">' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">User ID *</label>' +
                  '<input id="usr_user_id" style="' + inputStyle() + '">' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">Password *</label>' +
                  '<input id="usr_password" type="text" style="' + inputStyle() + '" placeholder="Set password">' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">Display Name</label>' +
                  '<input id="usr_display_name" style="' + inputStyle() + '" placeholder="Optional">' +
                '</div>' +
              '</div>' +

              '<div style="display:grid;grid-template-columns:220px 1fr 1fr;gap:10px;margin-top:10px;">' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">Role</label>' +
                  '<select id="usr_role" style="' + inputStyle() + '">' +
                    '<option value="admin">admin</option>' +
                    '<option value="doctor">doctor</option>' +
                    '<option value="staff">staff</option>' +
                    '<option value="receptionist">receptionist</option>' +
                    '<option value="nurse">nurse</option>' +
                  '</select>' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">Clinic</label>' +
                  '<select id="usr_clinic_id" style="' + inputStyle() + '">' +
                    clinicOpts +
                  '</select>' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">Doctor (for dentist login)</label>' +
                  '<select id="usr_doctor_id" style="' + inputStyle() + '">' +
                    doctorOpts +
                  '</select>' +
                '</div>' +
              '</div>' +

              '<div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;">' +
                '<label style="font-size:12px;color:#555;font-weight:900;">' +
                  '<input id="usr_active" type="checkbox" checked style="margin-right:6px;">Active' +
                '</label>' +
                '<span style="color:#ddd;">|</span>' +
                '<button class="btn btn--secondary" onclick="CFG._ensureNurseLogin()">' +
                  'Create/Update nurse login (nurse/nurse)' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>';
    }

    function _openUserPanel(id) {
        _usrEditId = id || null;
        var panel = g('userPanel');
        if (!panel) return;
        panel.style.display = 'block';
        if (g('userPanelTitle')) g('userPanelTitle').textContent = id ? 'Edit User' : 'New User';

        // reset
        sv('usr_user_id', '');
        sv('usr_password', '');
        sv('usr_display_name', '');
        sv('usr_role', 'staff');
        sv('usr_clinic_id', '');
        sv('usr_doctor_id', '');
        var act = g('usr_active'); if (act) act.checked = true;

        if (!id) return;
        SB.from('app_users').select('*').eq('id', id).single()
        .then(function (r) {
            var u = r.data || {};
            sv('usr_user_id', u.user_id || '');
            sv('usr_password', u.password || '');
            sv('usr_display_name', u.display_name || '');
            sv('usr_role', u.role || 'staff');
            sv('usr_clinic_id', u.clinic_id || '');
            sv('usr_doctor_id', u.doctor_id || '');
            var act2 = g('usr_active'); if (act2) act2.checked = u.is_active !== false;
        });
    }

    function _closeUserPanel() {
        var panel = g('userPanel');
        if (panel) panel.style.display = 'none';
        _usrEditId = null;
    }

    function _saveUser() {
        var userId = (g('usr_user_id') || {}).value.trim();
        var pw = (g('usr_password') || {}).value;
        if (!userId || !pw) { toast('User ID and password are required.', true); return; }

        var payload = {
            user_id: userId,
            password: pw,
            display_name: (g('usr_display_name') || {}).value.trim() || null,
            role: (g('usr_role') || {}).value || 'staff',
            clinic_id: (g('usr_clinic_id') || {}).value || null,
            doctor_id: (g('usr_doctor_id') || {}).value || null,
            is_active: (g('usr_active') || {}).checked !== false
        };

        var op = _usrEditId
            ? SB.from('app_users').update(payload).eq('id', _usrEditId)
            : SB.from('app_users').insert([payload]);

        op.then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            toast(_usrEditId ? 'User updated.' : 'User added.');
            _closeUserPanel();
            loadUsers();
        });
    }

    function _deleteUser(id, userId) {
        confirm('Delete user "' + userId + '"?', function () {
            SB.from('app_users').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast('User deleted.');
                loadUsers();
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
            toast('Nurse login ensured (nurse/nurse).');
            loadUsers();
        });
    }

    // ════════════════════════════════════════════════════════
    // ── TAB: TEMPLATES ───────────────────────────────────────
    // ════════════════════════════════════════════════════════
    var _tplEditId = null;
    var _tplRowsCache = [];

    var TEMPLATE_PLACEHOLDERS = [
        { label: 'Patient No', tag: '{patient_no}' },
        { label: 'Patient Name', tag: '{patient_name}' },
        { label: 'Patient Phone', tag: '{patient_phone}' },
        { label: 'Patient HKID', tag: '{patient_hkid}' },
        { label: 'Patient DOB', tag: '{patient_dob}' },
        { label: 'Doctor', tag: '{doctor_name}' },
        { label: 'Clinic', tag: '{clinic_name}' },
        { label: 'Date', tag: '{date}' },
        { label: 'Time', tag: '{time}' },
        { label: 'Receipt No', tag: '{receipt_no}' },
        { label: 'Total', tag: '{total_amount}' }
    ];

    var SEED_TEMPLATES = [
        {
            name: 'Simple Receipt',
            type: 'receipt',
            content:
                '<h3 style="margin:0 0 10px;">Receipt</h3>' +
                '<div>Date: {date}</div>' +
                '<div>Receipt No: {receipt_no}</div>' +
                '<hr style="margin:12px 0;">' +
                '<div>Patient: {patient_name} ({patient_no})</div>' +
                '<div>Doctor: {doctor_name}</div>' +
                '<div style="margin-top:12px;font-weight:700;">Total: {total_amount}</div>'
        },
        {
            name: 'Prescription Header',
            type: 'prescription',
            content:
                '<h3 style="margin:0 0 10px;">Prescription</h3>' +
                '<div>Date: {date}</div>' +
                '<div>Patient: {patient_name} ({patient_no})</div>' +
                '<div>Doctor: {doctor_name}</div>' +
                '<hr style="margin:12px 0;">' +
                '<div>Rx:</div>'
        },
        {
            name: 'Consent Form Starter',
            type: 'consent',
            content:
                '<h3 style="margin:0 0 10px;">Consent Form</h3>' +
                '<p>Patient: <strong>{patient_name}</strong> ({patient_no})</p>' +
                '<p>Date: {date}</p>' +
                '<p>Doctor: {doctor_name}</p>' +
                '<hr>' +
                '<p>Consent content...</p>'
        }
    ];

    function loadTemplates() {
        var pane = g('cfgPane-templates');
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">Loading…</p>';

        SB.from('doc_templates').select('*').order('template_code')
        .then(function (r) {
            var rows = r.data || [];
            _tplRowsCache = rows;
            var html =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin:0 0 12px;">' +
                '<div>' +
                  '<h2 style="margin:0;font-size:20px;">Document Templates</h2>' +
                  '<div style="font-size:12px;color:#888;margin-top:4px;">' +
                    'Tip: click a row to edit. Use placeholder buttons to insert tags.' +
                  '</div>' +
                '</div>' +
                '<div style="display:flex;gap:10px;align-items:center;">' +
                  '<input id="tplSearch" placeholder="Search templates…" ' +
                  'oninput="CFG._filterTemplates(this.value)" ' +
                  'style="width:240px;padding:9px 10px;border:1px solid #ddd;' +
                  'border-radius:8px;font-size:13px;">' +
                  '<button onclick="CFG._openTplEditor()" style="' +
                  'padding:9px 18px;background:#0d6efd;color:#fff;' +
                  'border:none;border-radius:8px;cursor:pointer;' +
                  'font-size:13px;font-weight:700;">+ Add Template</button>' +
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
                'padding:22px;color:#888;text-align:center;">No templates yet.</div>';
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
            '<th style="' + TH + 'width:160px;">Code</th>' +
            '<th style="' + TH + '">Name</th>' +
            '<th style="' + TH + 'width:140px;">Type</th>' +
            '<th style="' + TH + 'width:90px;text-align:center;">Active</th>' +
            '<th style="' + TH + 'width:160px;text-align:center;">Actions</th>' +
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
                '<td style="' + TD + 'color:#555;">' + esc(type || '-') + '</td>' +
                '<td style="' + TD + 'text-align:center;">' +
                    (active
                        ? '<span style="display:inline-block;padding:3px 10px;border-radius:999px;' +
                          'background:#d4edda;color:#155724;font-size:11px;font-weight:800;">Yes</span>'
                        : '<span style="display:inline-block;padding:3px 10px;border-radius:999px;' +
                          'background:#f8d7da;color:#721c24;font-size:11px;font-weight:800;">No</span>') +
                '</td>' +
                '<td style="' + TD + 'text-align:center;">' +
                    '<button onclick="event.stopPropagation();CFG._openTplEditor(\'' + t.id + '\')" ' +
                    'style="padding:6px 12px;background:#0d6efd;color:#fff;border:none;border-radius:7px;' +
                    'cursor:pointer;font-size:12px;font-weight:700;margin-right:6px;">Edit</button>' +
                    '<button onclick="event.stopPropagation();CFG._deleteTpl(\'' + t.id + '\',\'' + esc(t.template_name) + '\')" ' +
                    'style="padding:6px 12px;background:#dc3545;color:#fff;border:none;border-radius:7px;' +
                    'cursor:pointer;font-size:12px;font-weight:700;">Delete</button>' +
                '</td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function tplEditorHTML() {
        var phBtns = TEMPLATE_PLACEHOLDERS.map(function (p) {
            return '<button type="button" onclick="CFG._insertTplTag(\'' + esc(p.tag) + '\')" ' +
                'style="padding:6px 10px;border:1px solid #d6e7ff;background:#f0f7ff;' +
                'color:#0d6efd;border-radius:999px;cursor:pointer;font-size:12px;font-weight:800;">' +
                esc(p.tag) + '</button>';
        }).join(' ');

        var seedBtns = SEED_TEMPLATES.map(function (s, idx) {
            return '<button type="button" onclick="CFG._applySeedTemplate(' + idx + ')" ' +
                'style="padding:7px 10px;border:1px solid #eee;background:#fff;' +
                'border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;">' +
                esc(s.name) + '</button>';
        }).join(' ');

        return '' +
            '<div id="tplEditorWrap" style="display:none;">' +
              '<div style="max-width:980px;margin:0 auto 12px;">' +
                '<div style="background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);' +
                'border:1px solid #eef2f7;padding:16px 16px 14px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">' +
                    '<div>' +
                      '<div id="tplEditorTitle" style="font-size:15px;font-weight:900;color:#0d6efd;">New Template</div>' +
                      '<div style="font-size:12px;color:#888;margin-top:2px;">Edit, then save. HTML is supported.</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;">' +
                      '<button type="button" onclick="CFG._closeTplEditor()" style="padding:9px 12px;background:#6c757d;' +
                      'color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;">Close</button>' +
                      '<button type="button" onclick="CFG._saveTpl()" style="padding:9px 14px;background:#0d6efd;' +
                      'color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:900;">Save</button>' +
                    '</div>' +
                  '</div>' +

                  '<div style="display:grid;grid-template-columns:160px 1fr 160px;gap:10px;margin-top:12px;">' +
                    '<div>' +
                      '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">Template Code *</label>' +
                      '<input id="tpl_code" style="' + inputStyle() + '">' +
                    '</div>' +
                    '<div>' +
                      '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">Template Name *</label>' +
                      '<input id="tpl_name" style="' + inputStyle() + '">' +
                    '</div>' +
                    '<div>' +
                      '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:4px;">Type</label>' +
                      '<select id="tpl_type" style="' + inputStyle() + '">' +
                        '<option value="receipt">receipt</option>' +
                        '<option value="prescription">prescription</option>' +
                        '<option value="consent">consent</option>' +
                        '<option value="report">report</option>' +
                      '</select>' +
                    '</div>' +
                  '</div>' +

                  '<div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap;">' +
                    '<label style="font-size:12px;color:#555;font-weight:800;">' +
                      '<input type="checkbox" id="tpl_active" checked style="margin-right:6px;">Active' +
                    '</label>' +
                    '<span style="color:#ddd;">|</span>' +
                    '<span style="font-size:12px;color:#555;font-weight:800;">Seed templates:</span>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + seedBtns + '</div>' +
                  '</div>' +

                  '<div style="margin-top:12px;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
                      '<div style="font-size:12px;color:#555;font-weight:800;">Placeholders (click to insert):</div>' +
                      '<button type="button" onclick="CFG._insertTplTag(\'{ }\')" ' +
                        'style="padding:6px 10px;border:1px solid #eee;background:#fff;border-radius:8px;' +
                        'cursor:pointer;font-size:12px;font-weight:800;">Insert custom { }</button>' +
                    '</div>' +
                    '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' + phBtns + '</div>' +
                  '</div>' +

                  '<div style="margin-top:12px;">' +
                    '<label style="display:block;font-size:12px;color:#555;font-weight:800;margin-bottom:6px;">Document (HTML)</label>' +
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
        if (title) title.textContent = id ? 'Edit Template' : 'New Template';

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
        if (!code || !name) { toast('Code and Name are required.', true); return; }

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
            toast(_tplEditId ? 'Template updated.' : 'Template added.');
            _closeTplEditor();
            loadTemplates();
        });
    }

    function _deleteTpl(id, name) {
        confirm('Delete template "' + name + '"?', function () {
            SB.from('doc_templates').delete().eq('id', id)
            .then(function (r) {
                if (r.error) { toast(r.error.message, true); return; }
                toast('Template deleted.');
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
        if (g('tpl_content')) g('tpl_content').value = s.content || '';
        if (g('tpl_content')) g('tpl_content').focus();
        toast('Seed template inserted.');
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
            '<h2 style="margin:0 0 24px;font-size:20px;">Data / Backup</h2>' +
            '<p style="color:#555;margin-bottom:24px;">Export data as CSV files.</p>' +
            '<div style="display:flex;flex-wrap:wrap;gap:12px;">' +
            exportBtn('Clinics',         'clinics')          +
            exportBtn('Doctors',         'doctors')          +
            exportBtn('Payment Methods', 'bill_types')       +
            exportBtn('Treatment Items', 'treatment_items')  +
            exportBtn('Patients',        'patients')         +
            exportBtn('Templates',       'doc_templates')    +
            '</div>';
    }

    function exportBtn(label, table) {
        return '<button onclick="CFG._exportCSV(\'' + table + '\',\'' +
            label + '\')" style="padding:11px 22px;background:#0d6efd;' +
            'color:#fff;border:none;border-radius:6px;cursor:pointer;' +
            'font-size:13px;">⬇ ' + esc(label) + '</button>';
    }

    function _exportCSV(table, label) {
        SB.from(table).select('*')
        .then(function (r) {
            if (r.error) { toast(r.error.message, true); return; }
            var rows = r.data || [];
            if (!rows.length) { toast('No data to export.', true); return; }

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
            a.download = table + '_' + new Date().toISOString().slice(0,10) + '.csv';
            a.click();
            URL.revokeObjectURL(url);
            toast(label + ' exported.');
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
                btn.textContent = '🖨️ Print Selected (' + n + ')';
            } else {
                btn.disabled = true;
                btn.style.background = '#6c757d';
                btn.style.cursor = 'not-allowed';
                btn.textContent = '🖨️ Print Selected';
            }
        }

        function _printSelectedDoctors() {
            if (!_selectedDoctorIds.length) {
                toast('Please select at least one doctor to print.', true);
                return;
            }
            SB.from('doctors').select('*').in('id', _selectedDoctorIds)
            .then(function (r) {
                if (r.error || !r.data || !r.data.length) {
                    toast('Error loading doctor data.', true); return;
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
                var body = '<h1>👨‍⚕️ Doctor Information Report</h1>' +
                    '<p style="color:#888;font-size:12px;margin-bottom:28px;">Generated: ' +
                    new Date().toLocaleString() + '</p>';
                r.data.forEach(function (d) {
                    body +=
                        '<div class="doc">' +
                        '<h2>' + esc(d.english_name || d.doctor_code) +
                        (d.chinese_name ? ' (' + esc(d.chinese_name) + ')' : '') + '</h2>' +
                        '<table>' +
                        '<tr><td class="lbl">Doctor Code</td><td>'   + esc(d.doctor_code   || '-') + '</td></tr>' +
                        '<tr><td class="lbl">English Name</td><td>'  + esc(d.english_name  || '-') + '</td></tr>' +
                        '<tr><td class="lbl">Chinese Name</td><td>'  + esc(d.chinese_name  || '-') + '</td></tr>' +
                        '<tr><td class="lbl">Qualification</td><td>' + esc(d.qualification || '-') + '</td></tr>' +
                        '<tr><td class="lbl">Telephone</td><td>'     + esc(d.tel           || '-') + '</td></tr>' +
                        '<tr><td class="lbl">Email</td><td>'         + esc(d.email         || '-') + '</td></tr>' +
                        '<tr><td class="lbl">Calendar Color</td><td>' +
                            '<span class="swatch" style="background:' + esc(d.color || '#aaa') + ';"></span>' +
                            esc(d.color || '-') + '</td></tr>' +
                        '<tr><td class="lbl">Status</td><td>' +
                            (d.is_active
                                ? '<strong style="color:#28a745;">Active</strong>'
                                : '<strong style="color:#dc3545;">Inactive</strong>') +
                        '</td></tr>' +
                        '</table></div>';
                });
                var win = window.open('', '_blank', 'width=720,height=600');
                if (!win) { toast('Allow popups to print.', true); return; }
                win.document.write(
                    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
                    '<title>Doctor Report</title>' +
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
                btn.textContent = '🖨️ Print Selected (' + _selectedClinicIds.length + ')';
            } else {
                btn.disabled = true;
                btn.style.background = '#6c757d';
                btn.style.cursor = 'not-allowed';
                btn.textContent = '🖨️ Print Selected';
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
                toast('Active clinic updated to: ' + id);
            } else {
                // Don't allow unchecking without selecting another
                toast('Please select another clinic as active first.', true);
                loadClinic(); // Refresh to reset the toggle
            }
        }

        function _printSelectedClinics() {
            if (!_selectedClinicIds.length) {
                toast('Please select at least one clinic to print.', true);
                return;
            }

            SB.from('clinics').select('*')
                .in('id', _selectedClinicIds)
            .then(function(r) {
                if (r.error || !r.data || !r.data.length) {
                    toast('Error loading clinic data.', true);
                    return;
                }

                var clinics = r.data;
                var printContent = '<html><head><title>Clinic Information</title>' +
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
                    '<h1>🏥 Clinic Information Report</h1>' +
                    '<p style="color:#666;margin-bottom:30px;">Generated: ' +
                    new Date().toLocaleString() + '</p>';

                clinics.forEach(function(c) {
                    printContent +=
                        '<div class="clinic">' +
                        '<h2>' + esc(c.english_name || c.clinic_code) +
                        (c.chinese_name ? ' (' + esc(c.chinese_name) + ')' : '') + '</h2>' +
                        '<table>' +
                        '<tr><td class="label">Clinic Code</td><td>' + esc(c.clinic_code || '-') + '</td></tr>' +
                        '<tr><td class="label">English Name</td><td>' + esc(c.english_name || '-') + '</td></tr>' +
                        '<tr><td class="label">Chinese Name</td><td>' + esc(c.chinese_name || '-') + '</td></tr>' +
                        '<tr><td class="label">Qualification</td><td>' + esc(c.qualification || '-') + '</td></tr>' +
                        '<tr><td class="label">Address</td><td>' + esc(c.address || '-') + '</td></tr>' +
                        '<tr><td class="label">Telephone</td><td>' + esc(c.tel || '-') + '</td></tr>' +
                        '<tr><td class="label">Fax</td><td>' + esc(c.fax || '-') + '</td></tr>' +
                        '<tr><td class="label">Opening Hours</td><td>' +
                        esc(c.open_at || '-') + ' ~ ' + esc(c.close_at || '-') + '</td></tr>' +
                        '<tr><td class="label">Appointment Interval</td><td>' +
                        (c.appt_interval ? c.appt_interval + ' minutes' : '-') + '</td></tr>' +
                        '</table></div>';
                });

                printContent += '</body></html>';

                var printWindow = window.open('', '_blank');
                if (!printWindow) {
                    toast('Please allow popups to print.', true);
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

        return {
            init:                   init,
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
        _closeUserPanel: _closeUserPanel,
        _saveUser: _saveUser,
        _deleteUser: _deleteUser,
        _ensureNurseLogin: _ensureNurseLogin,
        // data
        _exportCSV:     _exportCSV
    };

})();

