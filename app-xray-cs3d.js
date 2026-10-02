/* =========================================================
   app-xray-cs3d.js - open the Banana Dicom Reader sidecar.
   Cornerstone3D volume + three planes + measure tools.
   Independent of the OHIF CBCT sidecar. Helper save-back.
   ========================================================= */

(function () {
    var MORE = {
        'xdr.open': { en: 'Banana Dicom Reader', 'zh-CN': 'Banana DICOM 阅读器', 'zh-Hant': 'Banana DICOM 閱讀器' },
        'xdr.openTitle': { en: 'Open the Cornerstone3D sidecar (volume + three planes + its own measure tools). Load a DICOM zip or folder there, then share THAT window in X-ray Helper to save a view. Does not replace the OHIF CBCT viewer.', 'zh-CN': '打开 Cornerstone3D 侧窗（容积 + 三平面 + 自带测量）。在那边加载 DICOM zip/文件夹，再用 X 光助手分享该窗口存回。不替代 OHIF CBCT 查看器。', 'zh-Hant': '開啟 Cornerstone3D 側窗（容積 + 三平面 + 自帶測量）。在那邊載入 DICOM zip/資料夾，再用 X 光助手分享該視窗存回。不替代 OHIF CBCT 檢視器。' },
        'xdr.needPatient': { en: 'Select a patient before opening Banana Dicom Reader.', 'zh-CN': '请先选择病人再打开 Banana DICOM 阅读器。', 'zh-Hant': '請先選擇病人再開啟 Banana DICOM 閱讀器。' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_CS3D_KEY = 'banana.cs3d.v1';

function xrayCs3dContext(rec) {
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

function xrayCs3dViewerOpen(rec) {
    if (typeof xrayPatientId === 'undefined' || !xrayPatientId) {
        if (typeof xrayNotify === 'function') xrayNotify((typeof t === 'function') ? t('xdr.needPatient') : 'Select a patient');
        else if (typeof showAppGlobalToast === 'function') showAppGlobalToast((typeof t === 'function') ? t('xdr.needPatient') : 'Select a patient', { kind: 'warn' });
        return;
    }
    var ctx = xrayCs3dContext(rec);
    try { sessionStorage.setItem(XRAY_CS3D_KEY, JSON.stringify(ctx)); } catch (e) { /* ignore */ }
    try { localStorage.setItem(XRAY_CS3D_KEY, JSON.stringify(ctx)); } catch (e2) { /* ignore */ }
    var bust = encodeURIComponent(ctx.build || String(Date.now()));
    var page = 'cs3d/?v=' + bust;
    var title = 'Banana Dicom Reader';
    if (ctx.patientNo) title += ' · #' + ctx.patientNo;
    if (ctx.name) title += ' · ' + ctx.name;
    var w = window.open(page, 'banana-cs3d', 'noopener,noreferrer,width=1440,height=920');
    if (w) {
        try { w.document.title = title; } catch (e3) { /* ignore until load */ }
    }
    if (typeof xrayHelperLaunch === 'function') xrayHelperLaunch();
}

window.xrayCs3dViewerOpen = xrayCs3dViewerOpen;
window.xrayCs3dContext = xrayCs3dContext;
