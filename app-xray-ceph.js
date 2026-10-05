/* =========================================================
   app-xray-ceph.js - open the lateral cephalometric sidecar.
   Same wiring as CBCT / OHIF: new window + X-ray Helper save-back.
   ========================================================= */

(function () {
    var MORE = {
        'xc.open': { en: 'Ceph analysis', 'zh-CN': '头影测量', 'zh-Hant': '頭影測量' },
        'xc.openTitle': { en: 'Open the lateral cephalometric sidecar. Choose Published 1502 or Published + in-house training, auto-detect five 19-point sets, adopt one, and add the whole set to clinic training. Steiner / Downs / Tweed / Wits / McNamara. Export JSON, CSV or a marked PNG. Share that window in X-ray Helper to save a view to this patient.', 'zh-CN': '打开侧位头影片侧窗。可选只用 1502 份公开描记，或公开库加诊所训练。自动标 5 组 19 点，选定后整组纳入训练库。Steiner / Downs / Tweed / Wits / McNamara。导出 JSON、CSV 或带点的 PNG。用 X 光助手分享该窗口即可存回当前病人。', 'zh-Hant': '開啟側位頭影片側窗。可選只用 1502 份公開描記，或公開庫加診所訓練。自動標 5 組 19 點，選定後整組納入訓練庫。Steiner / Downs / Tweed / Wits / McNamara。匯出 JSON、CSV 或帶點的 PNG。用 X 光助手分享該視窗即可存回目前病人。' },
        'xc.needPatient': { en: 'Select a patient before opening cephalometric analysis.', 'zh-CN': '请先选择病人再打开头影测量。', 'zh-Hant': '請先選擇病人再開啟頭影測量。' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_CEPH_KEY = 'banana.ceph.v1';

function xrayCephContext(rec) {
    var p = (typeof xrayPatientData !== 'undefined' && xrayPatientData) || {};
    var recs = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    if (!rec && typeof xraySelected !== 'undefined' && xraySelected && xraySelected.size === 1) {
        var only = null;
        xraySelected.forEach(function (id) { only = id; });
        recs.forEach(function (r) { if (r && String(r.id) === String(only)) rec = r; });
    }
    if (!rec && recs && recs.length) {
        recs.forEach(function (r) {
            if (rec) return;
            var t = String((r && r.xray_type) || '').toLowerCase();
            if (t.indexOf('ceph') >= 0 || t.indexOf('lateral') >= 0) rec = r;
        });
    }
    var url = '';
    var name = '';
    if (rec) {
        url = (typeof xrayDisplayUrl === 'function') ? xrayDisplayUrl(rec) : ((typeof xrayBareUrl === 'function') ? xrayBareUrl(rec) : (rec.file_url || ''));
        name = rec.file_name || rec.file_path || '';
    }
    return {
        patientId: (typeof xrayPatientId !== 'undefined' && xrayPatientId) || p.id || '',
        patientNo: p.patient_no || '',
        name: String(p.chinese_name || p.full_name || '').trim(),
        en: String(p.full_name || '').trim(),
        studyUrl: url,
        fileName: name,
        xrayId: rec && rec.id ? rec.id : '',
        build: (typeof window !== 'undefined' && window.__JSM_BUILD) || ''
    };
}

function xrayCephViewerOpen(rec) {
    if (typeof xrayPatientId === 'undefined' || !xrayPatientId) {
        if (typeof xrayNotify === 'function') xrayNotify((typeof t === 'function') ? t('xc.needPatient') : 'Select a patient');
        else if (typeof showAppGlobalToast === 'function') showAppGlobalToast((typeof t === 'function') ? t('xc.needPatient') : 'Select a patient', { kind: 'warn' });
        return;
    }
    var ctx = xrayCephContext(rec);
    try { sessionStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e) { /* ignore */ }
    try { localStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e2) { /* ignore */ }
    var bust = encodeURIComponent(ctx.build || String(Date.now()));
    var page = 'ceph/?v=' + bust;
    var title = 'Ceph';
    if (ctx.patientNo) title += ' · #' + ctx.patientNo;
    if (ctx.name) title += ' · ' + ctx.name;
    var w = window.open(page, 'banana-ceph', 'noopener,noreferrer,width=1440,height=920');
    if (w) {
        try { w.document.title = title; } catch (e2) { /* ignore until load */ }
    }
    if (typeof xrayHelperLaunch === 'function') xrayHelperLaunch();
}

window.xrayCephViewerOpen = xrayCephViewerOpen;
window.xrayCephContext = xrayCephContext;
