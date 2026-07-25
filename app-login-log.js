// ════════════════════════════════════════════════════════════════
// app-login-log.js — User login session log (Config → Users)
// ════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var LOGIN_LOG_TABLE = 'user_login_log';
    var PENDING_LS_KEY = 'jsm_pending_login_log';
    var _activeLoginLogId = null;
    var _usrClinicsCache = [];

    function t(key, en, zhCn, zhHant) {
        if (typeof ctr === 'function') return ctr(key);
        if (typeof appTr === 'function') return appTr(key);
        return en;
    }

    function esc(s) {
        return typeof escHtml === 'function' ? escHtml(s) : String(s == null ? '' : s);
    }

    function sbReady() {
        return typeof SB !== 'undefined' && SB && typeof SB.from === 'function';
    }

    function fmtDateTime(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return String(iso);
            if (typeof fmtDateTimeLocal === 'function') return fmtDateTimeLocal(d);
            return d.toLocaleString();
        } catch (e) {
            return String(iso);
        }
    }

    function fmtDuration(seconds, active) {
        if (active) return t('cfg.loginLog.active', 'Active', '在线', '在線');
        if (seconds == null || isNaN(seconds) || seconds < 0) return '—';
        seconds = Math.floor(Number(seconds));
        if (seconds < 60) return seconds + 's';
        var m = Math.floor(seconds / 60);
        if (m < 60) return m + 'm';
        var h = Math.floor(m / 60);
        m = m % 60;
        if (h < 48) return h + 'h ' + m + 'm';
        var days = Math.floor(h / 24);
        h = h % 24;
        return days + 'd ' + h + 'h';
    }

    function logoutReasonLabel(reason) {
        var map = {
            manual: t('cfg.loginLog.reasonManual', 'Signed out', '手动登出', '手動登出'),
            idle_timeout: t('cfg.loginLog.reasonIdle', 'Idle timeout', '空闲超时', '閒置逾時'),
            session_expired: t('cfg.loginLog.reasonExpired', 'Session expired', '会话过期', '工作階段過期')
        };
        return map[String(reason || '')] || (reason ? String(reason) : '—');
    }

    function roleLabel(role, isAdmin) {
        if (isAdmin) return t('cfg.loginLog.roleAdmin', 'Admin', '管理员', '管理員');
        var r = String(role || '').toLowerCase();
        if (r === 'doctor' || r === 'dentist') return t('cfg.loginLog.roleDoctor', 'Doctor', '医生', '醫生');
        if (r === 'nurse') return t('cfg.loginLog.roleNurse', 'Nurse', '护士', '護士');
        if (r === 'reception') return t('cfg.loginLog.roleReception', 'Reception', '接待', '接待');
        if (r === 'staff') return t('cfg.loginLog.roleStaff', 'Staff', '员工', '員工');
        return role || '—';
    }

    function setActiveLoginLogId(id) {
        _activeLoginLogId = id ? String(id) : null;
        if (typeof persistSession === 'function') {
            try { persistSession(); } catch (e) {}
        }
    }

    function restoreActiveLoginLogIdFromSession() {
        try {
            var raw = localStorage.getItem('jsm_session');
            if (!raw) return;
            var s = JSON.parse(raw);
            if (s && s.login_log_id) _activeLoginLogId = String(s.login_log_id);
        } catch (e) {}
    }

    function clinicSnapshot(clinicId) {
        clinicId = String(clinicId || '').trim();
        if (!clinicId) return { clinic_id: null, clinic_code: null, clinic_name: null };
        var rec = typeof clinicRecordFromId === 'function' ? clinicRecordFromId(clinicId) : null;
        if (!rec && _usrClinicsCache.length) {
            rec = _usrClinicsCache.find(function (c) { return String(c.id) === clinicId; });
        }
        if (!rec) return { clinic_id: clinicId, clinic_code: null, clinic_name: null };
        return {
            clinic_id: clinicId,
            clinic_code: rec.clinic_code || null,
            clinic_name: typeof clinicDisplayName === 'function'
                ? clinicDisplayName(rec)
                : (rec.english_name || rec.clinic_code || null)
        };
    }

    function isUuid(v) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
    }

    function sanitizeLoginLogPayload(payload) {
        var p = Object.assign({}, payload || {});
        if (!isUuid(p.clinic_id)) p.clinic_id = null;
        if (!isUuid(p.doctor_id)) p.doctor_id = null;
        return p;
    }

    function logLoginLogError(action, r) {
        var err = r && r.error;
        if (!err) return;
        var msg = err.message || String(err);
        var code = err.code || '';
        var hint = err.hint || '';
        console.warn('[login-log] ' + action + ' failed:', msg, code ? ('code=' + code) : '', hint);
        if (/does not exist|PGRST205|404|NOT_FOUND/i.test(msg + code)) {
            console.warn('[login-log] Run user_login_log.sql in Supabase SQL Editor, then hard-refresh (Ctrl+Shift+R).');
        }
    }

    function insertLoginLogRow(payload) {
        if (!sbReady()) return Promise.resolve(null);
        payload = sanitizeLoginLogPayload(payload);
        if (!payload.user_id) return Promise.resolve(null);
        return SB.from(LOGIN_LOG_TABLE).insert([payload]).select('id').then(function (r) {
            if (r.error) {
                logLoginLogError('insert', r);
                return null;
            }
            var id = r.data && r.data[0] ? r.data[0].id : null;
            if (id) setActiveLoginLogId(id);
            return id;
        }).catch(function (e) {
            console.warn('[login-log] insert error:', e);
            return null;
        });
    }

    function buildPendingPayload(u, doctorId, opts) {
        opts = opts || {};
        u = u || {};
        var uid = String(u.user_id || currentUserId || '').trim();
        var role = String(u.role || currentRole || '').toLowerCase();
        var isAdmin = role === 'admin' || uid.toLowerCase() === 'admin';
        var display = String(u.display_name || '').trim();
        if (!display) {
            if (uid.toLowerCase() === 'nurse') display = 'Nurse';
            else display = uid || '—';
        }
        var clinicId = opts.clinic_id ||
            (typeof selectedLoginClinicId === 'function' ? selectedLoginClinicId() : '') ||
            currentClinicId || null;
        var clinic = clinicSnapshot(clinicId);
        var docId = doctorId || currentDoctorId || null;
        var docName = currentDoctorName || null;
        return {
            user_id: uid,
            display_name: display,
            role: role || null,
            is_admin: !!isAdmin,
            clinic_id: clinic.clinic_id,
            clinic_code: clinic.clinic_code,
            clinic_name: clinic.clinic_name,
            doctor_id: docId,
            doctor_name: docName,
            login_at: new Date().toISOString(),
            logout_reason: null,
            user_agent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : null,
            login_method: opts.login_method || 'password',
            session_active: true
        };
    }

    function queuePendingLoginLog(u, doctorId, opts) {
        try {
            localStorage.setItem(PENDING_LS_KEY, JSON.stringify(buildPendingPayload(u, doctorId, opts)));
        } catch (e) {}
    }

    /** Insert login row immediately (preferred — no localStorage round-trip). */
    function recordLoginLog(u, doctorId, opts) {
        return insertLoginLogRow(buildPendingPayload(u, doctorId, opts));
    }

    function flushPendingLoginLog() {
        if (!sbReady()) return Promise.resolve(null);
        var raw = null;
        try { raw = localStorage.getItem(PENDING_LS_KEY); } catch (e) {}
        if (!raw) return Promise.resolve(null);
        var payload = null;
        try { payload = JSON.parse(raw); } catch (e2) {
            try { localStorage.removeItem(PENDING_LS_KEY); } catch (e3) {}
            return Promise.resolve(null);
        }
        if (!payload || !payload.user_id) {
            try { localStorage.removeItem(PENDING_LS_KEY); } catch (e4) {}
            return Promise.resolve(null);
        }
        return insertLoginLogRow(payload).then(function (id) {
            if (id) {
                try { localStorage.removeItem(PENDING_LS_KEY); } catch (e5) {}
            }
            return id;
        });
    }

    function closeActiveLoginLog(reason) {
        if (!sbReady() || !_activeLoginLogId) return Promise.resolve();
        var id = _activeLoginLogId;
        var now = new Date().toISOString();
        return SB.from(LOGIN_LOG_TABLE).select('login_at').eq('id', id).maybeSingle().then(function (r) {
            if (r.error) logLoginLogError('close-read', r);
            var loginAt = r.data && r.data.login_at ? new Date(r.data.login_at) : null;
            var dur = loginAt ? Math.max(0, Math.floor((Date.now() - loginAt.getTime()) / 1000)) : null;
            return SB.from(LOGIN_LOG_TABLE).update({
                logout_at: now,
                duration_seconds: dur,
                logout_reason: reason || 'manual',
                session_active: false
            }).eq('id', id);
        }).catch(function () {
            return SB.from(LOGIN_LOG_TABLE).update({
                logout_at: now,
                logout_reason: reason || 'manual',
                session_active: false
            }).eq('id', id);
        }).finally(function () {
            setActiveLoginLogId(null);
        });
    }

    function renderLoginLogTable(rows) {
        var TH = 'padding:10px 12px;text-align:left;font-size:11px;font-weight:800;' +
            'color:#0d6efd;border-bottom:2px solid #dde8f5;text-transform:uppercase;' +
            'letter-spacing:.35px;white-space:nowrap;';
        var TD = 'padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:middle;';

        if (!rows || !rows.length) {
            return '<div style="padding:16px;color:#888;text-align:center;background:#fff;border-radius:10px;' +
                'border:1px dashed #ddd;">' + esc(t('cfg.loginLog.empty', 'No login records yet.', '暂无登录记录。', '尚無登入記錄。')) +
                '</div>';
        }

        var html =
            '<div style="background:#fff;border-radius:10px;overflow:hidden;' +
            'box-shadow:0 1px 4px rgba(0,0,0,.08);">' +
            '<table style="width:100%;border-collapse:collapse;min-width:980px;">' +
            '<thead><tr style="background:#f0f7ff;">' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colLogin', 'Login', '登录时间', '登入時間')) + '</th>' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colLogout', 'Logout', '登出时间', '登出時間')) + '</th>' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colDuration', 'Duration', '时长', '時長')) + '</th>' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colUser', 'User', '用户', '使用者')) + '</th>' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colRole', 'Role', '角色', '角色')) + '</th>' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colClinic', 'Clinic', '诊所', '診所')) + '</th>' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colDoctor', 'Doctor identity', '医生身份', '醫生身份')) + '</th>' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colReason', 'End reason', '结束原因', '結束原因')) + '</th>' +
            '<th style="' + TH + '">' + esc(t('cfg.loginLog.colStatus', 'Status', '状态', '狀態')) + '</th>' +
            '</tr></thead><tbody>';

        rows.forEach(function (row) {
            var isAdmin = row.is_admin === true || String(row.role || '').toLowerCase() === 'admin';
            var trStyle = isAdmin
                ? 'background:linear-gradient(90deg,#fff8e6 0%,#fffdf5 100%);border-left:4px solid #d97706;'
                : '';
            var userCell = esc(row.display_name || row.user_id || '—');
            if (isAdmin) {
                userCell = '<span class="cfg-login-log-admin-badge">' +
                    esc(t('cfg.loginLog.adminBadge', 'ADMIN', '管理员', '管理員')) + '</span> ' + userCell;
            }
            var clinicLbl = row.clinic_name || row.clinic_code || '—';
            if (row.clinic_code && row.clinic_name && row.clinic_name.indexOf(row.clinic_code) < 0) {
                clinicLbl = row.clinic_name + ' [' + row.clinic_code + ']';
            }
            var active = row.session_active !== false && !row.logout_at;
            html +=
                '<tr style="' + trStyle + '">' +
                '<td style="' + TD + 'white-space:nowrap;">' + esc(fmtDateTime(row.login_at)) + '</td>' +
                '<td style="' + TD + 'white-space:nowrap;">' + esc(fmtDateTime(row.logout_at)) + '</td>' +
                '<td style="' + TD + 'white-space:nowrap;font-weight:700;">' +
                    esc(fmtDuration(row.duration_seconds, active)) + '</td>' +
                '<td style="' + TD + '"><div style="font-weight:700;">' + userCell + '</div>' +
                    '<div style="font-size:11px;color:#64748b;">' + esc(row.user_id || '') + '</div></td>' +
                '<td style="' + TD + '">' + esc(roleLabel(row.role, isAdmin)) + '</td>' +
                '<td style="' + TD + '">' + esc(clinicLbl) + '</td>' +
                '<td style="' + TD + '">' + esc(row.doctor_name || '—') + '</td>' +
                '<td style="' + TD + '">' + esc(logoutReasonLabel(row.logout_reason)) + '</td>' +
                '<td style="' + TD + '">' +
                    (active
                        ? '<span style="color:#059669;font-weight:700;">● ' +
                            esc(t('cfg.loginLog.statusActive', 'Online', '在线', '在線')) + '</span>'
                        : '<span style="color:#64748b;">' +
                            esc(t('cfg.loginLog.statusEnded', 'Ended', '已结束', '已結束')) + '</span>') +
                '</td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function loadLoginLogRows(filters) {
        filters = filters || {};
        if (!sbReady()) {
            return Promise.resolve({ rows: [], error: t('cfg.loginLog.noDb', 'Database not available.', '数据库不可用。', '資料庫不可用。') });
        }
        var q = SB.from(LOGIN_LOG_TABLE)
            .select('id,user_id,display_name,role,is_admin,clinic_id,clinic_code,clinic_name,' +
                'doctor_id,doctor_name,login_at,logout_at,duration_seconds,logout_reason,session_active,user_agent')
            .order('login_at', { ascending: false })
            .limit(Math.min(500, Math.max(20, Number(filters.limit) || 200)));

        if (filters.clinic_id) q = q.eq('clinic_id', filters.clinic_id);
        if (filters.user_id) q = q.ilike('user_id', '%' + filters.user_id + '%');
        if (filters.admin_only) q = q.eq('is_admin', true);

        return q.then(function (r) {
            if (r.error) {
                var msg = r.error.message || String(r.error);
                var code = r.error.code || '';
                if (/does not exist|relation|PGRST205|404/i.test(msg + code)) {
                    msg = t('cfg.loginLog.tableMissing',
                        'Table user_login_log not found — run user_login_log.sql in Supabase.',
                        '未找到 user_login_log 表 — 请在 Supabase 运行 user_login_log.sql。',
                        '未找到 user_login_log 表 — 請在 Supabase 執行 user_login_log.sql。');
                }
                logLoginLogError('load', r);
                return { rows: [], error: msg };
            }
            return { rows: r.data || [], error: null };
        });
    }

    function loginLogFiltersFromUi() {
        var clinicSel = g('cfgLoginLogClinic');
        var userInp = g('cfgLoginLogUser');
        var adminCb = g('cfgLoginLogAdminOnly');
        return {
            clinic_id: clinicSel ? String(clinicSel.value || '').trim() : '',
            user_id: userInp ? String(userInp.value || '').trim() : '',
            admin_only: !!(adminCb && adminCb.checked),
            limit: 200
        };
    }

    function refreshLoginLogSection() {
        var body = g('cfgLoginLogBody');
        if (!body) return;
        body.innerHTML = '<p style="color:#888;padding:12px;">' +
            esc(t('common.loadingEllipsis', 'Loading…', '加载中…', '載入中…')) + '</p>';
        loadLoginLogRows(loginLogFiltersFromUi()).then(function (res) {
            if (!body) return;
            if (res.error) {
                body.innerHTML = '<p style="color:#dc3545;padding:12px;">' + esc(res.error) + '</p>';
                return;
            }
            body.innerHTML = renderLoginLogTable(res.rows);
        });
    }

    function renderLoginLogSection(clinics) {
        _usrClinicsCache = clinics || [];
        var clinicOpts = '<option value="">' +
            esc(t('cfg.loginLog.allClinics', 'All clinics', '全部诊所', '全部診所')) + '</option>';
        (_usrClinicsCache || []).forEach(function (c) {
            var lbl = typeof clinicDisplayName === 'function' ? clinicDisplayName(c) : (c.english_name || c.clinic_code);
            clinicOpts += '<option value="' + esc(c.id) + '">' + esc(lbl) + '</option>';
        });

        return (
            '<section id="cfgLoginLogSection" class="cfg-login-log-section" style="margin-top:28px;">' +
            '<style>' +
            '.cfg-login-log-section{border-top:2px solid #e2e8f0;padding-top:22px;}' +
            '.cfg-login-log-admin-badge{display:inline-block;background:#d97706;color:#fff;font-size:10px;' +
            'font-weight:800;padding:2px 7px;border-radius:999px;letter-spacing:.06em;vertical-align:middle;}' +
            '.cfg-login-log-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:14px 0;}' +
            '.cfg-login-log-filters label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#64748b;}' +
            '.cfg-login-log-filters select,.cfg-login-log-filters input{padding:7px 10px;border:1px solid #cbd5e1;' +
            'border-radius:8px;font-size:13px;min-width:140px;}' +
            '</style>' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">' +
            '<div>' +
            '<h3 style="margin:0;font-size:18px;color:#0f172a;">' +
                esc(t('cfg.loginLog.title', 'Login history', '登录记录', '登入記錄')) + '</h3>' +
            '<p style="margin:6px 0 0;font-size:12px;color:#64748b;max-width:720px;line-height:1.5;">' +
                esc(t('cfg.loginLog.hint',
                    'All user sign-ins with clinic, role, doctor identity, session duration, and sign-out reason. Admin logins are highlighted.',
                    '全部用户登录记录，含诊所、角色、医生身份、会话时长与登出原因。管理员登录以高亮显示。',
                    '全部使用者登入記錄，含診所、角色、醫生身份、工作階段時長與登出原因。管理員登入以高亮顯示。')) +
            '</p>' +
            '</div>' +
            '<button type="button" class="btn btn--secondary" onclick="LOGINLOG.refresh()">' +
                esc(t('cfg.loginLog.refresh', 'Refresh', '刷新', '重新整理')) +
            '</button>' +
            '</div>' +
            '<div class="cfg-login-log-filters">' +
            '<label>' + esc(t('cfg.loginLog.filterClinic', 'Clinic', '诊所', '診所')) +
            '<select id="cfgLoginLogClinic" onchange="LOGINLOG.refresh()">' + clinicOpts + '</select></label>' +
            '<label>' + esc(t('cfg.loginLog.filterUser', 'User ID', '用户 ID', '使用者 ID')) +
            '<input id="cfgLoginLogUser" type="text" placeholder="admin / drchan …" onkeydown="if(event.key===\'Enter\')LOGINLOG.refresh()"></label>' +
            '<label style="flex-direction:row;align-items:center;gap:8px;padding-top:18px;cursor:pointer;">' +
            '<input id="cfgLoginLogAdminOnly" type="checkbox" onchange="LOGINLOG.refresh()"> ' +
            esc(t('cfg.loginLog.adminOnly', 'Admin only', '仅管理员', '僅管理員')) + '</label>' +
            '<button type="button" class="btn btn--primary" style="margin-top:18px;" onclick="LOGINLOG.refresh()">' +
                esc(t('cfg.loginLog.apply', 'Apply filters', '应用筛选', '套用篩選')) +
            '</button>' +
            '</div>' +
            '<div id="cfgLoginLogBody"></div>' +
            '</section>'
        );
    }

    function initBoot() {
        restoreActiveLoginLogIdFromSession();
        if (typeof currentUserId !== 'undefined' && currentUserId) {
            flushPendingLoginLog();
        }
    }

    window.LOGINLOG = {
        recordLogin: recordLoginLog,
        queueFromSession: queuePendingLoginLog,
        flushPending: flushPendingLoginLog,
        closeActive: closeActiveLoginLog,
        getActiveId: function () { return _activeLoginLogId; },
        setActiveId: setActiveLoginLogId,
        renderSectionHtml: renderLoginLogSection,
        refresh: refreshLoginLogSection,
        initBoot: initBoot
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBoot);
    } else {
        setTimeout(initBoot, 0);
    }
})();
