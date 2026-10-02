/* =========================================================
   app-xray-cbct.js - open the full OHIF Viewer sidecar.
   Load a DICOM zip / folder in that window. Save-back is the
   existing X-ray Helper (share THAT window, snip). Loads after dicom.
   ========================================================= */

(function () {
    var MORE = {
        'xb.open': { en: 'CBCT viewer', 'zh-CN': 'CBCT 查看器', 'zh-Hant': 'CBCT 檢視器' },
        'xb.openTitle': { en: 'Open the OHIF sidecar. Use Load zip or Load folder on the yellow bar (a .zip is unpacked here — OHIF cannot read the archive itself), then share that window in X-ray Helper to save a view to this patient.', 'zh-CN': '打开 OHIF 侧窗。用黄条上的 Load zip / Load folder（zip 由 Banana 解压，OHIF 本身读不了压缩包），再用 X 光助手分享该窗口，把画面存回当前病人。', 'zh-Hant': '開啟 OHIF 側窗。用黃條上的 Load zip / Load folder（zip 由 Banana 解壓，OHIF 本身讀不了壓縮包），再用 X 光助手分享該視窗，把畫面存回目前病人。' },
        'xb.needPatient': { en: 'Select a patient before opening the CBCT viewer.', 'zh-CN': '请先选择病人再打开 CBCT 查看器。', 'zh-Hant': '請先選擇病人再開啟 CBCT 檢視器。' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_CBCT_KEY = 'banana.cbct.v1';

function xrayCbctContext(rec) {
    var p = (typeof xrayPatientData !== 'undefined' && xrayPatientData) || {};
    var recs = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    if (!rec && typeof xraySelected !== 'undefined' && xraySelected && xraySelected.size === 1) {
        var only = null;
        xraySelected.forEach(function (id) { only = id; });
        recs.forEach(function (r) { if (r && String(r.id) === String(only)) rec = r; });
    }
    var url = '';
    var name = '';
    if (rec) {
        url = (typeof xrayBareUrl === 'function') ? xrayBareUrl(rec) : (rec.file_url || '');
        name = rec.file_name || rec.file_path || '';
        if (!/\.(dcm|dicom|zip)$/i.test(name) && !/\.(dcm|dicom|zip)$/i.test(url.split('?')[0])) {
            url = '';
            name = '';
        }
    }
    return {
        patientId: (typeof xrayPatientId !== 'undefined' && xrayPatientId) || p.id || '',
        patientNo: p.patient_no || '',
        name: String(p.chinese_name || p.full_name || '').trim(),
        en: String(p.full_name || '').trim(),
        studyUrl: url,
        fileName: name,
        build: (typeof window !== 'undefined' && window.__JSM_BUILD) || ''
    };
}

function xrayCbctViewerOpen(rec) {
    if (typeof xrayPatientId === 'undefined' || !xrayPatientId) {
        if (typeof xrayNotify === 'function') xrayNotify((typeof t === 'function') ? t('xb.needPatient') : 'Select a patient');
        else if (typeof showAppGlobalToast === 'function') showAppGlobalToast((typeof t === 'function') ? t('xb.needPatient') : 'Select a patient', { kind: 'warn' });
        return;
    }
    var ctx = xrayCbctContext(rec);
    try { sessionStorage.setItem(XRAY_CBCT_KEY, JSON.stringify(ctx)); } catch (e) { /* ignore */ }
    var bust = encodeURIComponent(ctx.build || String(Date.now()));
    var page = 'ohif/?v=' + bust;
    var title = 'CBCT';
    if (ctx.patientNo) title += ' · #' + ctx.patientNo;
    if (ctx.name) title += ' · ' + ctx.name;
    var w = window.open(page, 'banana-cbct', 'noopener,noreferrer,width=1440,height=920');
    if (w) {
        try { w.document.title = title; } catch (e2) { /* ignore until load */ }
    }
    if (typeof xrayHelperLaunch === 'function') xrayHelperLaunch();
}

window.xrayCbctViewerOpen = xrayCbctViewerOpen;
window.xrayCbctContext = xrayCbctContext;
