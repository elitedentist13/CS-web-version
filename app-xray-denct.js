/* =========================================================
   app-xray-denct.js - open the DenCT dental CBCT sidecar.
   Local fork of https://github.com/ZoliQua/Dental-CBCT-Viewer
   (MPR, true-3D, panoramic OPG, implant plan, guide STL).
   Independent of OHIF and Banana Dicom Reader. Helper save-back.
   ========================================================= */

(function () {
    var MORE = {
        'xdv.open': { en: 'CBCT Viewer', 'zh-CN': 'CBCT 查看器', 'zh-Hant': 'CBCT 檢視器' },
        'xdv.openTitle': { en: 'Open DenCT (Dental CBCT Viewer): MPR, true-3D, panoramic OPG, implant planning and a drill-guide STL. Load a DICOM zip or folder in that window, then share THIS window in X-ray Helper to save a view. Does not replace OHIF or Banana Dicom Reader.', 'zh-CN': '打开 DenCT（牙科 CBCT 查看器）：MPR、真三维、曲面全景、种植规划与导板 STL。在该窗口加载 DICOM zip/文件夹，再用 X 光助手分享该窗口存回。不替代 OHIF 或 Banana DICOM 阅读器。', 'zh-Hant': '開啟 DenCT（牙科 CBCT 檢視器）：MPR、真三維、曲面全景、植體規劃與導板 STL。在該視窗載入 DICOM zip/資料夾，再用 X 光助手分享該視窗存回。不替代 OHIF 或 Banana DICOM 閱讀器。' },
        'xdv.needPatient': { en: 'Select a patient before opening CBCT Viewer.', 'zh-CN': '请先选择病人再打开 CBCT 查看器。', 'zh-Hant': '請先選擇病人再開啟 CBCT 檢視器。' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_DENCT_KEY = 'banana.denct.v1';

function xrayDenctContext(rec) {
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

function xrayDenctViewerOpen(rec) {
    if (typeof xrayPatientId === 'undefined' || !xrayPatientId) {
        if (typeof xrayNotify === 'function') xrayNotify((typeof t === 'function') ? t('xdv.needPatient') : 'Select a patient');
        else if (typeof showAppGlobalToast === 'function') showAppGlobalToast((typeof t === 'function') ? t('xdv.needPatient') : 'Select a patient', { kind: 'warn' });
        return;
    }
    var ctx = xrayDenctContext(rec);
    try { sessionStorage.setItem(XRAY_DENCT_KEY, JSON.stringify(ctx)); } catch (e) { /* ignore */ }
    try { localStorage.setItem(XRAY_DENCT_KEY, JSON.stringify(ctx)); } catch (e2) { /* ignore */ }
    var bust = encodeURIComponent(ctx.build || String(Date.now()));
    var page = 'denct/?v=' + bust;
    var title = 'CBCT Viewer';
    if (ctx.patientNo) title += ' · #' + ctx.patientNo;
    if (ctx.name) title += ' · ' + ctx.name;
    var w = window.open(page, 'banana-denct', 'noopener,noreferrer,width=1440,height=920');
    if (w) {
        try { w.document.title = title; } catch (e3) { /* ignore until load */ }
    }
    if (typeof xrayHelperLaunch === 'function') xrayHelperLaunch();
}

window.xrayDenctViewerOpen = xrayDenctViewerOpen;
window.xrayDenctContext = xrayDenctContext;
