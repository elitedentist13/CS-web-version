/* ════════════════════════════════════════════════════════════════════
 *  app-patient-recall.js — standalone Appt Reminder + Set-recall modal
 *
 *  Does NOT modify Recall Patient, RSVP, Broadcast, or AI Helper.
 *  Own table: patient_recalls. Own UI, strings, calendar, and handlers.
 *
 *  Public API:
 *     PATIENT_RECALL.open(ctx)
 *     PATIENT_RECALL.showPanel()
 *     PATIENT_RECALL.init()
 * ════════════════════════════════════════════════════════════════════ */
var PATIENT_RECALL = (function () {
    'use strict';

    var TABLE = 'patient_recalls';
    var TAB_KEY = 'reminder';
    var PANEL_VER = '5';
    var TPL_PREF = 'prc_twilio_tpl_id_v1';
    var FROM_PREF = 'prc_twilio_from_id_v1';
    var PH_CHIPS = [
        'NAME', 'FULL_NAME', 'CHINESE', 'ENGLISH',
        'CLINIC', 'CLINIC_EN', 'CLINIC_ZH',
        'DATE', 'DOCTOR', 'REMARKS', 'PHONE', 'PATIENT_NO'
    ];
    var INTERVALS = {
        '3m': { months: 3 },
        '6m': { months: 6 },
        '9m': { months: 9 },
        '1y': { months: 12 }
    };

    var I18N = {
        'prc.action': { en: 'Set Review', 'zh-CN': '设定复查', 'zh-Hant': '設定覆查' },
        'prc.title': { en: 'Set Review', 'zh-CN': '设定复查', 'zh-Hant': '設定覆查' },
        'prc.tab': { en: '🔔 Appt Reminder', 'zh-CN': '🔔 复诊提醒', 'zh-Hant': '🔔 覆診提醒' },
        'prc.date': { en: 'Date', 'zh-CN': '日期', 'zh-Hant': '日期' },
        'prc.clinic': { en: 'Clinic', 'zh-CN': '诊所', 'zh-Hant': '診所' },
        'prc.doctor': { en: 'Doctor', 'zh-CN': '医生', 'zh-Hant': '醫生' },
        'prc.remarks': { en: 'Remarks', 'zh-CN': '备注', 'zh-Hant': '備註' },
        'prc.remarksPh': { en: 'Optional notes', 'zh-CN': '可选备注', 'zh-Hant': '可選備註' },
        'prc.save': { en: 'Save', 'zh-CN': '保存', 'zh-Hant': '儲存' },
        'prc.3m': { en: '3 Month', 'zh-CN': '3个月', 'zh-Hant': '3個月' },
        'prc.6m': { en: '6 Month', 'zh-CN': '6个月', 'zh-Hant': '6個月' },
        'prc.9m': { en: '9 Month', 'zh-CN': '9个月', 'zh-Hant': '9個月' },
        'prc.1y': { en: '1 Year', 'zh-CN': '1年', 'zh-Hant': '1年' },
        'prc.delete': { en: 'Delete', 'zh-CN': '删除', 'zh-Hant': '刪除' },
        'prc.return': { en: 'Return', 'zh-CN': '返回', 'zh-Hant': '返回' },
        'prc.th.date': { en: 'Date', 'zh-CN': '日期', 'zh-Hant': '日期' },
        'prc.th.remarks': { en: 'Remarks', 'zh-CN': '备注', 'zh-Hant': '備註' },
        'prc.th.clinic': { en: 'Clinic', 'zh-CN': '诊所', 'zh-Hant': '診所' },
        'prc.th.doctor': { en: 'Doctor', 'zh-CN': '医生', 'zh-Hant': '醫生' },
        'prc.th.patient': { en: 'Patient', 'zh-CN': '患者', 'zh-Hant': '病人' },
        'prc.th.tel': { en: 'Telephone', 'zh-CN': '电话', 'zh-Hant': '電話' },
        'prc.th.status': { en: 'Status', 'zh-CN': '状态', 'zh-Hant': '狀態' },
        'prc.th.contacted': { en: 'Contacted', 'zh-CN': '已联络', 'zh-Hant': '已聯絡' },
        'prc.th.pick': { en: '', 'zh-CN': '', 'zh-Hant': '' },
        'prc.err.noPatient': { en: 'No patient is linked to this row.', 'zh-CN': '此行没有关联患者。', 'zh-Hant': '此列沒有關聯病人。' },
        'prc.err.noDate': { en: 'Please select a recall date.', 'zh-CN': '请选择复诊日期。', 'zh-Hant': '請選擇覆診日期。' },
        'prc.err.noClinic': { en: 'Please select a clinic for this reminder.', 'zh-CN': '请选择此提醒所属诊所。', 'zh-Hant': '請選擇此提醒所屬診所。' },
        'prc.err.schema': { en: 'Run patient_recalls.sql in the Supabase SQL editor, then try again.', 'zh-CN': '请先在 Supabase SQL 编辑器运行 patient_recalls.sql。', 'zh-Hant': '請先在 Supabase SQL 編輯器執行 patient_recalls.sql。' },
        'prc.err.save': { en: 'Could not save the recall.', 'zh-CN': '无法保存复诊。', 'zh-Hant': '無法儲存覆診。' },
        'prc.err.delete': { en: 'Could not delete the recall.', 'zh-CN': '无法删除复诊。', 'zh-Hant': '無法刪除覆診。' },
        'prc.err.noPhone': { en: 'No phone number on the selected row(s).', 'zh-CN': '所选行没有电话号码。', 'zh-Hant': '所選列沒有電話號碼。' },
        'prc.err.noSel': { en: 'No reminder rows to send. Click View first.', 'zh-CN': '没有可发送的复诊提醒。请先点击查看。', 'zh-Hant': '沒有可發送的覆診提醒。請先按查看。' },
        'prc.panel.selAll': { en: 'All', 'zh-CN': '全选', 'zh-Hant': '全選' },
        'prc.panel.selNone': { en: 'None', 'zh-CN': '全不选', 'zh-Hant': '全不選' },
        'prc.panel.selected': { en: '{N} selected', 'zh-CN': '已选 {N}', 'zh-Hant': '已選 {N}' },
        'prc.send.title': { en: 'Send reminders', 'zh-CN': '发送提醒', 'zh-Hant': '發送提醒' },
        'prc.send.progress': { en: '{I} of {N}', 'zh-CN': '{I} / {N}', 'zh-Hant': '{I} / {N}' },
        'prc.send.open': { en: 'Open', 'zh-CN': '打开', 'zh-Hant': '開啟' },
        'prc.send.send': { en: 'Send', 'zh-CN': '发送', 'zh-Hant': '發送' },
        'prc.send.skip': { en: 'Skip', 'zh-CN': '跳过', 'zh-Hant': '跳過' },
        'prc.send.next': { en: 'Next', 'zh-CN': '下一位', 'zh-Hant': '下一位' },
        'prc.send.done': { en: 'Done', 'zh-CN': '完成', 'zh-Hant': '完成' },
        'prc.send.noPhone': { en: 'No phone — skip.', 'zh-CN': '无电话，已跳过。', 'zh-Hant': '無電話，已跳過。' },
        'prc.send.needTpl': { en: 'Select a Twilio WhatsApp template, or open Twilio Setup to add one.', 'zh-CN': '请选择 Twilio WhatsApp 模板，或打开 Twilio 设置添加。', 'zh-Hant': '請選擇 Twilio WhatsApp 模板，或開啟 Twilio 設定新增。' },
        'prc.send.via': { en: 'Send via', 'zh-CN': '发送方式', 'zh-Hant': '發送方式' },
        'prc.send.start': { en: 'Send reminders', 'zh-CN': '发送提醒', 'zh-Hant': '發送提醒' },
        'prc.send.placeholders': { en: 'Placeholders', 'zh-CN': '占位符', 'zh-Hant': '佔位符' },
        'prc.send.phNote': { en: 'Click a chip to insert. {CLINIC} uses the clinic saved on that reminder.', 'zh-CN': '点击插入。{CLINIC} 使用该提醒已保存的诊所。', 'zh-Hant': '點擊插入。{CLINIC} 使用該提醒已儲存的診所。' },
        'prc.send.waReadonly': { en: 'Read-only: approved Twilio Content Template. Live WhatsApp text is sent by Twilio — edit templates in Twilio Setup.', 'zh-CN': '只读：已核准的 Twilio 内容模板。实际 WhatsApp 由 Twilio 发送 — 请在 Twilio 设置中编辑模板。', 'zh-Hant': '唯讀：已核准的 Twilio 內容範本。實際 WhatsApp 由 Twilio 發送 — 請在 Twilio 設定中編輯範本。' },
        'prc.send.tplEmpty': { en: 'No templates yet. Open Twilio Setup to add one.', 'zh-CN': '尚无模板。请打开 Twilio 设置添加。', 'zh-Hant': '尚無範本。請開啟 Twilio 設定新增。' },
        'prc.send.tplHint': { en: '{SID}', 'zh-CN': '{SID}', 'zh-Hant': '{SID}' },
        'prc.send.from': { en: 'Send from (Twilio number)', 'zh-CN': '发送号码（Twilio）', 'zh-Hant': '發送號碼（Twilio）' },
        'prc.send.fromDefault': { en: 'Default (Edge secret)', 'zh-CN': '默认（Edge 密钥）', 'zh-Hant': '預設（Edge 密鑰）' },
        'prc.send.fromHint': { en: 'Default uses Edge secrets. Pick a saved number to override.', 'zh-CN': '默认使用 Edge 密钥。可改选已保存号码。', 'zh-Hant': '預設使用 Edge 密鑰。可改選已儲存號碼。' },
        'prc.send.fromPicked': { en: 'Sending from {FROM}', 'zh-CN': '将从 {FROM} 发送', 'zh-Hant': '將從 {FROM} 發送' },
        'prc.send.setup': { en: 'Twilio Setup', 'zh-CN': 'Twilio 设置', 'zh-Hant': 'Twilio 設定' },
        'prc.send.reload': { en: 'Reload', 'zh-CN': '重新加载', 'zh-Hant': '重新載入' },
        'prc.send.tpl': { en: 'Twilio Content Template', 'zh-CN': 'Twilio 内容模板', 'zh-Hant': 'Twilio 內容範本' },
        'prc.send.smsHint': { en: 'Twilio SMS sends the message box text from the selected Twilio number.', 'zh-CN': 'Twilio 短信发送编辑框中的文字。', 'zh-Hant': 'Twilio 短訊發送編輯框中的文字。' },
        'prc.send.msgPh': { en: 'Message with {NAME} {CLINIC} {DATE}…', 'zh-CN': '可用 {NAME} {CLINIC} {DATE}…', 'zh-Hant': '可用 {NAME} {CLINIC} {DATE}…' },
        'prc.send.console': { en: 'Open Twilio Content Template Builder →', 'zh-CN': '打开 Twilio 内容模板生成器 →', 'zh-Hant': '開啟 Twilio 內容範本產生器 →' },
        'prc.send.fromNoWa': { en: 'That From number is not enabled for WhatsApp.', 'zh-CN': '该发送号码未开通 WhatsApp。', 'zh-Hant': '該發送號碼未開通 WhatsApp。' },
        'prc.send.fromNoSms': { en: 'That From number is not enabled for SMS.', 'zh-CN': '该发送号码未开通短信。', 'zh-Hant': '該發送號碼未開通短訊。' },
        'prc.send.ok': { en: 'Sent.', 'zh-CN': '已发送。', 'zh-Hant': '已發送。' },
        'prc.send.fail': { en: 'Send failed.', 'zh-CN': '发送失败。', 'zh-Hant': '發送失敗。' },
        'prc.send.finished': { en: 'Finished the monthly list ({N}).', 'zh-CN': '本月名单已处理完（{N}）。', 'zh-Hant': '本月名單已處理完（{N}）。' },
        'prc.send.hint': { en: 'Same month list — one patient at a time.', 'zh-CN': '按月份名单，逐位发送。', 'zh-Hant': '按月份名單，逐位發送。' },
        'prc.panel.title': { en: 'Appointment Reminder', 'zh-CN': '复诊提醒', 'zh-Hant': '覆診提醒' },
        'prc.panel.from': { en: 'From', 'zh-CN': '由', 'zh-Hant': '由' },
        'prc.panel.to': { en: 'To', 'zh-CN': '至', 'zh-Hant': '至' },
        'prc.panel.patRange': { en: 'Patient no.', 'zh-CN': '病历号', 'zh-Hant': '病歷號' },
        'prc.panel.usePatRange': { en: 'Filter by patient no.', 'zh-CN': '按病历号筛选', 'zh-Hant': '按病歷號篩選' },
        'prc.panel.all': { en: 'ALL', 'zh-CN': '全部', 'zh-Hant': '全部' },
        'prc.panel.view': { en: 'View', 'zh-CN': '查看', 'zh-Hant': '查看' },
        'prc.panel.export': { en: 'Export', 'zh-CN': '导出', 'zh-Hant': '匯出' },
        'prc.panel.print': { en: 'Print', 'zh-CN': '列印', 'zh-Hant': '列印' },
        'prc.panel.wa': { en: 'WhatsApp', 'zh-CN': 'WhatsApp', 'zh-Hant': 'WhatsApp' },
        'prc.panel.sms': { en: 'SMS', 'zh-CN': '短信', 'zh-Hant': '短訊' },
        'prc.panel.twilioWa': { en: 'Twilio WhatsApp', 'zh-CN': 'Twilio WhatsApp', 'zh-Hant': 'Twilio WhatsApp' },
        'prc.panel.twilioSms': { en: 'Twilio SMS', 'zh-CN': 'Twilio 短信', 'zh-Hant': 'Twilio 短訊' },
        'prc.panel.records': { en: 'No. of records = {N}', 'zh-CN': '记录数 = {N}', 'zh-Hant': '紀錄數 = {N}' },
        'prc.panel.empty': { en: 'No reminder rows for these filters. Click View.', 'zh-CN': '没有符合条件的复诊提醒。请点击查看。', 'zh-Hant': '沒有符合條件的覆診提醒。請按查看。' },
        'prc.status.planned': { en: 'planned', 'zh-CN': '待复诊', 'zh-Hant': '待覆診' },
        'prc.status.reminded': { en: 'reminded', 'zh-CN': '已提醒', 'zh-Hant': '已提醒' },
        'prc.status.booked': { en: 'booked', 'zh-CN': '已预约', 'zh-Hant': '已預約' },
        'prc.status.done': { en: 'done', 'zh-CN': '完成', 'zh-Hant': '完成' },
        'prc.status.cancelled': { en: 'cancelled', 'zh-CN': '取消', 'zh-Hant': '取消' },
        'prc.msg.body': {
            en: '{NAME} — reminder from {CLINIC} on {DATE}. {REMARKS}',
            'zh-CN': '{NAME} — {CLINIC} 复诊提醒：{DATE}。{REMARKS}',
            'zh-Hant': '{NAME} — {CLINIC} 覆診提醒：{DATE}。{REMARKS}'
        }
    };

    var _ready = false;
    var _ctx = null;
    var _rows = [];
    var _selId = null;
    var _selDate = '';
    var _calMonth = new Date();
    var _saving = false;
    var _panelRows = [];
    var _panelSel = Object.create(null);
    var _queueObs = null;
    var _dirObs = null;
    var _sendQ = [];
    var _sendIdx = 0;
    var _sendKind = '';
    var _sendBusy = false;
    var _channel = 'wa';
    var _msgDraft = '';
    var _msgLocked = false;

    function g(id) { return document.getElementById(id); }

    function lang() {
        if (typeof appUiLang === 'string' && appUiLang) return appUiLang;
        return 'en';
    }

    function tr(key) {
        var pack = I18N[key];
        if (!pack) return key;
        var L = lang();
        return pack[L] || pack.en || key;
    }

    function trRepl(key, pairs) {
        var s = tr(key);
        if (!pairs) return s;
        Object.keys(pairs).forEach(function (k) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        });
        return s;
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function pad(n) {
        if (typeof window.pad === 'function') return window.pad(n);
        return String(n).padStart(2, '0');
    }

    function todayIso() {
        if (typeof window.todayISO === 'function') return window.todayISO();
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function addMonths(iso, months) {
        var p = String(iso || '').split('-');
        if (p.length < 3) return iso;
        var y = parseInt(p[0], 10);
        var m = parseInt(p[1], 10) - 1;
        var day = parseInt(p[2], 10);
        var dt = new Date(y, m + months, 1);
        var last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
        dt.setDate(Math.min(day, last));
        return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    }

    function nextMonthRange() {
        var t = String(todayIso() || '').split('-');
        var y = parseInt(t[0], 10);
        var m = parseInt(t[1], 10);
        if (!y || !m) {
            var d = new Date();
            y = d.getFullYear();
            m = d.getMonth() + 1;
        }
        var nm = m === 12 ? 1 : m + 1;
        var ny = m === 12 ? y + 1 : y;
        var last = new Date(ny, nm, 0).getDate();
        return {
            from: ny + '-' + pad(nm) + '-01',
            to: ny + '-' + pad(nm) + '-' + pad(last)
        };
    }

    function isoToDmy(iso) {
        var p = String(iso || '').split('-');
        if (p.length < 3) return iso || '';
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function toast(msg) {
        if (typeof showAppGlobalToast === 'function') showAppGlobalToast(msg);
        else alert(msg);
    }

    function sbOk() {
        return typeof SB !== 'undefined' && SB && typeof SB.from === 'function';
    }

    function isSchemaErr(err) {
        var m = String((err && err.message) || err || '').toLowerCase();
        return m.indexOf('patient_recalls') >= 0 ||
            m.indexOf('does not exist') >= 0 ||
            m.indexOf('schema cache') >= 0 ||
            (err && err.code === '42P01');
    }

    function clinicList() {
        var raw = (typeof APP_CLINICS !== 'undefined' && APP_CLINICS) ? APP_CLINICS : [];
        if (typeof clinicsForWorkingSession === 'function') return clinicsForWorkingSession(raw);
        return raw.filter(function (c) { return c && c.is_active !== false; });
    }

    function clinicFromTag(tag) {
        tag = String(tag || '').trim();
        if (!tag) return null;
        var list = (typeof APP_CLINICS !== 'undefined' && APP_CLINICS) ? APP_CLINICS : [];
        var low = tag.toLowerCase();
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            var code = String(c.clinic_code || '').trim();
            if (code === tag || String(c.id) === tag) return c;
            if (code && code.toLowerCase() === low) return c;
            if (String(c.id).toLowerCase() === low) return c;
        }
        return null;
    }

    function resolveClinicTag(raw) {
        var tag = String(raw || '').trim();
        var rec = clinicFromTag(tag);
        if (rec) return clinicTagOf(rec);
        return tag;
    }

    function clinicRecForRow(row) {
        row = row || {};
        var rec = clinicFromTag(row.clinic_tag);
        if (!rec && row.clinic_id && typeof clinicRecordFromId === 'function') {
            rec = clinicRecordFromId(row.clinic_id);
        }
        return rec;
    }

    function clinicNameForRow(row, opts) {
        opts = opts || {};
        var rec = clinicRecForRow(row);
        if (rec && typeof clinicNameForOutboundMessage === 'function') {
            return clinicNameForOutboundMessage({
                body: opts.body || tr('prc.msg.body'),
                lang: opts.lang || '',
                clinic: rec,
                fallback: clinicLabel(rec)
            }) || clinicLabel(rec);
        }
        return rec ? clinicLabel(rec) : String((row && row.clinic_tag) || '');
    }

    function clinicLabel(c) {
        if (typeof clinicDisplayName === 'function') return clinicDisplayName(c);
        if (!c) return '';
        return c.english_name || c.chinese_name || c.clinic_code || '';
    }

    function clinicTagOf(c) {
        if (!c) return '';
        return String(c.clinic_code || c.id || '').trim();
    }

    function doctorLabel(d) {
        if (typeof doctorDisplayName === 'function') return doctorDisplayName(d);
        if (!d) return '';
        return d.english_name || d.display_name || d.chinese_name || d.doctor_code || '';
    }

    function doctorsForTag(tag) {
        var rec = clinicFromTag(tag);
        var cid = rec ? rec.id : '';
        if (typeof doctorsForClinic === 'function') {
            var list = doctorsForClinic(cid);
            if (list && list.length) return list.filter(function (d) { return d && d.is_active !== false; });
        }
        var all = (typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS) ? APP_DOCTORS : [];
        return all.filter(function (d) { return d && d.is_active !== false; });
    }

    function currentTag() {
        if (typeof currentClinicCodeForTagging === 'function') {
            return String(currentClinicCodeForTagging() || '').trim();
        }
        return '';
    }

    function currentDocId() {
        return (typeof currentDoctorId !== 'undefined' && currentDoctorId) ? String(currentDoctorId) : '';
    }

    function currentUser() {
        return (typeof currentUserId !== 'undefined' && currentUserId) ? String(currentUserId) : '';
    }

    function applyI18n(root) {
        if (!root) return;
        root.querySelectorAll('[data-prc-i18n]').forEach(function (el) {
            el.textContent = tr(el.getAttribute('data-prc-i18n'));
        });
        root.querySelectorAll('[data-prc-i18n-ph]').forEach(function (el) {
            el.setAttribute('placeholder', tr(el.getAttribute('data-prc-i18n-ph')));
        });
    }

    function weekdayHdr() {
        var L = lang();
        if (L.indexOf('zh') === 0) return ['日', '一', '二', '三', '四', '五', '六'];
        return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    }

    /* ── shell (modal + panel + css) ─────────────────────────── */

    function cssText() {
        return [
            '.prc-box{max-width:860px;}',
            '.prc-patient-line{margin:0 0 12px;font-size:13px;color:#475569;}',
            '.prc-top{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;}',
            '.prc-cal{width:240px;flex-shrink:0;border:1px solid #c5c5c5;padding:8px;background:#fff;}',
            '.prc-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}',
            '.prc-cal-title{font-size:13px;font-weight:700;}',
            '.prc-cal-nav{border:1px solid #ddd;background:#f8f8f8;width:28px;height:26px;cursor:pointer;}',
            '.prc-cal table{width:100%;border-collapse:collapse;text-align:center;font-size:12px;}',
            '.prc-cal th{padding:3px 0;color:#64748b;font-weight:600;}',
            '.prc-cal td{padding:0;}',
            '.prc-cal-day{display:block;padding:5px 0;cursor:pointer;border-radius:3px;}',
            '.prc-cal-day:hover{background:#e8f4ff;color:#0084ff;}',
            '.prc-cal-day.is-today{font-weight:800;background:#dbeafe;color:#0084ff;}',
            '.prc-cal-day.is-sel{background:#0084ff;color:#fff;font-weight:700;}',
            '.prc-fields{flex:1;min-width:260px;display:grid;grid-template-columns:88px 1fr;gap:8px 10px;align-items:center;}',
            '.prc-fields input,.prc-fields select{width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;box-sizing:border-box;}',
            '.prc-grid-wrap{margin-top:14px;min-height:176px;max-height:280px;overflow:auto;border:1px solid #c5c5c5;}',
            '.prc-grid{width:100%;border-collapse:collapse;background:#fff8c8;font-size:13px;}',
            '.prc-grid th{background:#e8e8e8;text-align:left;padding:6px 8px;position:sticky;top:0;z-index:1;}',
            '.prc-grid td{padding:5px 8px;border-top:1px solid #eee4a0;}',
            '.prc-grid tr.prc-row-sel{outline:2px solid #2563eb;background:#ffe27a;}',
            '.prc-grid tr{cursor:pointer;}',
            '.prc-grid tr.prc-row-blank{cursor:default;}',
            '.prc-grid tr.prc-row-blank td{height:26px;}',
            '.prc-bar{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}',
            '.prc-btn{border:1px solid #bbb;background:#f3f3f3;padding:8px 14px;cursor:pointer;font-size:13px;border-radius:4px;}',
            '.prc-btn-primary{background:#2563eb;color:#fff;border-color:#1d4ed8;}',
            '.prc-btn-danger{background:#dc2626;color:#fff;border-color:#b91c1c;}',
            '.prc-btn-danger:disabled{opacity:.45;cursor:not-allowed;}',
            '.btn-prc{background:#7c3aed;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;}',
            '.btn-prc:hover{background:#6d28d9;}',
            '.action-item .ai-icon.prc-ai-bell{color:#eab308;filter:none;}',
            '#tab-reminder.tab-pane{padding-top:10px;}',
            '.prc-panel-head{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:flex-end;margin-bottom:12px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;}',
            '.prc-filt{display:flex;flex-direction:column;gap:4px;min-width:140px;}',
            '.prc-filt label{font-size:11px;font-weight:700;color:#475569;}',
            '.prc-filt input,.prc-filt select{padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;}',
            '.prc-filt-row{display:flex;gap:8px;align-items:center;}',
            '.prc-panel-grid-wrap{max-height:420px;overflow:auto;border:1px solid #c5c5c5;}',
            '.prc-panel-grid{width:100%;border-collapse:collapse;background:#fff8c8;font-size:13px;}',
            '.prc-panel-grid th{background:#e8e8e8;text-align:left;padding:6px 8px;position:sticky;top:0;z-index:1;}',
            '.prc-panel-grid td{padding:5px 8px;border-top:1px solid #eee4a0;}',
            '.prc-panel-grid tr.is-on{background:#ffe27a;}',
            '.prc-count-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:8px 0 12px;}',
            '.prc-count{margin:0;font-size:12px;font-weight:700;color:#334155;}',
            '.prc-sel-btns{display:flex;gap:6px;}',
            '.prc-btn-mini{padding:4px 10px;font-size:12px;}',
            '.prc-panel-bar{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;}',
            '.prc-panel-bar .prc-btn-wa{background:#25d366;color:#fff;border-color:#1ebe5d;}',
            '.prc-panel-bar .prc-btn-sms{background:#0084ff;color:#fff;border-color:#0369a1;}',
            '.prc-panel-bar .prc-btn-twa{background:#0f766e;color:#fff;border-color:#0f766e;}',
            '.prc-panel-bar .prc-btn-tsms{background:#0369a1;color:#fff;border-color:#0369a1;}',
            '.prc-send-box{max-width:440px;}',
            '.prc-send-hint{font-size:11px;color:#94a3b8;margin:0 0 12px;line-height:1.45;}',
            '.prc-send-progress{font-size:12px;font-weight:700;color:#475569;margin-bottom:10px;}',
            '.prc-send-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px;}',
            '.prc-send-card .prc-send-name{font-size:15px;font-weight:700;}',
            '.prc-send-card .prc-send-phone{font-size:13px;font-weight:700;color:#0084ff;margin-top:6px;display:block;}',
            '.prc-send-card .prc-send-msg{margin-top:10px;font-size:12px;color:#334155;white-space:pre-wrap;}',
            '.prc-send-status{min-height:18px;margin-bottom:8px;font-size:12px;font-weight:600;color:#047857;}',
            '.prc-send-status.is-err{color:#b91c1c;}',
            '.prc-send-actions{display:flex;gap:8px;margin-bottom:8px;}',
            '.prc-send-actions .prc-btn{flex:1;}',
            '.prc-send-next{width:100%;padding:11px;background:#475569;color:#fff;border-color:#334155;font-weight:700;}',
            '.prc-composer{margin-top:16px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:16px;}',
            '.prc-chan{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}',
            '.prc-chan-label{font-weight:700;font-size:13px;color:#374151;}',
            '.prc-pill{padding:7px 16px;border-radius:20px;border:2px solid #e5e7eb;background:#fff;color:#374151;font-size:13px;font-weight:700;cursor:pointer;}',
            '.prc-pill.is-on.prc-pill-wa{background:#25d366;border-color:#25d366;color:#fff;}',
            '.prc-pill.is-on.prc-pill-sms{background:#0084ff;border-color:#0084ff;color:#fff;}',
            '.prc-pill.is-on.prc-pill-twa{background:#0f766e;border-color:#0f766e;color:#fff;}',
            '.prc-pill.is-on.prc-pill-tsms{background:#0369a1;border-color:#0369a1;color:#fff;}',
            '.prc-twilio-box{display:none;margin-bottom:14px;padding:12px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;}',
            '.prc-twilio-box.is-on{display:block;}',
            '.prc-twilio-label{display:block;font-size:12px;font-weight:800;color:#334155;margin-bottom:6px;}',
            '.prc-twilio-box select{max-width:520px;width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;}',
            '.prc-twilio-hint{margin:6px 0 0;font-size:11px;color:#64748b;line-height:1.45;}',
            '.prc-tpl-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
            '.prc-chips{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:8px;}',
            '.prc-ph-chip{padding:3px 8px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;font-size:11px;font-weight:700;cursor:pointer;font-family:ui-monospace,Consolas,monospace;}',
            '.prc-msg-box{width:100%;padding:12px;font-size:13px;line-height:1.6;border:1.5px solid #e2e8f0;border-radius:8px;resize:vertical;box-sizing:border-box;font-family:inherit;outline:none;background:#fff;color:#1e293b;}',
            '.prc-msg-box.is-lock{background:#f1f5f9;color:#334155;cursor:default;border-color:#cbd5e1;}',
            '.prc-send-start{margin-top:10px;min-width:180px;padding:11px 18px;background:linear-gradient(135deg,#0084ff,#0066cc);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;}'
        ].join('');
    }

    function modalHtml() {
        return (
            '<div id="patientRecallModal" class="modal modal-no-backdrop-close" data-no-backdrop-close="1" style="display:none;">' +
            '<div class="modal-box prc-box">' +
            '<button type="button" class="mclose" id="prcCloseBtn" aria-label="Close">×</button>' +
            '<h3 id="prcTitle" data-prc-i18n="prc.title"></h3>' +
            '<p id="prcPatientLine" class="prc-patient-line"></p>' +
            '<div class="prc-top">' +
            '<div class="prc-cal" id="prcCal"></div>' +
            '<div class="prc-fields">' +
            '<label data-prc-i18n="prc.date"></label><input id="prcDate" type="text" readonly>' +
            '<label data-prc-i18n="prc.clinic"></label><select id="prcClinic"></select>' +
            '<label data-prc-i18n="prc.doctor"></label><select id="prcDoctor"></select>' +
            '<label data-prc-i18n="prc.remarks"></label>' +
            '<input id="prcRemarks" type="text" autocomplete="off" data-prc-i18n-ph="prc.remarksPh">' +
            '</div></div>' +
            '<div class="prc-grid-wrap"><table class="prc-grid"><thead><tr>' +
            '<th data-prc-i18n="prc.th.date"></th><th data-prc-i18n="prc.th.remarks"></th>' +
            '<th data-prc-i18n="prc.th.clinic"></th><th data-prc-i18n="prc.th.doctor"></th>' +
            '</tr></thead><tbody id="prcBody"></tbody></table></div>' +
            '<div class="prc-bar">' +
            '<button type="button" id="prcSaveBtn" class="prc-btn prc-btn-primary" data-prc-i18n="prc.save"></button>' +
            '<button type="button" class="prc-btn" data-prc-interval="3m" data-prc-i18n="prc.3m"></button>' +
            '<button type="button" class="prc-btn" data-prc-interval="6m" data-prc-i18n="prc.6m"></button>' +
            '<button type="button" class="prc-btn" data-prc-interval="9m" data-prc-i18n="prc.9m"></button>' +
            '<button type="button" class="prc-btn" data-prc-interval="1y" data-prc-i18n="prc.1y"></button>' +
            '<button type="button" id="prcDeleteBtn" class="prc-btn prc-btn-danger" disabled data-prc-i18n="prc.delete"></button>' +
            '<button type="button" id="prcReturnBtn" class="prc-btn" data-prc-i18n="prc.return"></button>' +
            '</div></div></div>'
        );
    }

    function panelHtml() {
        return (
            '<div id="tab-reminder" class="tab-pane">' +
            '<h3 style="margin:0 0 10px;font-size:16px;" data-prc-i18n="prc.panel.title"></h3>' +
            '<div class="prc-panel-head">' +
            '<div class="prc-filt"><label data-prc-i18n="prc.clinic"></label><select id="prcPClinic"></select></div>' +
            '<div class="prc-filt"><label data-prc-i18n="prc.doctor"></label><select id="prcPDoctor"></select></div>' +
            '<div class="prc-filt"><label data-prc-i18n="prc.panel.from"></label><input id="prcPFrom" type="date"></div>' +
            '<div class="prc-filt"><label data-prc-i18n="prc.panel.to"></label><input id="prcPTo" type="date"></div>' +
            '<div class="prc-filt"><label><input type="checkbox" id="prcPUseNo"> <span data-prc-i18n="prc.panel.usePatRange"></span></label>' +
            '<div class="prc-filt-row"><input id="prcPNoFrom" type="text" style="width:90px;" disabled>' +
            '<span>–</span><input id="prcPNoTo" type="text" style="width:90px;" disabled></div></div>' +
            '<button type="button" id="prcPViewBtn" class="prc-btn prc-btn-primary" data-prc-i18n="prc.panel.view"></button>' +
            '</div>' +
            '<div class="prc-panel-grid-wrap"><table class="prc-panel-grid"><thead><tr>' +
            '<th style="width:28px;"></th>' +
            '<th data-prc-i18n="prc.th.date"></th>' +
            '<th data-prc-i18n="prc.th.clinic"></th>' +
            '<th data-prc-i18n="prc.th.patient"></th>' +
            '<th data-prc-i18n="prc.th.tel"></th><th data-prc-i18n="prc.th.remarks"></th>' +
            '<th data-prc-i18n="prc.th.status"></th><th data-prc-i18n="prc.th.contacted"></th>' +
            '</tr></thead><tbody id="prcPBody"></tbody></table></div>' +
            '<div class="prc-count-row">' +
            '<div id="prcPCount" class="prc-count"></div>' +
            '<div class="prc-sel-btns">' +
            '<button type="button" id="prcPSelAllBtn" class="prc-btn prc-btn-mini" data-prc-i18n="prc.panel.selAll"></button>' +
            '<button type="button" id="prcPSelNoneBtn" class="prc-btn prc-btn-mini" data-prc-i18n="prc.panel.selNone"></button>' +
            '</div></div>' +
            '<div class="prc-panel-bar">' +
            '<button type="button" id="prcPExportBtn" class="prc-btn" data-prc-i18n="prc.panel.export"></button>' +
            '<button type="button" id="prcPPrintBtn" class="prc-btn" data-prc-i18n="prc.panel.print"></button>' +
            '</div>' +
            composerHtml() +
            '</div>'
        );
    }

    function composerHtml() {
        return (
            '<div class="prc-composer">' +
            '<div class="prc-chan">' +
            '<span class="prc-chan-label" data-prc-i18n="prc.send.via"></span>' +
            '<button type="button" id="prcChanWa" class="prc-pill prc-pill-wa is-on" data-prc-chan="wa" data-prc-i18n="prc.panel.wa"></button>' +
            '<button type="button" id="prcChanSms" class="prc-pill prc-pill-sms" data-prc-chan="sms" data-prc-i18n="prc.panel.sms"></button>' +
            '<button type="button" id="prcChanTwa" class="prc-pill prc-pill-twa" data-prc-chan="twilio_wa" data-prc-i18n="prc.panel.twilioWa"></button>' +
            '<button type="button" id="prcChanTsms" class="prc-pill prc-pill-tsms" data-prc-chan="twilio_sms" data-prc-i18n="prc.panel.twilioSms"></button>' +
            '</div>' +
            '<div id="prcTwilioBox" class="prc-twilio-box">' +
            '<div style="margin-bottom:12px;">' +
            '<label class="prc-twilio-label" for="prcTwilioFrom" data-prc-i18n="prc.send.from"></label>' +
            '<select id="prcTwilioFrom"></select>' +
            '<p id="prcTwilioFromHint" class="prc-twilio-hint" data-prc-i18n="prc.send.fromHint"></p>' +
            '<p class="prc-twilio-hint"><button type="button" id="prcTwilioSetupBtn" class="prc-btn prc-btn-mini" data-prc-i18n="prc.send.setup"></button></p>' +
            '</div>' +
            '<div id="prcTwilioTplWrap">' +
            '<label class="prc-twilio-label" for="prcTwilioTpl" data-prc-i18n="prc.send.tpl"></label>' +
            '<div class="prc-tpl-row">' +
            '<select id="prcTwilioTpl" style="flex:1;min-width:220px;"></select>' +
            '<button type="button" id="prcTwilioReloadBtn" class="prc-btn prc-btn-mini" data-prc-i18n="prc.send.reload"></button>' +
            '<button type="button" id="prcTwilioSetupBtn2" class="prc-btn prc-btn-mini" data-prc-i18n="prc.send.setup"></button>' +
            '</div>' +
            '<p id="prcTwilioTplHint" class="prc-twilio-hint"></p>' +
            '<p class="prc-twilio-hint"><a href="https://console.twilio.com/us1/develop/sms/content-template-builder" target="_blank" rel="noopener noreferrer" data-prc-i18n="prc.send.console"></a></p>' +
            '</div>' +
            '<p id="prcTwilioSmsHint" class="prc-twilio-hint" style="display:none;" data-prc-i18n="prc.send.smsHint"></p>' +
            '</div>' +
            '<div id="prcMsgTools">' +
            '<div id="prcChips" class="prc-chips"></div>' +
            '</div>' +
            '<textarea id="prcMsgBox" class="prc-msg-box" rows="5" data-prc-i18n-ph="prc.send.msgPh"></textarea>' +
            '<p id="prcPhNote" class="prc-twilio-hint" data-prc-i18n="prc.send.phNote"></p>' +
            '<p id="prcWaReadonlyNote" class="prc-twilio-hint" style="display:none;" data-prc-i18n="prc.send.waReadonly"></p>' +
            '<button type="button" id="prcPSendBtn" class="prc-send-start" data-prc-i18n="prc.send.start"></button>' +
            '</div>'
        );
    }

    function sendModalHtml() {
        return (
            '<div id="prcSendModal" class="modal modal-no-backdrop-close" data-no-backdrop-close="1" style="display:none;z-index:4600;">' +
            '<div class="modal-box prc-send-box">' +
            '<button type="button" class="mclose" id="prcSendCloseBtn" aria-label="Close">×</button>' +
            '<h3 data-prc-i18n="prc.send.title"></h3>' +
            '<p class="prc-send-hint" data-prc-i18n="prc.send.hint"></p>' +
            '<div id="prcSendProgress" class="prc-send-progress"></div>' +
            '<div id="prcSendCard" class="prc-send-card"></div>' +
            '<div id="prcSendStatus" class="prc-send-status"></div>' +
            '<div class="prc-send-actions">' +
            '<button type="button" id="prcSendOpenBtn" class="prc-btn prc-btn-primary"></button>' +
            '<button type="button" id="prcSendSkipBtn" class="prc-btn" data-prc-i18n="prc.send.skip"></button>' +
            '</div>' +
            '<button type="button" id="prcSendNextBtn" class="prc-btn prc-send-next"></button>' +
            '</div></div>'
        );
    }

    function ensureShell() {
        var st = g('prcPluginStyle');
        if (st && st.getAttribute('data-prc-ver') !== PANEL_VER) {
            st.remove();
            st = null;
        }
        if (!g('prcPluginStyle')) {
            st = document.createElement('style');
            st.id = 'prcPluginStyle';
            st.setAttribute('data-prc-ver', PANEL_VER);
            st.textContent = cssText();
            document.head.appendChild(st);
        }
        if (!g('patientRecallModal')) {
            var wrap = document.createElement('div');
            wrap.innerHTML = modalHtml();
            document.body.appendChild(wrap.firstElementChild);
        }
        if (!g('prcSendModal')) {
            var sendWrap = document.createElement('div');
            sendWrap.innerHTML = sendModalHtml();
            document.body.appendChild(sendWrap.firstElementChild);
        }
        injectTab();
        applyI18n(g('patientRecallModal'));
        applyI18n(g('tab-reminder'));
        applyI18n(g('prcSendModal'));
    }

    function injectTab() {
        var pane = g('tab-reminder');
        if (pane && pane.getAttribute('data-prc-ver') !== PANEL_VER) {
            pane.remove();
            var oldBtn = document.querySelector('.appt-tab[data-prc-tab="1"]');
            if (oldBtn) oldBtn.remove();
            pane = null;
        }
        if (g('tab-reminder')) {
            var existingBtn = document.querySelector('.appt-tab[data-prc-tab="1"]');
            if (existingBtn) existingBtn.textContent = tr('prc.tab');
            return;
        }
        var tabs = document.querySelector('.appt-tabs');
        var recallBtn = document.querySelector('.appt-tabs [data-tab="recall"]');
        if (tabs) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'appt-tab';
            btn.setAttribute('data-tab', TAB_KEY);
            btn.setAttribute('data-prc-tab', '1');
            btn.textContent = tr('prc.tab');
            if (recallBtn && recallBtn.nextSibling) tabs.insertBefore(btn, recallBtn.nextSibling);
            else if (recallBtn) tabs.appendChild(btn);
            else tabs.appendChild(btn);
            btn.addEventListener('click', function () {
                if (typeof switchApptTab === 'function') switchApptTab(TAB_KEY);
                showPanel();
            });
        }
        var paneWrap = document.createElement('div');
        paneWrap.innerHTML = panelHtml();
        pane = paneWrap.firstElementChild;
        pane.setAttribute('data-prc-ver', PANEL_VER);
        var recallPane = g('tab-recall');
        var rsvpPane = g('tab-rsvp');
        if (rsvpPane && rsvpPane.parentNode) rsvpPane.parentNode.insertBefore(pane, rsvpPane);
        else if (recallPane && recallPane.parentNode) recallPane.parentNode.insertBefore(pane, recallPane.nextSibling);
        else {
            var sec = g('appointmentSection');
            if (sec) sec.appendChild(pane);
        }
    }

    /* ── modal calendar / form ───────────────────────────────── */

    function setDateField(iso) {
        _selDate = iso;
        var inp = g('prcDate');
        if (inp) inp.value = isoToDmy(iso);
    }

    function renderCal() {
        var wrap = g('prcCal');
        if (!wrap) return;
        var y = _calMonth.getFullYear();
        var m = _calMonth.getMonth();
        var today = todayIso();
        var loc = (typeof appUiLang !== 'undefined' && appUiLang) ? appUiLang : undefined;
        var title;
        try {
            title = new Date(y, m, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
        } catch (e) {
            title = (m + 1) + '/' + y;
        }
        var dow0 = new Date(y, m, 1).getDay();
        var daysM = new Date(y, m + 1, 0).getDate();
        var html = '<div class="prc-cal-head">' +
            '<button type="button" class="prc-cal-nav" data-prc-cal="prev">‹</button>' +
            '<span class="prc-cal-title">' + esc(title) + '</span>' +
            '<button type="button" class="prc-cal-nav" data-prc-cal="next">›</button></div>' +
            '<table><thead><tr>';
        weekdayHdr().forEach(function (d) { html += '<th>' + esc(d) + '</th>'; });
        html += '</tr></thead><tbody><tr>';
        var i;
        for (i = 0; i < dow0; i++) html += '<td></td>';
        var dow = dow0;
        for (var d = 1; d <= daysM; d++) {
            var iso = y + '-' + pad(m + 1) + '-' + pad(d);
            var cls = 'prc-cal-day';
            if (iso === _selDate) cls += ' is-sel';
            else if (iso === today) cls += ' is-today';
            html += '<td><span class="' + cls + '" data-prc-day="' + iso + '">' + d + '</span></td>';
            dow++;
            if (dow % 7 === 0 && d < daysM) html += '</tr><tr>';
        }
        while (dow % 7 !== 0) { html += '<td></td>'; dow++; }
        html += '</tr></tbody></table>';
        wrap.innerHTML = html;
    }

    function fillClinicSelect(sel, preferred, includeAll) {
        if (!sel) return;
        var prev = preferred != null ? String(preferred) : sel.value;
        sel.innerHTML = '';
        if (includeAll) {
            var all = document.createElement('option');
            all.value = '';
            all.textContent = tr('prc.panel.all');
            sel.appendChild(all);
        }
        clinicList().forEach(function (c) {
            var o = document.createElement('option');
            o.value = clinicTagOf(c);
            o.textContent = clinicLabel(c);
            sel.appendChild(o);
        });
        if (prev) {
            var ok = false;
            for (var i = 0; i < sel.options.length; i++) {
                if (sel.options[i].value === prev) { ok = true; break; }
            }
            if (ok) sel.value = prev;
        }
    }

    function fillDoctorSelect(sel, clinicTag, preferred, includeAll) {
        if (!sel) return;
        var prev = preferred != null ? String(preferred) : sel.value;
        sel.innerHTML = '';
        if (includeAll) {
            var all = document.createElement('option');
            all.value = '';
            all.textContent = tr('prc.panel.all');
            sel.appendChild(all);
        }
        doctorsForTag(clinicTag).forEach(function (d) {
            var o = document.createElement('option');
            o.value = String(d.id || '');
            o.textContent = doctorLabel(d);
            sel.appendChild(o);
        });
        if (prev) {
            var ok = false;
            for (var i = 0; i < sel.options.length; i++) {
                if (sel.options[i].value === prev) { ok = true; break; }
            }
            if (ok) sel.value = prev;
        }
    }

    function patientLine(ctx) {
        var bits = [];
        if (ctx.patientNo) bits.push('#' + ctx.patientNo);
        var nm = [ctx.chineseName, ctx.patientName].filter(Boolean).join(' / ');
        if (nm) bits.push(nm);
        return bits.join('  ·  ');
    }

    function renderModalGrid() {
        var tb = g('prcBody');
        if (!tb) return;
        tb.innerHTML = '';
        _rows.forEach(function (r) {
            var rowEl = document.createElement('tr');
            if (r.id === _selId) rowEl.className = 'prc-row-sel';
            rowEl.setAttribute('data-prc-id', r.id);
            rowEl.innerHTML =
                '<td>' + esc(isoToDmy(r.recall_date)) + '</td>' +
                '<td>' + esc(r.remarks || '') + '</td>' +
                '<td>' + esc(clinicNameForRow(r) || r.clinic_tag || '') + '</td>' +
                '<td>' + esc(r.doctor_name || r.doctor_code || '') + '</td>';
            tb.appendChild(rowEl);
        });
        var pad = 5 - _rows.length;
        var b;
        for (b = 0; b < pad; b++) {
            var blank = document.createElement('tr');
            blank.className = 'prc-row-blank';
            blank.innerHTML = '<td>&nbsp;</td><td></td><td></td><td></td>';
            tb.appendChild(blank);
        }
        var del = g('prcDeleteBtn');
        if (del) del.disabled = !_selId;
    }

    function loadModalRows() {
        if (!sbOk() || !_ctx) return;
        SB.from(TABLE).select('*')
            .eq('patient_id', _ctx.patientId)
            .order('recall_date', { ascending: false })
            .then(function (r) {
                if (r.error) {
                    if (isSchemaErr(r.error)) toast(tr('prc.err.schema'));
                    _rows = [];
                } else {
                    _rows = r.data || [];
                }
                renderModalGrid();
            });
    }

    function open(ctx) {
        ensureShell();
        if (!ctx || !ctx.patientId) {
            toast(tr('prc.err.noPatient'));
            return;
        }
        _ctx = ctx;
        _selId = null;
        _selDate = todayIso();
        _calMonth = new Date();
        var tag = resolveClinicTag(ctx.clinicTag || currentTag());
        fillClinicSelect(g('prcClinic'), tag, false);
        fillDoctorSelect(g('prcDoctor'), tag, ctx.doctorId || currentDocId(), false);
        setDateField(_selDate);
        var rem = g('prcRemarks');
        if (rem) rem.value = '';
        var line = g('prcPatientLine');
        if (line) line.textContent = patientLine(ctx);
        var del = g('prcDeleteBtn');
        if (del) del.disabled = true;
        applyI18n(g('patientRecallModal'));
        renderCal();
        loadModalRows();
        if (typeof openModal === 'function') openModal('patientRecallModal');
        else {
            var m = g('patientRecallModal');
            if (m) m.style.display = 'block';
        }
    }

    function closeModalSelf() {
        if (typeof closeModal === 'function') closeModal('patientRecallModal');
        else {
            var m = g('patientRecallModal');
            if (m) m.style.display = 'none';
        }
    }

    function save(intervalCode) {
        if (_saving || !_ctx) return;
        if (!sbOk()) { toast(tr('prc.err.save')); return; }
        var spec = intervalCode ? INTERVALS[intervalCode] : null;
        var dateIso = spec ? addMonths(todayIso(), spec.months) : _selDate;
        var remarks = String((g('prcRemarks') && g('prcRemarks').value) || '').trim();
        if (spec) {
            _selDate = dateIso;
            setDateField(dateIso);
            renderCal();
        }
        if (!dateIso) { toast(tr('prc.err.noDate')); return; }

        var clinicTag = resolveClinicTag(
            (g('prcClinic') && g('prcClinic').value) ||
            (_ctx && _ctx.clinicTag) ||
            currentTag()
        );
        if (!clinicTag) { toast(tr('prc.err.noClinic')); return; }
        var clinicRec = clinicFromTag(clinicTag);
        var docId = g('prcDoctor') ? String(g('prcDoctor').value || '').trim() : '';
        var docs = doctorsForTag(clinicTag);
        var doc = null;
        for (var i = 0; i < docs.length; i++) {
            if (String(docs[i].id) === docId) { doc = docs[i]; break; }
        }

        var payload = {
            patient_id: _ctx.patientId,
            patient_no: _ctx.patientNo || '',
            recall_date: dateIso,
            clinic_tag: clinicTag,
            clinic_id: clinicRec ? clinicRec.id : null,
            doctor_id: doc ? doc.id : (docId || null),
            doctor_code: doc ? String(doc.doctor_code || '') : String(_ctx.doctorCode || ''),
            doctor_name: doc ? doctorLabel(doc) : '',
            remarks: remarks,
            interval_code: intervalCode || 'custom',
            status: 'planned',
            source: _ctx.source || 'directory',
            source_appt_id: _ctx.sourceApptId || null,
            created_by: currentUser(),
            updated_at: new Date().toISOString()
        };

        _saving = true;
        SB.from(TABLE).insert([payload]).select('*').single()
            .then(function (r) {
                _saving = false;
                if (r.error) {
                    toast(isSchemaErr(r.error) ? tr('prc.err.schema') : (r.error.message || tr('prc.err.save')));
                    return;
                }
                _rows.unshift(r.data);
                _selId = r.data.id;
                renderModalGrid();
            })
            .catch(function () {
                _saving = false;
                toast(tr('prc.err.save'));
            });
    }

    function removeSelected() {
        if (!_selId || !sbOk()) return;
        SB.from(TABLE).delete().eq('id', _selId).then(function (r) {
            if (r.error) {
                toast(r.error.message || tr('prc.err.delete'));
                return;
            }
            _rows = _rows.filter(function (x) { return x.id !== _selId; });
            _selId = null;
            renderModalGrid();
        });
    }

    function selectModalRow(id) {
        _selId = id;
        var row = null;
        for (var i = 0; i < _rows.length; i++) {
            if (_rows[i].id === id) { row = _rows[i]; break; }
        }
        if (row) {
            _selDate = row.recall_date;
            setDateField(row.recall_date);
            if (g('prcClinic') && row.clinic_tag) {
                var rowTag = resolveClinicTag(row.clinic_tag);
                fillClinicSelect(g('prcClinic'), rowTag, false);
                fillDoctorSelect(g('prcDoctor'), rowTag, row.doctor_id || '', false);
            }
            if (g('prcRemarks')) g('prcRemarks').value = row.remarks || '';
            var p = String(row.recall_date || '').split('-');
            if (p.length >= 2) _calMonth = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
            renderCal();
        }
        renderModalGrid();
    }

    /* ── injectors ───────────────────────────────────────────── */

    function findQueueAppt(apptId) {
        apptId = String(apptId || '');
        if (!apptId) return null;
        var lists = [];
        if (typeof queueApptsCache !== 'undefined' && queueApptsCache) lists.push(queueApptsCache);
        if (typeof todayAppts !== 'undefined' && todayAppts) lists.push(todayAppts);
        for (var L = 0; L < lists.length; L++) {
            var list = lists[L] || [];
            for (var i = 0; i < list.length; i++) {
                if (list[i] && String(list[i].id) === apptId) return list[i];
            }
        }
        return null;
    }

    function findDirPatient(pid) {
        pid = String(pid || '');
        var list = (typeof patientListCache !== 'undefined' && patientListCache) ? patientListCache : [];
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === pid) return list[i];
        }
        return null;
    }

    function queueActionHtml() {
        return '<span class="ai-icon prc-ai-bell">🔔</span>' + esc(tr('prc.action'));
    }

    function injectQueueActions() {
        document.querySelectorAll('#queueBody .action-drop, .action-drop.action-drop--portal').forEach(function (drop) {
            var existing = drop.querySelector('[data-prc-item="1"]');
            if (existing) {
                existing.innerHTML = queueActionHtml();
                return;
            }
            var rowEl = drop.closest('tr') ||
                (drop.__queueActionWrap && drop.__queueActionWrap.closest && drop.__queueActionWrap.closest('tr'));
            var apptId = (rowEl && (rowEl.dataset.apptId || rowEl.getAttribute('data-appt-id'))) || '';
            var item = document.createElement('div');
            item.className = 'action-item';
            item.setAttribute('data-prc-item', '1');
            item.setAttribute('data-no-click-guard', '1');
            if (apptId) item.setAttribute('data-prc-appt-id', apptId);
            item.innerHTML = queueActionHtml();
            var after = drop.querySelector('[id^="act-wa-"]');
            if (after && after.nextSibling) drop.insertBefore(item, after.nextSibling);
            else if (after) drop.appendChild(item);
            else drop.insertBefore(item, drop.firstChild);
        });
    }

    function injectDirectoryButtons() {
        document.querySelectorAll('#patientTableBody tr[data-patient-id]').forEach(function (rowEl) {
            if (rowEl.querySelector('[data-prc-btn="1"]')) return;
            var host = rowEl.querySelector('.btn-dup-clinic');
            if (host) host = host.parentNode;
            if (!host) host = rowEl.querySelector('td:last-child div') || rowEl.querySelector('td:last-child');
            if (!host) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-prc';
            btn.setAttribute('data-prc-btn', '1');
            btn.setAttribute('data-no-click-guard', '1');
            btn.setAttribute('data-patient-id', rowEl.getAttribute('data-patient-id'));
            btn.textContent = tr('prc.action');
            var dup = rowEl.querySelector('.btn-dup-clinic');
            if (dup && dup.parentNode === host) host.insertBefore(btn, dup.nextSibling);
            else host.appendChild(btn);
        });
    }

    function watchLists() {
        if (!_queueObs) {
            _queueObs = new MutationObserver(function () { injectQueueActions(); });
        }
        if (!_dirObs) {
            _dirObs = new MutationObserver(function () { injectDirectoryButtons(); });
        }
        var qb = g('queueBody');
        var pb = g('patientTableBody');
        if (qb) {
            try { _queueObs.disconnect(); } catch (e1) { /* ignore */ }
            _queueObs.observe(qb, { childList: true, subtree: true });
        }
        if (pb) {
            try { _dirObs.disconnect(); } catch (e2) { /* ignore */ }
            _dirObs.observe(pb, { childList: true, subtree: true });
        }
        injectQueueActions();
        injectDirectoryButtons();
    }

    function openFromQueueRow(rowEl, apptIdHint) {
        var apptId = apptIdHint ||
            (rowEl && (rowEl.dataset.apptId || rowEl.getAttribute('data-appt-id'))) || '';
        var q = findQueueAppt(apptId);
        if (!q || !q.patient_id) {
            toast(tr('prc.err.noPatient'));
            return;
        }
        open({
            patientId: q.patient_id,
            patientNo: q.patient_no || '',
            patientName: q.patient_name || '',
            chineseName: q.patient_chinese_name || '',
            source: 'queue',
            sourceApptId: q.id,
            clinicTag: resolveClinicTag(q.clinic_tag || q.clinic_code || currentTag()),
            doctorId: q.doctor_id || '',
            doctorCode: q.doctor_code || ''
        });
    }

    function openFromDirectory(pid) {
        var p = findDirPatient(pid);
        if (!p) {
            toast(tr('prc.err.noPatient'));
            return;
        }
        open({
            patientId: p.id,
            patientNo: p.patient_no || '',
            patientName: p.full_name || '',
            chineseName: p.chinese_name || '',
            source: 'directory',
            clinicTag: resolveClinicTag(p.clinic_tag || p.clinic_code || currentTag())
        });
    }

    /* ── panel ───────────────────────────────────────────────── */

    function fillPanelFilters() {
        var from = g('prcPFrom');
        var to = g('prcPTo');
        var bounds = nextMonthRange();
        if (from && !from.value) from.value = bounds.from;
        if (to && !to.value) to.value = bounds.to;
        var clinicSel = g('prcPClinic');
        var keepClinic = clinicSel ? String(clinicSel.value || '') : '';
        var keepDoctor = g('prcPDoctor') ? String(g('prcPDoctor').value || '') : '';
        fillClinicSelect(clinicSel, keepClinic, true);
        fillDoctorSelect(g('prcPDoctor'), '', keepDoctor, true);
        applyI18n(g('tab-reminder'));
        var tabBtn = document.querySelector('.appt-tab[data-prc-tab="1"]');
        if (tabBtn) tabBtn.textContent = tr('prc.tab');
    }

    function showPanel() {
        ensureShell();
        bindOnce();
        fillPanelFilters();
        renderChips();
        if (g('prcMsgBox') && !String(g('prcMsgBox').value || '').trim() && !_msgLocked) {
            g('prcMsgBox').value = tr('prc.msg.body');
            _msgDraft = g('prcMsgBox').value;
        }
        setChannel(_channel);
        loadTwilioLists(false);
    }

    function patNoCore(raw) {
        var s = String(raw || '').replace(/\D/g, '');
        if (!s) return null;
        var n = parseInt(s, 10);
        return isNaN(n) ? null : n;
    }

    function loadPanel() {
        if (!sbOk()) return;
        var bounds = nextMonthRange();
        var from = g('prcPFrom') ? g('prcPFrom').value : bounds.from;
        var to = g('prcPTo') ? g('prcPTo').value : bounds.to;
        var clinic = g('prcPClinic') ? String(g('prcPClinic').value || '').trim() : '';
        var doctor = g('prcPDoctor') ? String(g('prcPDoctor').value || '').trim() : '';
        var q = SB.from(TABLE)
            .select('*, patients(id, patient_no, full_name, chinese_name, phone_number, mobile_phone)')
            .gte('recall_date', from || '1900-01-01')
            .lte('recall_date', to || '2999-12-31')
            .in('status', ['planned', 'reminded'])
            .order('clinic_tag', { ascending: true })
            .order('recall_date', { ascending: true });
        if (doctor) q = q.eq('doctor_id', doctor);
        q.then(function (r) {
            if (r.error) {
                toast(isSchemaErr(r.error) ? tr('prc.err.schema') : r.error.message);
                _panelRows = [];
            } else {
                _panelRows = r.data || [];
            }
            if (clinic) {
                var want = clinic.toLowerCase();
                _panelRows = _panelRows.filter(function (row) {
                    var rec = clinicFromTag(row.clinic_tag) ||
                        (row.clinic_id && typeof clinicRecordFromId === 'function'
                            ? clinicRecordFromId(row.clinic_id) : null);
                    var tag = rec ? clinicTagOf(rec) : String(row.clinic_tag || '');
                    return tag.toLowerCase() === want ||
                        String(row.clinic_tag || '').toLowerCase() === want ||
                        String(row.clinic_id || '').toLowerCase() === want;
                });
            }
            _panelRows.sort(function (a, b) {
                var ca = (clinicNameForRow(a) || a.clinic_tag || '').toLowerCase();
                var cb = (clinicNameForRow(b) || b.clinic_tag || '').toLowerCase();
                if (ca < cb) return -1;
                if (ca > cb) return 1;
                return String(a.recall_date || '').localeCompare(String(b.recall_date || ''));
            });
            var useNo = g('prcPUseNo') && g('prcPUseNo').checked;
            if (useNo) {
                var a = patNoCore(g('prcPNoFrom') && g('prcPNoFrom').value);
                var b = patNoCore(g('prcPNoTo') && g('prcPNoTo').value);
                _panelRows = _panelRows.filter(function (row) {
                    var n = patNoCore(row.patient_no || (row.patients && row.patients.patient_no));
                    if (n == null) return false;
                    if (a != null && n < a) return false;
                    if (b != null && n > b) return false;
                    return true;
                });
            }
            _panelSel = Object.create(null);
            renderPanelGrid();
        });
    }

    function patientCell(row) {
        var p = row.patients || {};
        var no = row.patient_no || p.patient_no || '';
        var en = p.full_name || '';
        var zh = p.chinese_name || '';
        var bits = [];
        if (no) bits.push(no);
        if (en) bits.push(en);
        if (zh) bits.push(zh);
        return bits.join(', ');
    }

    function telCell(row) {
        var p = row.patients || {};
        var a = String(p.phone_number || '').trim();
        var b = String(p.mobile_phone || '').trim();
        if (a && b && a !== b) return a + ', ' + b;
        return a || b || '';
    }

    function firstPhone(row) {
        var p = row.patients || {};
        return String(p.mobile_phone || p.phone_number || '').trim();
    }

    function renderPanelGrid() {
        var tb = g('prcPBody');
        if (!tb) return;
        tb.innerHTML = '';
        if (!_panelRows.length) {
            tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:22px;color:#64748b;">' +
                esc(tr('prc.panel.empty')) + '</td></tr>';
        } else {
            _panelRows.forEach(function (row) {
                var rowEl = document.createElement('tr');
                if (_panelSel[row.id]) rowEl.className = 'is-on';
                rowEl.setAttribute('data-prc-pid', row.id);
                var contacted = '';
                if (row.contacted_at) {
                    contacted = String(row.contacted_at).replace('T', ' ').slice(0, 16);
                    if (row.contacted_via) contacted += ' · ' + row.contacted_via;
                }
                rowEl.innerHTML =
                    '<td><input type="checkbox" data-prc-check="' + esc(row.id) + '"' +
                    (_panelSel[row.id] ? ' checked' : '') + '></td>' +
                    '<td>' + esc(isoToDmy(row.recall_date)) + '</td>' +
                    '<td>' + esc(clinicNameForRow(row)) + '</td>' +
                    '<td>' + esc(patientCell(row)) + '</td>' +
                    '<td>' + esc(telCell(row)) + '</td>' +
                    '<td>' + esc(row.remarks || '') + '</td>' +
                    '<td>' + esc(tr('prc.status.' + (row.status || 'planned'))) + '</td>' +
                    '<td>' + esc(contacted) + '</td>';
                tb.appendChild(rowEl);
            });
        }
        updateCount();
    }

    function updateCount() {
        var cnt = g('prcPCount');
        if (!cnt) return;
        var nSel = selectedPanelRows().length;
        var text = trRepl('prc.panel.records', { N: _panelRows.length });
        if (nSel) text += ' · ' + trRepl('prc.panel.selected', { N: nSel });
        cnt.textContent = text;
    }

    function selectedPanelRows() {
        return _panelRows.filter(function (r) { return _panelSel[r.id]; });
    }

    function selectAllPanel(on) {
        _panelSel = Object.create(null);
        if (on) {
            _panelRows.forEach(function (r) { _panelSel[r.id] = true; });
        }
        renderPanelGrid();
    }

    function sendList() {
        var sel = selectedPanelRows();
        var base = sel.length ? sel : _panelRows.slice();
        return base.filter(function (r) { return firstPhone(r); });
    }

    function exportXls() {
        var rows = _panelRows;
        var lines = [['Date', 'Clinic', 'Patient', 'Telephone', 'Remarks', 'Status', 'Contacted']];
        rows.forEach(function (r) {
            var contacted = r.contacted_at
                ? (String(r.contacted_at).replace('T', ' ').slice(0, 16) + (r.contacted_via ? ' ' + r.contacted_via : ''))
                : '';
            lines.push([
                isoToDmy(r.recall_date),
                clinicNameForRow(r),
                patientCell(r),
                telCell(r),
                r.remarks || '',
                r.status || '',
                contacted
            ]);
        });
        var csv = lines.map(function (cols) {
            return cols.map(function (c) {
                var s = String(c == null ? '' : c);
                if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
                return s;
            }).join(',');
        }).join('\r\n');
        var from = g('prcPFrom') ? g('prcPFrom').value : '';
        var to = g('prcPTo') ? g('prcPTo').value : '';
        var name = 'appt-reminder-' + (from || 'from') + '-' + (to || 'to') + '.xls';
        if (typeof downloadCsvUtf8 === 'function') downloadCsvUtf8(name, csv);
        else {
            var blob = new Blob(['\uFEFF' + csv], { type: 'application/vnd.ms-excel;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
        }
    }

    function printPanel() {
        var w = window.open('', '_blank', 'noopener,noreferrer');
        if (!w) { toast(tr('prc.panel.empty')); return; }
        var rows = _panelRows.map(function (r) {
            return '<tr><td>' + esc(isoToDmy(r.recall_date)) + '</td><td>' + esc(clinicNameForRow(r)) +
                '</td><td>' + esc(patientCell(r)) +
                '</td><td>' + esc(telCell(r)) + '</td><td>' + esc(r.remarks || '') +
                '</td><td>' + esc(r.status || '') + '</td></tr>';
        }).join('');
        w.document.write(
            '<html><head><title>' + esc(tr('prc.panel.title')) + '</title>' +
            '<style>body{font-family:sans-serif;padding:16px;}table{width:100%;border-collapse:collapse;}' +
            'th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left;}' +
            'th{background:#eee;}</style></head><body>' +
            '<h2>' + esc(tr('prc.panel.title')) + '</h2>' +
            '<p>' + esc(trRepl('prc.panel.records', { N: _panelRows.length })) + '</p>' +
            '<table><thead><tr><th>Date</th><th>Clinic</th><th>Patient</th><th>Telephone</th><th>Remarks</th><th>Status</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table></body></html>'
        );
        w.document.close();
        w.focus();
        w.print();
    }

    function messageFields(row, bodyHint) {
        row = row || {};
        var p = row.patients || {};
        var chinese = String(p.chinese_name || '').trim();
        var english = String(p.full_name || '').trim();
        var name = chinese || english || row.patient_no || 'Patient';
        var rec = clinicRecForRow(row);
        var clinic = clinicNameForRow(row, { body: bodyHint });
        var clinicEn = rec && typeof clinicNameForOutboundMessage === 'function'
            ? (clinicNameForOutboundMessage({ lang: 'en', clinic: rec, fallback: clinic }) || clinic)
            : clinic;
        var clinicZh = rec && typeof clinicNameForOutboundMessage === 'function'
            ? (clinicNameForOutboundMessage({ lang: 'zh', clinic: rec, fallback: clinicEn }) || clinicEn)
            : clinic;
        return {
            NAME: name,
            FULL_NAME: english || chinese || name,
            CHINESE: chinese,
            ENGLISH: english,
            CLINIC: clinic,
            CLINIC_EN: clinicEn,
            CLINIC_ZH: clinicZh,
            DATE: isoToDmy(row.recall_date),
            DOCTOR: row.doctor_name || row.doctor_code || '',
            REMARKS: row.remarks || '',
            PHONE: firstPhone(row),
            PATIENT_NO: row.patient_no || p.patient_no || ''
        };
    }

    function applyPlaceholders(template, row) {
        var msg = String(template || '');
        if (!msg) return '';
        var f = messageFields(row, msg);
        var keys = [
            'CLINIC_EN', 'CLINIC_ZH', 'FULL_NAME', 'PATIENT_NO',
            'CHINESE', 'ENGLISH', 'REMARKS', 'CLINIC', 'DOCTOR', 'PHONE', 'NAME', 'DATE'
        ];
        keys.forEach(function (k) {
            var val = f[k] != null ? String(f[k]) : '';
            msg = msg.replace(new RegExp('\\{\\s*' + k + '\\s*\\}', 'gi'), val);
        });
        return msg;
    }

    function reminderMessage(row) {
        var box = g('prcMsgBox');
        var raw = (box && String(box.value || '').trim()) || tr('prc.msg.body');
        return applyPlaceholders(raw, row);
    }

    function sendPreviewText(row) {
        if (_sendKind === 'twilio_wa') {
            var tpl = selectedTpl();
            if (tpl && typeof AIHELPER !== 'undefined' &&
                typeof AIHELPER.buildTwilioContentVariables === 'function') {
                var cv = AIHELPER.buildTwilioContentVariables(tpl, twilioCtx(row));
                var lines = [(tpl.label || tpl.contentSid || '')];
                Object.keys(cv).sort().forEach(function (k) {
                    lines.push('{{' + k + '}} = ' + cv[k]);
                });
                return lines.join('\n');
            }
        }
        return reminderMessage(row);
    }

    function prefGet(key) {
        try { return String(localStorage.getItem(key) || ''); } catch (e) { return ''; }
    }

    function prefSet(key, val) {
        try { localStorage.setItem(key, String(val || '')); } catch (e) { /* ignore */ }
    }

    function isTwilioChan() {
        return _channel === 'twilio_wa' || _channel === 'twilio_sms';
    }

    function openTwilioSetup() {
        if (typeof openBroadcastTwilioSetup === 'function') openBroadcastTwilioSetup();
        else toast(tr('prc.send.setup'));
    }

    function selectedTpl() {
        var sel = g('prcTwilioTpl');
        var id = sel ? String(sel.value || '') : prefGet(TPL_PREF);
        if (typeof AIHELPER === 'undefined' || typeof AIHELPER.getTwilioContentTemplate !== 'function') {
            return null;
        }
        return AIHELPER.getTwilioContentTemplate(id) ||
            AIHELPER.getTwilioContentTemplate('') ||
            null;
    }

    function selectedFrom() {
        var sel = g('prcTwilioFrom');
        var id = sel ? String(sel.value || 'default') : 'default';
        if (!id || id === 'default') return null;
        if (typeof AIHELPER === 'undefined' || typeof AIHELPER.getTwilioFromNumber !== 'function') {
            return null;
        }
        var row = AIHELPER.getTwilioFromNumber(id);
        if (!row) return null;
        if (_channel === 'twilio_wa' && row.whatsapp === false) return null;
        if (_channel === 'twilio_sms' && row.sms === false) return null;
        return row;
    }

    function refreshFromSelect() {
        var sel = g('prcTwilioFrom');
        if (!sel) return;
        var channel = _channel === 'twilio_sms' ? 'sms' : 'whatsapp';
        var numbers = [];
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.listTwilioFromNumbers === 'function') {
            numbers = AIHELPER.listTwilioFromNumbers(channel) || [];
        }
        var prev = sel.value || prefGet(FROM_PREF) || 'default';
        sel.innerHTML = '';
        var def = document.createElement('option');
        def.value = 'default';
        def.textContent = (typeof AIHELPER !== 'undefined' && typeof AIHELPER.getTwilioFromDefaultLabel === 'function')
            ? AIHELPER.getTwilioFromDefaultLabel()
            : tr('prc.send.fromDefault');
        sel.appendChild(def);
        numbers.forEach(function (n) {
            var o = document.createElement('option');
            o.value = n.id;
            var caps = [];
            if (n.whatsapp) caps.push('WA');
            if (n.sms) caps.push('SMS');
            o.textContent = (n.label || n.phone) + ' · ' + n.phone +
                (caps.length ? ' (' + caps.join('/') + ')' : '');
            sel.appendChild(o);
        });
        var ok = prev === 'default';
        if (!ok) {
            for (var i = 0; i < numbers.length; i++) {
                if (numbers[i].id === prev) { ok = true; break; }
            }
        }
        sel.value = ok ? prev : 'default';
        prefSet(FROM_PREF, sel.value);
        var hint = g('prcTwilioFromHint');
        var from = selectedFrom();
        if (hint) {
            hint.textContent = from && from.phone
                ? trRepl('prc.send.fromPicked', { FROM: from.phone })
                : tr('prc.send.fromHint');
        }
    }

    function refreshTplSelect() {
        var sel = g('prcTwilioTpl');
        if (!sel) return;
        var templates = [];
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.listTwilioContentTemplates === 'function') {
            templates = AIHELPER.listTwilioContentTemplates() || [];
        }
        var prev = sel.value || prefGet(TPL_PREF);
        sel.innerHTML = '';
        if (!templates.length) {
            var empty = document.createElement('option');
            empty.value = '';
            empty.textContent = tr('prc.send.tplEmpty');
            sel.appendChild(empty);
        } else {
            templates.forEach(function (t) {
                var o = document.createElement('option');
                o.value = t.id;
                o.textContent = (t.label || t.contentSid) + ' · ' +
                    String(t.contentSid || '').slice(0, 10) + '…';
                sel.appendChild(o);
            });
            var exists = false;
            for (var i = 0; i < templates.length; i++) {
                if (templates[i].id === prev) { exists = true; break; }
            }
            sel.value = exists ? prev : templates[0].id;
            prefSet(TPL_PREF, sel.value);
        }
        var hint = g('prcTwilioTplHint');
        var tpl = selectedTpl();
        if (hint) hint.textContent = tpl && tpl.contentSid
            ? trRepl('prc.send.tplHint', { SID: tpl.contentSid })
            : tr('prc.send.tplEmpty');
    }

    function approvedTplBody(tpl) {
        if (!tpl) return tr('prc.send.tplEmpty');
        var raw = String(tpl.notes || '').trim();
        if (raw) return raw;
        var map = tpl.varMap || {};
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.normalizeTplVarMap === 'function') {
            map = AIHELPER.normalizeTplVarMap(tpl.vars || '1', tpl.varMap);
        }
        return Object.keys(map).sort().map(function (k) {
            return '{{' + k + '}}={' + map[k] + '}';
        }).join('  ') || (tpl.label || tpl.contentSid || '');
    }

    function renderChips() {
        var box = g('prcChips');
        if (!box) return;
        var html = '<span style="font-size:11px;font-weight:700;color:#64748b;margin-right:4px;">' +
            esc(tr('prc.send.placeholders')) + '</span>';
        PH_CHIPS.forEach(function (tok) {
            html += '<button type="button" class="prc-ph-chip" data-prc-ph="{' + tok + '}">' +
                '{' + tok + '}</button>';
        });
        box.innerHTML = html;
    }

    function insertPlaceholder(token) {
        if (_msgLocked || _channel === 'twilio_wa') return;
        var el = g('prcMsgBox');
        if (!el) return;
        var tok = String(token || '');
        if (!tok) return;
        var start = el.selectionStart != null ? el.selectionStart : el.value.length;
        var end = el.selectionEnd != null ? el.selectionEnd : start;
        el.value = el.value.slice(0, start) + tok + el.value.slice(end);
        var pos = start + tok.length;
        try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
        el.focus();
        _msgDraft = el.value;
    }

    function syncMsgBoxMode() {
        var el = g('prcMsgBox');
        var tools = g('prcMsgTools');
        var phNote = g('prcPhNote');
        var waNote = g('prcWaReadonlyNote');
        var lock = _channel === 'twilio_wa';
        if (lock) {
            if (!_msgLocked && el) _msgDraft = String(el.value || '');
            _msgLocked = true;
            if (el) {
                el.value = approvedTplBody(selectedTpl());
                el.readOnly = true;
                el.classList.add('is-lock');
            }
            if (tools) tools.style.display = 'none';
            if (phNote) phNote.style.display = 'none';
            if (waNote) waNote.style.display = 'block';
        } else {
            if (_msgLocked && el) {
                el.value = _msgDraft || tr('prc.msg.body');
            } else if (el && !String(el.value || '').trim()) {
                el.value = tr('prc.msg.body');
            }
            _msgLocked = false;
            if (el) {
                el.readOnly = false;
                el.classList.remove('is-lock');
            }
            if (tools) tools.style.display = '';
            if (phNote) phNote.style.display = '';
            if (waNote) waNote.style.display = 'none';
        }
    }

    function setChannel(kind) {
        if (kind !== 'wa' && kind !== 'sms' && kind !== 'twilio_wa' && kind !== 'twilio_sms') {
            kind = 'wa';
        }
        _channel = kind;
        ['prcChanWa', 'prcChanSms', 'prcChanTwa', 'prcChanTsms'].forEach(function (id) {
            var btn = g(id);
            if (!btn) return;
            btn.classList.toggle('is-on', btn.getAttribute('data-prc-chan') === kind);
        });
        var box = g('prcTwilioBox');
        if (box) box.classList.toggle('is-on', isTwilioChan());
        var tplWrap = g('prcTwilioTplWrap');
        if (tplWrap) tplWrap.style.display = kind === 'twilio_wa' ? '' : 'none';
        var smsHint = g('prcTwilioSmsHint');
        if (smsHint) smsHint.style.display = kind === 'twilio_sms' ? 'block' : 'none';
        if (isTwilioChan()) {
            refreshFromSelect();
            if (kind === 'twilio_wa') refreshTplSelect();
        }
        syncMsgBoxMode();
    }

    function loadTwilioLists(force) {
        if (typeof AIHELPER === 'undefined') {
            refreshFromSelect();
            refreshTplSelect();
            return;
        }
        var a = typeof AIHELPER.ensureTwilioContentTemplates === 'function'
            ? AIHELPER.ensureTwilioContentTemplates(!!force)
            : Promise.resolve();
        var b = typeof AIHELPER.ensureTwilioFromNumbers === 'function'
            ? AIHELPER.ensureTwilioFromNumbers(!!force)
            : Promise.resolve();
        Promise.resolve(a).then(function () { return b; }).then(function () {
            refreshFromSelect();
            refreshTplSelect();
            syncMsgBoxMode();
        }).catch(function () {
            refreshFromSelect();
            refreshTplSelect();
        });
    }

    function twilioCtx(row) {
        var raw = (g('prcMsgBox') && g('prcMsgBox').value) || tr('prc.msg.body');
        var f = messageFields(row, raw);
        return {
            name: f.NAME,
            fullName: f.FULL_NAME,
            chinese: f.CHINESE,
            english: f.ENGLISH,
            clinic: f.CLINIC,
            date: f.DATE,
            doctor: f.DOCTOR,
            phone: f.PHONE,
            patientNo: f.PATIENT_NO,
            body: raw,
            fields: {
                REMARKS: f.REMARKS,
                CHINESE: f.CHINESE,
                ENGLISH: f.ENGLISH,
                CLINIC_EN: f.CLINIC_EN,
                CLINIC_ZH: f.CLINIC_ZH
            }
        };
    }

    function markContacted(rows, via) {
        if (!sbOk() || !rows.length) return;
        var now = new Date().toISOString();
        var ids = rows.map(function (r) { return r.id; });
        SB.from(TABLE).update({
            status: 'reminded',
            contacted_at: now,
            contacted_via: via,
            updated_at: now
        }).in('id', ids).then(function () {
            rows.forEach(function (r) {
                r.status = 'reminded';
                r.contacted_at = now;
                r.contacted_via = via;
            });
            renderPanelGrid();
        });
    }

    function phoneE164(raw) {
        var digits = (typeof formatPhoneForWA === 'function')
            ? formatPhoneForWA(raw)
            : String(raw || '').replace(/[^\d]/g, '');
        if (!digits) return '';
        return digits.charAt(0) === '+' ? digits : '+' + digits;
    }

    function openSendUi() {
        if (typeof openModal === 'function') openModal('prcSendModal');
        else {
            var el = g('prcSendModal');
            if (el) el.style.display = 'block';
        }
    }

    function closeSendUi() {
        if (typeof closeModal === 'function') closeModal('prcSendModal');
        else {
            var el = g('prcSendModal');
            if (el) el.style.display = 'none';
        }
        _sendQ = [];
        _sendIdx = 0;
        _sendKind = '';
        _sendBusy = false;
    }

    function setSendStatus(msg, isErr) {
        var el = g('prcSendStatus');
        if (!el) return;
        el.textContent = msg || '';
        if (isErr) el.classList.add('is-err');
        else el.classList.remove('is-err');
    }

    function startSend() {
        var kind = _channel;
        if (!_panelRows.length) { toast(tr('prc.err.noSel')); return; }
        var list = sendList();
        if (!list.length) { toast(tr('prc.err.noPhone')); return; }
        if (kind === 'twilio_wa' || kind === 'twilio_sms') {
            if (typeof AIHELPER === 'undefined' || typeof AIHELPER.sendTwilioOutreach !== 'function') {
                toast(tr('prc.send.fail'));
                return;
            }
        }
        if (kind === 'twilio_wa') {
            var tpl = selectedTpl();
            if (!tpl || !tpl.contentSid) { toast(tr('prc.send.needTpl')); return; }
        }
        if (kind === 'twilio_wa' || kind === 'twilio_sms') {
            var fromSel = g('prcTwilioFrom');
            var fromId = fromSel ? String(fromSel.value || 'default') : 'default';
            if (fromId && fromId !== 'default') {
                var fromRow = (typeof AIHELPER !== 'undefined' && AIHELPER.getTwilioFromNumber)
                    ? AIHELPER.getTwilioFromNumber(fromId) : null;
                if (fromRow) {
                    if (kind === 'twilio_wa' && fromRow.whatsapp === false) {
                        toast(tr('prc.send.fromNoWa'));
                        return;
                    }
                    if (kind === 'twilio_sms' && fromRow.sms === false) {
                        toast(tr('prc.send.fromNoSms'));
                        return;
                    }
                }
            }
        }
        _sendQ = list;
        _sendIdx = 0;
        _sendKind = kind;
        _sendBusy = false;
        refreshSendModal();
    }

    function refreshSendModal() {
        if (!_sendQ.length || _sendIdx >= _sendQ.length) {
            var n = _sendQ.length;
            closeSendUi();
            if (n) toast(trRepl('prc.send.finished', { N: n }));
            return;
        }
        var row = _sendQ[_sendIdx];
        var p = row.patients || {};
        var name = p.chinese_name || p.full_name || row.patient_no || '';
        var en = p.full_name || '';
        var phone = firstPhone(row);
        var isLast = _sendIdx === _sendQ.length - 1;
        var isTwilio = _sendKind === 'twilio_wa' || _sendKind === 'twilio_sms';
        var prog = g('prcSendProgress');
        if (prog) prog.textContent = trRepl('prc.send.progress', { I: _sendIdx + 1, N: _sendQ.length });
        var card = g('prcSendCard');
        if (card) {
            card.innerHTML =
                (en && en !== name ? '<div class="prc-send-name">' + esc(en) + '</div>' : '') +
                '<div class="prc-send-name">' + esc(name) + '</div>' +
                (row.patient_no || p.patient_no
                    ? '<div style="font-size:11px;color:#94a3b8;">#' + esc(row.patient_no || p.patient_no) + '</div>'
                    : '') +
                '<span class="prc-send-phone">📞 ' + esc(phone) + '</span>' +
                '<div style="font-size:12px;color:#64748b;margin-top:6px;">' +
                esc(isoToDmy(row.recall_date)) +
                (clinicNameForRow(row) ? ' · ' + esc(clinicNameForRow(row)) : '') +
                (row.remarks ? ' · ' + esc(row.remarks) : '') + '</div>' +
                '<div class="prc-send-msg">' + esc(sendPreviewText(row)) + '</div>';
        }
        setSendStatus('');
        var openBtn = g('prcSendOpenBtn');
        if (openBtn) {
            openBtn.textContent = tr(isTwilio ? 'prc.send.send' : 'prc.send.open');
            openBtn.disabled = !!_sendBusy;
        }
        var nextBtn = g('prcSendNextBtn');
        if (nextBtn) {
            nextBtn.textContent = isLast ? tr('prc.send.done') : tr('prc.send.next');
        }
        applyI18n(g('prcSendModal'));
        if (openBtn) openBtn.textContent = tr(isTwilio ? 'prc.send.send' : 'prc.send.open');
        openSendUi();
    }

    function sendAdvance() {
        if (_sendBusy) return;
        _sendIdx++;
        refreshSendModal();
    }

    function sendOpenCurrent() {
        if (_sendBusy) return;
        if (!_sendQ.length || _sendIdx >= _sendQ.length) return;
        var row = _sendQ[_sendIdx];
        var phone = firstPhone(row);
        if (!phone) {
            setSendStatus(tr('prc.send.noPhone'), true);
            return;
        }
        var msg = reminderMessage(row);
        var p = row.patients || {};
        var name = p.chinese_name || p.full_name || row.patient_no || '';

        if (_sendKind === 'wa') {
            if (typeof openWhatsAppPrefill === 'function') {
                openWhatsAppPrefill(phone, msg, { source: 'appt-reminder' });
            } else {
                var digits = (typeof formatPhoneForWA === 'function')
                    ? formatPhoneForWA(phone)
                    : String(phone).replace(/[^\d]/g, '');
                window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(msg), '_blank');
            }
            markContacted([row], 'wa_web');
            setSendStatus(tr('prc.send.ok'));
            return;
        }

        if (_sendKind === 'sms') {
            var raw = String(phone).replace(/[^\d+]/g, '');
            window.location.href = 'sms:' + raw + '?body=' + encodeURIComponent(msg);
            markContacted([row], 'sms_web');
            setSendStatus(tr('prc.send.ok'));
            return;
        }

        if (typeof AIHELPER === 'undefined' || typeof AIHELPER.sendTwilioOutreach !== 'function') {
            setSendStatus(tr('prc.send.fail'), true);
            return;
        }
        var to = phoneE164(phone);
        if (!to) {
            setSendStatus(tr('prc.send.noPhone'), true);
            return;
        }
        var channel = _sendKind === 'twilio_sms' ? 'sms' : 'whatsapp';
        var opts = { channel: channel, to: to, name: name, body: msg };
        if (channel === 'whatsapp') {
            var tpl = selectedTpl();
            if (!tpl || !tpl.contentSid) {
                setSendStatus(tr('prc.send.needTpl'), true);
                return;
            }
            opts.contentSid = tpl.contentSid;
            if (typeof AIHELPER.buildTwilioContentVariables === 'function') {
                opts.contentVariables = AIHELPER.buildTwilioContentVariables(tpl, twilioCtx(row));
            }
        }
        var fromRow = selectedFrom();
        if (fromRow && fromRow.phone) opts.from = fromRow.phone;
        _sendBusy = true;
        var openBtn = g('prcSendOpenBtn');
        if (openBtn) openBtn.disabled = true;
        AIHELPER.sendTwilioOutreach(opts).then(function (res) {
            _sendBusy = false;
            if (openBtn) openBtn.disabled = false;
            if (res && res.ok) {
                markContacted([row], channel === 'sms' ? 'twilio_sms' : 'twilio_wa');
                setSendStatus(tr('prc.send.ok'));
            } else {
                setSendStatus((res && res.error) || tr('prc.send.fail'), true);
            }
        }).catch(function () {
            _sendBusy = false;
            if (openBtn) openBtn.disabled = false;
            setSendStatus(tr('prc.send.fail'), true);
        });
    }

    /* ── events ──────────────────────────────────────────────── */

    function bindOnce() {
        var modal = g('patientRecallModal');
        if (modal && modal.dataset.prcBound !== '1') {
            modal.dataset.prcBound = '1';
            modal.addEventListener('click', function (e) {
                var day = e.target.closest && e.target.closest('[data-prc-day]');
                if (day) {
                    setDateField(day.getAttribute('data-prc-day'));
                    renderCal();
                    return;
                }
                var nav = e.target.closest && e.target.closest('[data-prc-cal]');
                if (nav) {
                    var dir = nav.getAttribute('data-prc-cal');
                    _calMonth = new Date(_calMonth.getFullYear(), _calMonth.getMonth() + (dir === 'next' ? 1 : -1), 1);
                    renderCal();
                    return;
                }
                var row = e.target.closest && e.target.closest('#prcBody tr[data-prc-id]');
                if (row) {
                    selectModalRow(row.getAttribute('data-prc-id'));
                    return;
                }
                var iv = e.target.closest && e.target.closest('[data-prc-interval]');
                if (iv) {
                    save(iv.getAttribute('data-prc-interval'));
                }
            });
            var closeBtn = g('prcCloseBtn');
            if (closeBtn) closeBtn.addEventListener('click', closeModalSelf);
            var ret = g('prcReturnBtn');
            if (ret) ret.addEventListener('click', closeModalSelf);
            var saveBtn = g('prcSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', function () { save(null); });
            var delBtn = g('prcDeleteBtn');
            if (delBtn) delBtn.addEventListener('click', removeSelected);
            var clinicSel = g('prcClinic');
            if (clinicSel) {
                clinicSel.addEventListener('change', function () {
                    fillDoctorSelect(g('prcDoctor'), clinicSel.value, '', false);
                });
            }
        }

        var pane = g('tab-reminder');
        if (pane && pane.dataset.prcBound !== '1') {
            pane.dataset.prcBound = '1';
            var viewBtn = g('prcPViewBtn');
            if (viewBtn) viewBtn.addEventListener('click', loadPanel);
            var exp = g('prcPExportBtn');
            if (exp) exp.addEventListener('click', exportXls);
            var prn = g('prcPPrintBtn');
            if (prn) prn.addEventListener('click', printPanel);
            var selAll = g('prcPSelAllBtn');
            if (selAll) selAll.addEventListener('click', function () { selectAllPanel(true); });
            var selNone = g('prcPSelNoneBtn');
            if (selNone) selNone.addEventListener('click', function () { selectAllPanel(false); });
            var sendBtn = g('prcPSendBtn');
            if (sendBtn) sendBtn.addEventListener('click', startSend);
            var setup1 = g('prcTwilioSetupBtn');
            if (setup1) setup1.addEventListener('click', openTwilioSetup);
            var setup2 = g('prcTwilioSetupBtn2');
            if (setup2) setup2.addEventListener('click', openTwilioSetup);
            var reload = g('prcTwilioReloadBtn');
            if (reload) reload.addEventListener('click', function () { loadTwilioLists(true); });
            var fromSel = g('prcTwilioFrom');
            if (fromSel) {
                fromSel.addEventListener('change', function () {
                    prefSet(FROM_PREF, fromSel.value);
                    refreshFromSelect();
                });
            }
            var tplSel = g('prcTwilioTpl');
            if (tplSel) {
                tplSel.addEventListener('change', function () {
                    prefSet(TPL_PREF, tplSel.value);
                    refreshTplSelect();
                    syncMsgBoxMode();
                });
            }
            var msgBox = g('prcMsgBox');
            if (msgBox) {
                msgBox.addEventListener('input', function () {
                    if (!_msgLocked) _msgDraft = msgBox.value;
                });
            }
            var useNo = g('prcPUseNo');
            if (useNo) {
                useNo.addEventListener('change', function () {
                    var on = !!useNo.checked;
                    if (g('prcPNoFrom')) g('prcPNoFrom').disabled = !on;
                    if (g('prcPNoTo')) g('prcPNoTo').disabled = !on;
                });
            }
            pane.addEventListener('click', function (e) {
                var chanBtn = e.target.closest && e.target.closest('[data-prc-chan]');
                if (chanBtn) {
                    setChannel(chanBtn.getAttribute('data-prc-chan'));
                    return;
                }
                var chip = e.target.closest && e.target.closest('[data-prc-ph]');
                if (chip) {
                    insertPlaceholder(chip.getAttribute('data-prc-ph'));
                    return;
                }
                var chk = e.target.closest && e.target.closest('[data-prc-check]');
                if (chk) {
                    var id = chk.getAttribute('data-prc-check');
                    if (chk.checked) _panelSel[id] = true;
                    else delete _panelSel[id];
                    var rowEl = chk.closest('tr');
                    if (rowEl) rowEl.classList.toggle('is-on', !!chk.checked);
                    updateCount();
                    return;
                }
                var prow = e.target.closest && e.target.closest('#prcPBody tr[data-prc-pid]');
                if (prow && e.detail === 2) {
                    var rid = prow.getAttribute('data-prc-pid');
                    var found = null;
                    for (var i = 0; i < _panelRows.length; i++) {
                        if (_panelRows[i].id === rid) { found = _panelRows[i]; break; }
                    }
                    if (found) {
                        var p = found.patients || {};
                        open({
                            patientId: found.patient_id,
                            patientNo: found.patient_no || p.patient_no || '',
                            patientName: p.full_name || '',
                            chineseName: p.chinese_name || '',
                            source: 'management',
                            clinicTag: resolveClinicTag(found.clinic_tag || ''),
                            doctorId: found.doctor_id || ''
                        });
                    }
                }
            });
        }

        var sendModal = g('prcSendModal');
        if (sendModal && sendModal.dataset.prcBound !== '1') {
            sendModal.dataset.prcBound = '1';
            var sendClose = g('prcSendCloseBtn');
            if (sendClose) sendClose.addEventListener('click', closeSendUi);
            var sendOpen = g('prcSendOpenBtn');
            if (sendOpen) sendOpen.addEventListener('click', sendOpenCurrent);
            var sendSkip = g('prcSendSkipBtn');
            if (sendSkip) sendSkip.addEventListener('click', sendAdvance);
            var sendNext = g('prcSendNextBtn');
            if (sendNext) sendNext.addEventListener('click', sendAdvance);
        }

        if (!document.documentElement.dataset.prcDocBound) {
            document.documentElement.dataset.prcDocBound = '1';
            document.addEventListener('click', function (e) {
                var qItem = e.target.closest && e.target.closest('[data-prc-item="1"]');
                if (qItem) {
                    e.preventDefault();
                    e.stopPropagation();
                    var drop = qItem.closest('.action-drop');
                    if (drop && typeof queueCloseActionDrop === 'function') {
                        try { queueCloseActionDrop(drop); } catch (err) { /* ignore */ }
                    }
                    openFromQueueRow(qItem.closest('tr'), qItem.getAttribute('data-prc-appt-id'));
                    return;
                }
                var dBtn = e.target.closest && e.target.closest('[data-prc-btn="1"]');
                if (dBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    openFromDirectory(dBtn.getAttribute('data-patient-id'));
                }
            }, true);
        }
    }

    function init() {
        if (_ready) {
            watchLists();
            return;
        }
        _ready = true;
        ensureShell();
        bindOnce();
        watchLists();
        fillPanelFilters();
        document.addEventListener('app-session-sync', function () {
            setTimeout(watchLists, 80);
        });
        setInterval(function () {
            injectQueueActions();
            injectDirectoryButtons();
        }, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    window.addEventListener('app-lang-change', function () {
        applyI18n(g('patientRecallModal'));
        applyI18n(g('tab-reminder'));
        applyI18n(g('prcSendModal'));
        var tabBtn = document.querySelector('.appt-tab[data-prc-tab="1"]');
        if (tabBtn) tabBtn.textContent = tr('prc.tab');
        injectQueueActions();
        injectDirectoryButtons();
        renderPanelGrid();
        renderModalGrid();
        renderChips();
        setChannel(_channel);
    });

    return {
        init: init,
        open: open,
        showPanel: showPanel
    };
})();

window.PATIENT_RECALL = PATIENT_RECALL;
