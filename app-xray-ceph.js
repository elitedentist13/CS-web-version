/* =========================================================
   app-xray-ceph.js - open the lateral cephalometric sidecar.
   Opens the cephalometric window on its own. Staff can share that
   window in X-ray Helper when they want a saved view.
   Save tracing copies the film into the xrays bucket, creates a
   ceph_saves ID, and wires that ID to the tracing so the same
   study reopens with those landmarks on any clinic PC.
   ========================================================= */

(function () {
    var MORE = {
        'xc.open': { en: 'Banana Ceph analysis', 'zh-CN': '香蕉头影测量', 'zh-Hant': '香蕉頭影測量' },
        'xc.openTitle': { en: 'Open Banana Ceph. A Cephalometric film selected on this patient’s X-ray strip loads as the source. A saved tracing on this film is restored as the default landmarks. Choose Published 1502 or Published + in-house training, auto-detect two 19-point sets, view them, Adopt selection, and add the whole set to clinic training. Compare Steiner / Downs / Tweed / Wits / McNamara to Caucasian or HK Chinese norms. An extraction index is ceph-only guidance (crowding not assessed), not a treatment plan. Export JSON, CSV or a marked PNG. Share that window in X-ray Helper to save a view to this patient.', 'zh-CN': '打开香蕉头影测量。X 光条上选中的头颅测量片会作为底片载入。若此片已保存描记，会作为默认标志点载入。可选只用 1502 份公开描记，或公开库加诊所训练。自动标 2 组 19 点，点看后采用选定组并整组纳入训练库。测量对照白人或香港华人常值。Steiner / Downs / Tweed / Wits / McNamara。拔牙倾向仅供头影参考，不是治疗计划。导出 JSON、CSV 或带点的 PNG。用 X 光助手分享该窗口即可存回当前病人。', 'zh-Hant': '開啟香蕉頭影測量。X 光條上選中的頭顱測量片會作為底片載入。若此片已儲存描記，會作為預設標誌點載入。可選只用 1502 份公開描記，或公開庫加診所訓練。自動標 2 組 19 點，點看後採用選定組並整組納入訓練庫。測量對照白人或香港華人常值。Steiner / Downs / Tweed / Wits / McNamara。拔牙傾向僅供頭影參考，不是治療計劃。匯出 JSON、CSV 或帶點的 PNG。用 X 光助手分享該視窗即可存回目前病人。' },
        'xc.needPatient': { en: 'Select a patient before opening Banana Ceph analysis.', 'zh-CN': '请先选择病人再打开香蕉头影测量。', 'zh-Hant': '請先選擇病人再開啟香蕉頭影測量。' },
        'xc.needCephFilm': { en: 'Tick a Cephalometric film on the X-ray strip, then open Banana Ceph.', 'zh-CN': '请在 X 光条勾选一张头颅测量片，再打开香蕉头影测量。', 'zh-Hant': '請在 X 光條勾選一張頭顱測量片，再開啟香蕉頭影測量。' },
        'xc.traceNeedSql': { en: 'Tracing kept on this computer only. Run xray_ceph.sql in Supabase so a film copy, save ID and tracing are stored with the patient.', 'zh-CN': '描记只留在这台电脑。请在 Supabase 运行 xray_ceph.sql，才会把底片副本、保存 ID 和描记存到该病人。', 'zh-Hant': '描記只留在這台電腦。請在 Supabase 執行 xray_ceph.sql，才會把底片副本、保存 ID 和描記存到該病人。' },
        'xc.stripAdded': { en: 'Banana Ceph tracing copy added to the Cephalometric films on this patient’s X-ray strip.', 'zh-CN': '已在该病人 X 光条的头颅测量分类中加入描记副本。', 'zh-Hant': '已在該病人 X 光條的頭顱測量分類中加入描記副本。' },
        'xc.stripFilmAdded': { en: 'Loaded ceph film added to this patient’s X-ray strip as Cephalometric.', 'zh-CN': '载入的头影片已作为头颅测量加入该病人 X 光条。', 'zh-Hant': '載入的頭影片已作為頭顱測量加入該病人 X 光條。' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_CEPH_KEY = 'banana.ceph.v1';
var XRAY_CEPH_CH = 'banana.ceph.save.v1';
var XRAY_CEPH_TYPE = 'Cephalometric';
var XRAY_CEPH = { off: null, savesOff: null };

function xrayCephIsTrace(rec) {
    if (!rec || typeof rec !== 'object' || !rec.pts || typeof rec.pts !== 'object') return false;
    var id;
    for (id in rec.pts) {
        if (!Object.prototype.hasOwnProperty.call(rec.pts, id)) continue;
        var p = rec.pts[id];
        if (p && isFinite(p.x) && isFinite(p.y) && (p.x !== 0 || p.y !== 0)) return true;
    }
    return false;
}

function xrayCephMissingCol(err) {
    if (typeof xrayCtxIsMissingColErr === 'function') return xrayCtxIsMissingColErr(err);
    if (!err) return false;
    var code = String(err.code || '');
    if (code === '42703' || code === 'PGRST204') return true;
    return /column .* does not exist|could not find the .* column|schema cache/i.test(String(err.message || err.details || err.hint || ''));
}

function xrayCephMissingRel(err) {
    if (!err) return false;
    var code = String(err.code || '');
    if (code === '42P01' || code === 'PGRST205') return true;
    return /could not find the table|relation .* does not exist|schema cache/i.test(String(err.message || err.details || err.hint || ''));
}

function xrayCephPatchMem(xrayId, tracing) {
    var rows = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    rows.forEach(function (r) {
        if (r && String(r.id) === String(xrayId)) r.ceph_tracing = tracing;
    });
    if (typeof xrayCtxRecord === 'function') {
        var other = xrayCtxRecord(xrayId);
        if (other) other.ceph_tracing = tracing;
    }
}

function xrayCephLocalTrace(xrayId, fileName) {
    try {
        var db = JSON.parse(localStorage.getItem('banana.ceph.savedTrace.v1') || '{}');
        var k, rec, id = xrayId != null ? String(xrayId) : '';
        for (k in db) {
            if (!Object.prototype.hasOwnProperty.call(db, k)) continue;
            rec = db[k];
            if (!xrayCephIsTrace(rec)) continue;
            if (id && String(rec.xrayId) === id) return rec;
        }
        if (fileName) {
            for (k in db) {
                if (!Object.prototype.hasOwnProperty.call(db, k)) continue;
                rec = db[k];
                if (xrayCephIsTrace(rec) && rec.fileName === fileName) return rec;
            }
        }
        if (id) {
            for (k in db) {
                if (String(k).indexOf(':' + id) >= 0 && xrayCephIsTrace(db[k])) return db[k];
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

function xrayCephSourceRec(xrayId) {
    var rec = null;
    var rows = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    rows.forEach(function (r) {
        if (r && String(r.id) === String(xrayId)) rec = r;
    });
    if (!rec && typeof xrayCtxRecord === 'function') rec = xrayCtxRecord(xrayId);
    return rec || null;
}

function xrayCephDataUrlToBlob(url) {
    if (!url || String(url).indexOf('data:') !== 0) return null;
    var parts = String(url).split(',');
    var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    var bin = '';
    try {
        if (typeof atob !== 'function') return null;
        bin = atob(parts[1] || '');
    } catch (e) { return null; }
    var arr = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

function xrayCephExtFromName(name, mime) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
    if (String(mime || '').indexOf('png') >= 0) return 'png';
    return 'jpg';
}

function xrayCephBucket() {
    return (typeof XRAY_BUCKET !== 'undefined' && XRAY_BUCKET) ? XRAY_BUCKET : 'xrays';
}

function xrayCephPublicUrl(dest) {
    if (typeof xrayGetPublicUrlForPath === 'function') {
        var fromFn = xrayGetPublicUrlForPath(dest);
        if (fromFn) return fromFn;
    }
    if (typeof SB === 'undefined' || !SB || !SB.storage) return '';
    var ur = SB.storage.from(xrayCephBucket()).getPublicUrl(dest);
    return (ur && ur.data && ur.data.publicUrl) || (ur && ur.publicUrl) || '';
}

function xrayCephFetchFilmBlob(xrayId, opt) {
    opt = opt || {};
    var fromUrl = xrayCephDataUrlToBlob(opt.filmDataUrl);
    if (fromUrl) return Promise.resolve(fromUrl);
    var rec = xrayCephSourceRec(xrayId);
    var path = (rec && rec.file_path) || opt.filePath || '';
    function fromHttp() {
        var href = (rec && rec.file_url) || opt.fileUrl || '';
        if (!href || typeof fetch !== 'function') return Promise.resolve(null);
        return fetch(href).then(function (res) { return res.ok ? res.blob() : null; }).catch(function () { return null; });
    }
    if (path && typeof SB !== 'undefined' && SB && SB.storage && typeof SB.storage.from === 'function') {
        return Promise.resolve(SB.storage.from(xrayCephBucket()).download(path)).then(function (r) {
            if (r && r.data && !r.error) return r.data;
            return fromHttp();
        }).catch(function () { return fromHttp(); });
    }
    return fromHttp();
}

function xrayCephStudyTarget(fallbackId) {
    var opened = fallbackId || (typeof xrayPatientId !== 'undefined' ? xrayPatientId : '') || '';
    var p = (typeof xrayPatientData !== 'undefined' && xrayPatientData) || {};
    var fallback = {
        ok: !!opened,
        id: opened,
        patient_no: p.patient_no || null,
        full_name: p.full_name || p.chinese_name || null,
        clinic_tag: (typeof xrayHomeClinicTag === 'function') ? (xrayHomeClinicTag() || '') : '',
        sameAsOpened: true
    };
    var t = null;
    try {
        if (typeof xrayResolveUploadPatient === 'function') t = xrayResolveUploadPatient();
        else if (typeof xrayUploadTargetPatient === 'function') t = xrayUploadTargetPatient();
    } catch (eT) { t = null; }
    if (t && t.ok && t.id) return t;
    return fallback;
}

function xrayCephUniqueDest(patientId, xrayId, ext) {
    var stamp = String(Date.now());
    var rand = Math.random().toString(36).slice(2, 8);
    var src = String(xrayId || 'study').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
    return String(patientId) + '/' + stamp + '_ceph_' + src + '_' + rand + '.' + ext;
}

function xrayCephReuseSourceUrl(xrayId, opt, body) {
    opt = opt || {};
    body = body || {};
    var rec = xrayCephSourceRec(xrayId);
    var url = (rec && rec.file_url) || opt.fileUrl || body.fileUrl || '';
    if (!url) return null;
    var ext = xrayCephExtFromName(opt.fileName || body.fileName || (rec && rec.file_name), '');
    var destId = body.patientId || opt.patientId || (rec && rec.patient_id) || '';
    if (!destId) return null;
    return {
        filePath: xrayCephUniqueDest(destId, xrayId, ext),
        fileUrl: url,
        fileName: opt.fileName || body.fileName || (rec && rec.file_name) || ('ceph-' + String(xrayId) + '.' + ext),
        reusedUrl: true
    };
}

function xrayCephUploadCopy(xrayId, blob, opt) {
    opt = opt || {};
    if (!blob || typeof SB === 'undefined' || !SB || !SB.storage || typeof SB.storage.from !== 'function') {
        return Promise.resolve(null);
    }
    var rec = xrayCephSourceRec(xrayId);
    var patientId = opt.patientId || (rec && rec.patient_id) || (typeof xrayPatientId !== 'undefined' ? xrayPatientId : '') || '';
    if (!patientId) return Promise.resolve(null);
    var ext = xrayCephExtFromName(opt.fileName || (rec && rec.file_name), blob.type);
    var dest = xrayCephUniqueDest(patientId, xrayId, ext);
    var bucket = xrayCephBucket();
    var file = blob;
    if (typeof File === 'function') {
        try {
            file = new File([blob], dest.split('/').pop(), { type: blob.type || 'image/jpeg' });
        } catch (eF) { file = blob; }
    }
    return Promise.resolve(SB.storage.from(bucket).upload(dest, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: (file && file.type) || blob.type || 'image/jpeg'
    })).then(function (r) {
        if (r && r.error && /duplicate|already exists|resource already/i.test(String(r.error.message || ''))) {
            dest = xrayCephUniqueDest(patientId, xrayId, ext);
            return Promise.resolve(SB.storage.from(bucket).upload(dest, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: (file && file.type) || blob.type || 'image/jpeg'
            })).then(function (r2) {
                if (r2 && r2.error) return null;
                return {
                    filePath: dest,
                    fileUrl: xrayCephPublicUrl(dest),
                    fileName: opt.fileName || (rec && rec.file_name) || (String(xrayId) + '.' + ext)
                };
            });
        }
        if (r && r.error) return null;
        return {
            filePath: dest,
            fileUrl: xrayCephPublicUrl(dest),
            fileName: opt.fileName || (rec && rec.file_name) || (String(xrayId) + '.' + ext)
        };
    }).catch(function () { return null; });
}

function xrayCephRow(r) {
    return r && r.data && (Array.isArray(r.data) ? r.data[0] : r.data);
}

function xrayCephUpsertSave(row) {
    if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function' || XRAY_CEPH.savesOff) {
        return Promise.resolve(null);
    }
    var src = row && row.source_xray_id;
    if (!src) return Promise.resolve(null);
    function fromSaves() {
        try { return SB.from('ceph_saves'); } catch (e) { return null; }
    }
    var q0 = fromSaves();
    if (!q0 || typeof q0.select !== 'function') return Promise.resolve(null);
    return Promise.resolve(q0.select('id').eq('source_xray_id', src).limit(1)).then(function (found) {
        if (found && found.error && xrayCephMissingRel(found.error)) {
            XRAY_CEPH.savesOff = true;
            return null;
        }
        var existing = xrayCephRow(found);
        if (existing && existing.id) {
            var q1 = fromSaves();
            if (!q1 || typeof q1.update !== 'function') return { id: existing.id, file_url: row.file_url, file_path: row.file_path };
            var upd = q1.update(row).eq('id', existing.id);
            if (upd && typeof upd.select === 'function') upd = upd.select('id,file_url,file_path').limit(1);
            return Promise.resolve(upd).then(function (r) {
                if (r && r.error) return { id: existing.id, file_url: row.file_url, file_path: row.file_path };
                return xrayCephRow(r) || { id: existing.id, file_url: row.file_url, file_path: row.file_path };
            });
        }
        var q2 = fromSaves();
        if (!q2 || typeof q2.insert !== 'function') return null;
        var ins = q2.insert(row);
        if (ins && typeof ins.select === 'function') ins = ins.select('id,file_url,file_path').limit(1);
        return Promise.resolve(ins).then(function (r) {
            if (r && r.error && xrayCephMissingRel(r.error)) {
                XRAY_CEPH.savesOff = true;
                return null;
            }
            if (r && r.error) return null;
            return xrayCephRow(r);
        });
    }).catch(function () { return null; });
}

function xrayCephAttachSave(tracing, save) {
    if (!tracing || !save) return tracing;
    if (save.id) tracing.cephSaveId = save.id;
    if (save.cephXrayId) tracing.cephXrayId = save.cephXrayId;
    if (save.file_url) tracing.fileUrl = save.file_url;
    if (save.file_path) tracing.filePath = save.file_path;
    return tracing;
}

function xrayCephPatchStudyMem(row, target) {
    if (!row || !row.id) return;
    var tag = (target && target.clinic_tag) || '';
    if (!tag && typeof xrayHomeClinicTag === 'function') tag = xrayHomeClinicTag() || '';
    var rec = {
        id: row.id,
        patient_id: row.patient_id,
        file_path: row.file_path,
        file_url: row.file_url,
        file_name: row.file_name,
        file_size: row.file_size,
        xray_type: row.xray_type || XRAY_CEPH_TYPE,
        notes: row.notes || 'Banana Ceph film',
        taken_date: row.taken_date,
        ceph_tracing: row.ceph_tracing || row.tracing || null,
        _isHome: true
    };
    rec._clinicTag = tag;
    rec._clinicLabel = (typeof xrayClinicLabelFromTag === 'function')
        ? xrayClinicLabelFromTag(tag)
        : tag;
    var rows = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : null;
    if (rows) {
        var found = false;
        rows.forEach(function (r, i) {
            if (r && String(r.id) === String(rec.id)) {
                rows[i] = Object.assign({}, r, rec);
                found = true;
            }
        });
        if (!found) rows.unshift(rec);
    }
    if (typeof xrayCtxRecord === 'function') {
        var other = xrayCtxRecord(rec.id);
        if (other) Object.keys(rec).forEach(function (k) { other[k] = rec[k]; });
    }
}

function xrayCephEl(id) {
    if (typeof g === 'function') return g(id);
    if (typeof document !== 'undefined' && document.getElementById) return document.getElementById(id);
    return null;
}

function xrayCephClearStripFilters() {
    var year = xrayCephEl('xrayFilterYear');
    var search = xrayCephEl('xrayFilterSearch');
    var tooth = xrayCephEl('xrayFilterTooth');
    if (year) year.value = '';
    if (search) search.value = '';
    if (tooth) tooth.value = '';
    try { if (typeof xrayWhenFilter !== 'undefined') xrayWhenFilter = ''; } catch (eW) { /* ignore */ }
    if (typeof XRAY_CTX !== 'undefined' && XRAY_CTX) {
        XRAY_CTX.revFilter = '';
        XRAY_CTX.toothFilter = [];
        XRAY_CTX.toothBad = false;
    }
    var whenHost = xrayCephEl('xrayWhenChips');
    if (whenHost && whenHost.querySelectorAll) {
        Array.prototype.forEach.call(whenHost.querySelectorAll('.xray-chip'), function (btn) {
            btn.classList.toggle('active', !btn.getAttribute('data-when'));
        });
    }
    if (typeof xraySetTypeFilter === 'function') {
        try { xraySetTypeFilter(XRAY_CEPH_TYPE); return; } catch (eT) { /* ignore */ }
    }
    var type = xrayCephEl('xrayFilterType');
    if (type) type.value = XRAY_CEPH_TYPE;
    if (typeof xrayFillTypeChips === 'function') {
        try { xrayFillTypeChips(); } catch (eC) { /* ignore */ }
    }
}

function xrayCephScrollStripTile(studyId) {
    if (!studyId || typeof document === 'undefined' || !document.querySelector) return;
    var btn = document.querySelector('#xrayClinicStrips .xray-strip-tile[data-id="' +
        String(studyId).replace(/"/g, '') + '"]');
    if (!btn) return;
    var scroller = btn.closest ? btn.closest('.xray-clinic-scroller') : null;
    if (scroller) {
        try { scroller.scrollLeft = Math.max(0, btn.offsetLeft - 24); } catch (eS) { /* ignore */ }
    }
    try { btn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (eV) { /* ignore */ }
}

function xrayCephRefreshStrip(study, target) {
    var studyId = study && (study.id || study);
    if (study && study.id) xrayCephPatchStudyMem(study, target);
    xrayCephClearStripFilters();
    if (studyId) {
        try { if (typeof xrayPinnedId !== 'undefined') xrayPinnedId = studyId; } catch (eP) { /* ignore */ }
    }
    if (target && typeof xrayRevealWriteClinic === 'function') {
        try { xrayRevealWriteClinic(target); } catch (eR) { /* ignore */ }
    }
    if (typeof setXrayView === 'function') {
        try { setXrayView('strips'); } catch (eV) { /* ignore */ }
    }
    function paint() {
        if (typeof filterXrays === 'function') {
            try { filterXrays(); } catch (eF) { /* ignore */ }
        }
        xrayCephScrollStripTile(studyId);
        return true;
    }
    if (typeof loadXrayRecords === 'function') {
        return Promise.resolve(loadXrayRecords()).then(function () {
            if (study && study.id && typeof xrayAllRecords !== 'undefined' && xrayAllRecords) {
                var seen = xrayAllRecords.some(function (r) {
                    return r && String(r.id) === String(study.id);
                });
                if (!seen) xrayCephPatchStudyMem(study, target);
            }
            return paint();
        }, function () { return paint(); });
    }
    paint();
    return Promise.resolve(true);
}

function xrayCephFindByPath(filePath) {
    if (!filePath || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(null);
    return Promise.resolve(SB.from('xrays').select('id,file_path,file_url,patient_id').eq('file_path', filePath).limit(1)).then(function (r) {
        return xrayCephRow(r);
    }, function () { return null; });
}

function xrayCephSelectInsert(makeOp) {
    var q = makeOp();
    if (q && typeof q.select === 'function') q = q.select('id,file_path,file_url,patient_id').limit(1);
    return Promise.resolve(q);
}

function xrayCephUpsertStudyFilm(copy, body, blob, target) {
    if (!copy || !copy.filePath || !copy.fileUrl || !body) return Promise.resolve(null);
    if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(null);
    target = target || xrayCephStudyTarget(body.patientId);
    var destId = (target && target.id) || body.patientId;
    if (!destId) return Promise.resolve(null);
    var p = (typeof xrayPatientData !== 'undefined' && xrayPatientData) || {};
    var taken = (body.savedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    var row = {
        patient_id: destId,
        patient_no: (target && target.patient_no) || p.patient_no || null,
        patient_name: String((target && target.full_name) || p.chinese_name || p.full_name || '').trim() || null,
        file_path: copy.filePath,
        file_url: copy.fileUrl || '',
        file_name: copy.fileName || body.fileName || ('ceph-' + String(body.xrayId || 'study') + '.jpg'),
        file_size: blob && blob.size ? blob.size : null,
        xray_type: XRAY_CEPH_TYPE,
        notes: (body && body.notes) || 'Banana Ceph study',
        taken_date: taken,
        uploaded_by: (typeof currentName !== 'undefined' ? currentName : null)
    };
    function finish(created) {
        if (!created || !created.id) return Promise.resolve(null);
        var out = {
            id: created.id,
            patient_id: created.patient_id || destId,
            file_path: created.file_path || copy.filePath,
            file_url: created.file_url || copy.fileUrl,
            file_name: row.file_name,
            file_size: row.file_size,
            xray_type: row.xray_type,
            notes: row.notes,
            taken_date: taken,
            ceph_tracing: body
        };
        xrayCephPatchStudyMem(out, target);
        var patch = { xray_type: XRAY_CEPH_TYPE, notes: row.notes };
        return Promise.resolve(SB.from('xrays').update(patch).eq('id', out.id)).then(function () {
            if (!xrayCephIsTrace(body)) return out;
            return xrayCephStampFilm(out.id, body).then(function () { return out; }, function () { return out; });
        }, function () {
            if (!xrayCephIsTrace(body)) return out;
            return xrayCephStampFilm(out.id, body).then(function () { return out; }, function () { return out; });
        });
    }
    function insertStudy() {
        var slim = {
            patient_id: row.patient_id,
            file_path: row.file_path,
            file_url: row.file_url,
            file_name: row.file_name,
            xray_type: row.xray_type,
            notes: row.notes,
            taken_date: row.taken_date
        };
        var insP;
        if (typeof xrayCtxInsert === 'function') {
            insP = Promise.resolve(xrayCtxInsert(row, null, destId, taken)).then(function (r) {
                if (r && r.error && xrayCephMissingCol(r.error)) {
                    return xrayCephSelectInsert(function () { return SB.from('xrays').insert([slim]); });
                }
                if (r && !xrayCephRow(r) && !(r && r.error)) {
                    return xrayCephFindByPath(copy.filePath).then(function (found) {
                        return found ? { data: [found], error: null } : r;
                    });
                }
                return r;
            });
        } else {
            insP = xrayCephSelectInsert(function () { return SB.from('xrays').insert([row]); });
        }
        return insP.then(function (r) {
            if (r && r.error && xrayCephMissingCol(r.error)) {
                return xrayCephSelectInsert(function () { return SB.from('xrays').insert([slim]); }).then(function (r2) {
                    if (r2 && r2.error) return null;
                    return xrayCephRow(r2) || xrayCephFindByPath(copy.filePath);
                }, function () { return xrayCephFindByPath(copy.filePath); });
            }
            if (r && r.error) return xrayCephFindByPath(copy.filePath);
            return xrayCephRow(r) || xrayCephFindByPath(copy.filePath);
        }, function () { return xrayCephFindByPath(copy.filePath); }).then(finish);
    }
    return insertStudy();
}

function xrayCephPublishSource(blob, opt) {
    opt = opt || {};
    if (!blob && opt.filmDataUrl) blob = xrayCephDataUrlToBlob(opt.filmDataUrl);
    if (!blob) return Promise.resolve({ ok: false, error: 'film' });
    var target = xrayCephStudyTarget(opt.patientId);
    if (!target || !target.id) return Promise.resolve({ ok: false, error: 'patient' });
    var body = {
        patientId: target.id,
        fileName: opt.fileName || (blob && blob.name) || 'ceph.jpg',
        notes: 'Banana Ceph film',
        savedAt: new Date().toISOString(),
        xrayId: opt.xrayId || 'src'
    };
    return xrayCephUploadCopy(body.xrayId, blob, { patientId: body.patientId, fileName: body.fileName }).then(function (copy) {
        if (!copy) return { ok: false, error: 'film' };
        return xrayCephUpsertStudyFilm(copy, body, blob, target).then(function (study) {
            if (!study || !study.id) return { ok: false, error: 'write' };
            if (typeof xrayNotify === 'function') {
                try {
                    xrayNotify((typeof t === 'function') ? t('xc.stripFilmAdded') : 'Loaded ceph added as Cephalometric');
                } catch (eN) { /* ignore */ }
            }
            return xrayCephRefreshStrip(study, target).then(function () {
                return {
                    ok: true,
                    cloud: true,
                    copied: !copy.reusedUrl,
                    xrayId: study.id,
                    fileUrl: study.file_url || copy.fileUrl,
                    filePath: study.file_path || copy.filePath,
                    fileName: copy.fileName || body.fileName
                };
            });
        });
    }).catch(function () { return { ok: false, error: 'net' }; });
}

function xrayCephFetchLatestForPatient(patientId) {
    if (!patientId || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(null);
    if (XRAY_CEPH.savesOff) return Promise.resolve(null);
    var q;
    try { q = SB.from('ceph_saves'); } catch (e) { return Promise.resolve(null); }
    if (!q || typeof q.select !== 'function') return Promise.resolve(null);
    var sel = q.select('id,patient_id,source_xray_id,file_url,file_path,file_name,tracing,updated_at').eq('patient_id', patientId);
    if (sel && typeof sel.order === 'function') sel = sel.order('updated_at', { ascending: false });
    if (sel && typeof sel.limit === 'function') sel = sel.limit(1);
    return Promise.resolve(sel).then(function (r) {
        if (r && r.error && xrayCephMissingRel(r.error)) {
            XRAY_CEPH.savesOff = true;
            return null;
        }
        if (r && r.error) return null;
        var row = xrayCephRow(r);
        if (!row || !xrayCephIsTrace(row.tracing)) return null;
        xrayCephAttachSave(row.tracing, row);
        if (row.source_xray_id) xrayCephPatchMem(row.source_xray_id, row.tracing);
        return row;
    }, function () { return null; });
}

function xrayCephFetchSave(xrayId) {
    if (!xrayId || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(null);
    if (XRAY_CEPH.savesOff) return Promise.resolve(null);
    var q;
    try { q = SB.from('ceph_saves'); } catch (e) { return Promise.resolve(null); }
    if (!q || typeof q.select !== 'function') return Promise.resolve(null);
    return Promise.resolve(q.select('id,patient_id,source_xray_id,file_url,file_path,file_name,tracing').eq('source_xray_id', xrayId).limit(1)).then(function (r) {
        if (r && r.error && xrayCephMissingRel(r.error)) {
            XRAY_CEPH.savesOff = true;
            return null;
        }
        if (r && r.error) return null;
        var row = xrayCephRow(r);
        if (!row || !xrayCephIsTrace(row.tracing)) return null;
        xrayCephAttachSave(row.tracing, row);
        xrayCephPatchMem(xrayId, row.tracing);
        return row;
    }, function () { return null; });
}

function xrayCephFetchTracing(xrayId) {
    if (!xrayId) return Promise.resolve(null);
    return xrayCephFetchSave(xrayId).then(function (save) {
        if (save && xrayCephIsTrace(save.tracing)) return save.tracing;
        if (XRAY_CEPH.off === true) return null;
        if (typeof SB === 'undefined' || !SB || !SB.from) return null;
        return Promise.resolve(SB.from('xrays').select('ceph_tracing').eq('id', xrayId).limit(1)).then(function (r) {
            if (r && r.error && xrayCephMissingCol(r.error)) {
                XRAY_CEPH.off = true;
                return null;
            }
            var t = xrayCephRow(r) && xrayCephRow(r).ceph_tracing;
            if (!xrayCephIsTrace(t)) return null;
            xrayCephPatchMem(xrayId, t);
            return t;
        }, function () { return null; });
    });
}

function xrayCephStampFilm(xrayId, tracing) {
    if (XRAY_CEPH.off === true) return Promise.resolve({ ok: false, error: 'col', xrayId: xrayId });
    if (typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve({ ok: false, error: 'sb', xrayId: xrayId });
    return Promise.resolve(SB.from('xrays').update({ ceph_tracing: tracing }).eq('id', xrayId)).then(function (r) {
        if (r && r.error && xrayCephMissingCol(r.error)) {
            XRAY_CEPH.off = true;
            return { ok: false, error: 'col', xrayId: xrayId };
        }
        if (r && r.error) return { ok: false, error: 'write', xrayId: xrayId };
        XRAY_CEPH.off = false;
        xrayCephPatchMem(xrayId, tracing);
        return { ok: true, cloud: true, xrayId: xrayId };
    }, function () { return { ok: false, error: 'net', xrayId: xrayId }; });
}

function xrayCephIsUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}

function xrayCephSaveTracing(xrayId, tracing, opt) {
    opt = opt || {};
    if (!xrayCephIsTrace(tracing)) return Promise.resolve({ ok: false, error: 'payload' });
    var srcId = xrayId || (tracing && tracing.xrayId) || '';
    if (srcId === 'new' || srcId === 'x') srcId = '';
    var rec = srcId ? xrayCephSourceRec(srcId) : null;
    var body = {
        v: 1,
        kind: tracing.kind || 'banana.ceph.savedTrace',
        savedAt: tracing.savedAt || new Date().toISOString(),
        xrayId: srcId,
        fileName: tracing.fileName || opt.fileName || (rec && rec.file_name) || '',
        patientId: tracing.patientId || opt.patientId || (rec && rec.patient_id) || (typeof xrayPatientId !== 'undefined' ? xrayPatientId : '') || '',
        pts: tracing.pts,
        extra: tracing.extra || {},
        profile: tracing.profile || [],
        mmPerPx: tracing.mmPerPx,
        calibrated: !!tracing.calibrated,
        normSet: tracing.normSet,
        source: tracing.source,
        cvm: tracing.cvm || 0,
        cvmVia: tracing.cvmVia || '',
        cephSaveId: tracing.cephSaveId || '',
        cephXrayId: tracing.cephXrayId || '',
        notes: 'Banana Ceph study'
    };
    if (srcId) xrayCephPatchMem(srcId, body);
    var target = xrayCephStudyTarget(body.patientId);
    if (target && target.id) body.patientId = target.id;
    if (!body.patientId) return Promise.resolve({ ok: false, error: 'patient' });
    var destKey = srcId || 'new';
    var stampP = srcId ? xrayCephStampFilm(srcId, body) : Promise.resolve({ ok: true, cloud: true, xrayId: '' });
    return stampP.then(function (base) {
        if (base && base.error === 'col') return base;
        return xrayCephFetchFilmBlob(srcId, opt).then(function (blob) {
            var copyP = blob ? xrayCephUploadCopy(destKey, blob, { patientId: body.patientId, fileName: body.fileName }) : Promise.resolve(null);
            return copyP.then(function (copy) {
                if (!copy) copy = xrayCephReuseSourceUrl(srcId, opt, body);
                if (!copy) return { ok: !!(base && base.ok), cloud: !!(base && base.cloud), error: 'film', xrayId: srcId };
                var saveRow = {
                    patient_id: body.patientId || null,
                    source_xray_id: srcId || null,
                    file_path: copy.filePath || (rec && rec.file_path) || '',
                    file_url: copy.fileUrl || (rec && rec.file_url) || opt.fileUrl || '',
                    file_name: copy.fileName || body.fileName,
                    tracing: body,
                    updated_at: new Date().toISOString()
                };
                return xrayCephUpsertStudyFilm(copy, body, blob, target).then(function (study) {
                    if (study && study.id) {
                        body.cephXrayId = study.id;
                        if (!body.xrayId) body.xrayId = study.id;
                        if (!saveRow.source_xray_id) saveRow.source_xray_id = study.id;
                    } else delete body.cephXrayId;
                    body.fileUrl = copy.fileUrl;
                    body.filePath = copy.filePath;
                    saveRow.tracing = body;
                    function finishOut(out) {
                        out.copied = !!(copy.filePath && !copy.reusedUrl);
                        out.reusedUrl = !!copy.reusedUrl;
                        if (study && study.id) {
                            out.cephXrayId = study.id;
                            out.xrayId = study.id;
                            out.fileUrl = study.file_url || saveRow.file_url;
                            out.filePath = study.file_path || saveRow.file_path;
                        }
                        if (out.ok && out.cephXrayId) out.cloud = true;
                        if (out.cephXrayId && String(out.cephXrayId) !== String(srcId)) {
                            xrayCephStampFilm(out.cephXrayId, body);
                        }
                        if (out.cephXrayId && typeof xrayNotify === 'function') {
                            try {
                                xrayNotify((typeof t === 'function') ? t('xc.stripAdded') : 'Banana Ceph study added to the film strip');
                            } catch (eN) { /* ignore */ }
                        }
                        return xrayCephRefreshStrip(study || out.cephXrayId, target).then(function () { return out; });
                    }
                    function afterSave(saved, again) {
                        var out = (again && again.ok) ? again : { ok: true, cloud: !!(base && base.cloud), xrayId: srcId };
                        if (base && base.error === 'col' && again && !again.ok) out.needSql = true;
                        if (saved && saved.id) out.cephSaveId = saved.id;
                        return finishOut(out);
                    }
                    return xrayCephUpsertSave(saveRow).then(function (saved) {
                        if (saved && saved.id) {
                            saved.cephXrayId = (study && study.id) || '';
                            xrayCephAttachSave(body, saved);
                        }
                        if (srcId) xrayCephPatchMem(srcId, body);
                        if (study && study.id) xrayCephPatchMem(study.id, body);
                        if (srcId) {
                            return xrayCephStampFilm(srcId, body).then(function (again) {
                                return afterSave(saved, again);
                            });
                        }
                        return afterSave(saved, { ok: true, cloud: true, xrayId: (study && study.id) || '' });
                    });
                });
            });
        });
    }).catch(function () {
        return { ok: false, error: 'net', xrayId: srcId };
    });
}

function xrayCephIsCephType(rec) {
    var t = String((rec && rec.xray_type) || '').trim().toLowerCase();
    return t === String(XRAY_CEPH_TYPE).toLowerCase() || t.indexOf('ceph') >= 0;
}

function xrayCephLooksLike(rec) {
    if (!rec) return false;
    if (xrayCephIsCephType(rec)) return true;
    var t = String(rec.xray_type || '').toLowerCase();
    var nm = String(rec.file_name || rec.file_path || '');
    return t.indexOf('lateral') >= 0 || /ceph[-_]/.test(String(rec.file_path || '')) || /lateral|ceph/i.test(nm);
}

function xrayCephFindRec(id) {
    if (id == null || id === '') return null;
    var lists = [];
    if (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) lists.push(xrayAllRecords);
    if (typeof xrayFiltered !== 'undefined' && xrayFiltered) lists.push(xrayFiltered);
    if (typeof xrayLbNavList !== 'undefined' && xrayLbNavList) lists.push(xrayLbNavList);
    var i, j, r;
    for (i = 0; i < lists.length; i++) {
        for (j = 0; j < lists[i].length; j++) {
            r = lists[i][j];
            if (r && String(r.id) === String(id)) return r;
        }
    }
    return null;
}

function xrayCephSelectedPick() {
    var ceph = null;
    if (typeof xraySelectedRecords === 'function') {
        xraySelectedRecords().forEach(function (r) {
            if (!ceph && xrayCephIsCephType(r)) ceph = r;
        });
        return ceph;
    }
    if (typeof xraySelected === 'undefined' || !xraySelected || !xraySelected.size) return null;
    xraySelected.forEach(function (id) {
        if (ceph) return;
        var rec = xrayCephFindRec(id);
        if (rec && xrayCephIsCephType(rec)) ceph = rec;
    });
    return ceph;
}

function xrayCephStripPick() {
    var rec = xrayCephSelectedPick();
    if (!rec && typeof lbCurrentId !== 'undefined' && lbCurrentId) rec = xrayCephFindRec(lbCurrentId);
    if (!rec && typeof xrayPinnedId !== 'undefined' && xrayPinnedId) rec = xrayCephFindRec(xrayPinnedId);
    if (!rec && typeof xrayCurrentIdx === 'number' && typeof xrayFiltered !== 'undefined' &&
            xrayFiltered && xrayFiltered.length && xrayFiltered[xrayCurrentIdx]) {
        rec = xrayFiltered[xrayCurrentIdx];
    }
    return (rec && xrayCephIsCephType(rec)) ? rec : null;
}

function xrayCephSameFilm(tracing, xrayId) {
    if (!tracing || !xrayId) return true;
    var a = tracing.xrayId || '';
    var b = tracing.cephXrayId || '';
    if (!a && !b) return true;
    return String(a) === String(xrayId) || String(b) === String(xrayId);
}

function xrayCephApplyOpenCtx(ctx, tracing) {
    if (!ctx || !xrayCephIsTrace(tracing)) return ctx;
    if (ctx.viaStrip && ctx.xrayId && (tracing.xrayId || tracing.cephXrayId) && !xrayCephSameFilm(tracing, ctx.xrayId)) return ctx;
    ctx.tracing = tracing;
    ctx.tracingVia = 'cloud';
    if (tracing.cephSaveId) ctx.cephSaveId = tracing.cephSaveId;
    if (tracing.cephXrayId) ctx.cephXrayId = tracing.cephXrayId;
    // keep the strip film. A saved fileUrl is a second bitmap and must not replace the pick.
    if (!ctx.viaStrip && tracing.fileUrl && xrayCephSameFilm(tracing, ctx.xrayId)) ctx.studyUrl = tracing.fileUrl;
    return ctx;
}

function xrayCephContext(rec) {
    var p = (typeof xrayPatientData !== 'undefined' && xrayPatientData) || {};
    var recs = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    var picked = false;
    if (rec && !xrayCephIsCephType(rec)) rec = null;
    if (rec && xrayCephIsCephType(rec)) picked = true;
    if (!rec) {
        rec = xrayCephStripPick();
        if (rec) picked = true;
    }
    if (!rec && recs && recs.length) {
        var study = null;
        var anyCeph = null;
        var named = null;
        recs.forEach(function (r) {
            if (!r || !xrayCephLooksLike(r)) return;
            if (!anyCeph) anyCeph = r;
            if (/lateral|ceph/i.test(String(r.file_name || r.file_path || '')) && !named) named = r;
            if (xrayCephIsTrace(r.ceph_tracing)) {
                if (String(r.notes || '') === 'Banana Ceph study') study = r;
                else if (!study) study = r;
            }
        });
        rec = study || named || anyCeph || rec;
    }
    if (rec && !xrayCephLooksLike(rec)) rec = null;
    var url = '';
    var name = '';
    if (rec) {
        url = (typeof xrayDisplayUrl === 'function') ? xrayDisplayUrl(rec) : ((typeof xrayBareUrl === 'function') ? xrayBareUrl(rec) : (rec.file_url || ''));
        name = rec.file_name || rec.file_path || '';
    }
    var tracing = rec && xrayCephIsTrace(rec.ceph_tracing) ? rec.ceph_tracing : null;
    var tracingVia = tracing ? 'cloud' : '';
    if (!tracing && !picked) {
        recs.forEach(function (r) {
            if (tracing || !r || !xrayCephIsTrace(r.ceph_tracing)) return;
            tracing = r.ceph_tracing;
            tracingVia = 'cloud';
        });
    }
    if (!tracing) {
        var local = xrayCephLocalTrace(rec && rec.id, name);
        if (local) { tracing = local; tracingVia = 'local'; }
    }
    if (tracing && picked && rec && rec.id && (tracing.xrayId || tracing.cephXrayId) && !xrayCephSameFilm(tracing, rec.id)) {
        tracing = null;
        tracingVia = '';
    }
    // keep the strip film on a new selection; only an unpicked saved study may use its fileUrl
    if (!picked && tracing && tracing.fileUrl && xrayCephSameFilm(tracing, rec && rec.id)) url = tracing.fileUrl;
    return {
        patientId: (typeof xrayPatientId !== 'undefined' && xrayPatientId) || p.id || '',
        patientNo: p.patient_no || '',
        name: String(p.chinese_name || p.full_name || '').trim(),
        cn: String(p.chinese_name || '').trim(),
        en: String(p.full_name || '').trim(),
        sex: String(p.sex || '').trim(),
        dob: String(p.dob || '').trim(),
        hkid: String(p.hkid || '').trim(),
        phone: String(p.phone_number || p.phone || '').trim(),
        mobile: String(p.mobile_phone || '').trim(),
        email: String(p.email || '').trim(),
        taken: rec && (rec.taken_date || rec.created_at) ? String(rec.taken_date || rec.created_at) : '',
        studyUrl: url,
        fileUrl: url,
        filePath: rec && rec.file_path ? rec.file_path : '',
        fileName: name,
        xrayId: rec && rec.id ? rec.id : '',
        xrayType: rec && rec.xray_type ? rec.xray_type : '',
        viaStrip: !!picked,
        cephSaveId: tracing && tracing.cephSaveId ? tracing.cephSaveId : '',
        cephXrayId: tracing && tracing.cephXrayId ? tracing.cephXrayId : ((rec && String(rec.notes || '') === 'Banana Ceph study') ? rec.id : ''),
        tracing: tracing,
        tracingVia: tracingVia,
        otherTraces: (function () {
            var out = [];
            recs.forEach(function (r) {
                if (!r || !xrayCephIsTrace(r.ceph_tracing)) return;
                if (rec && String(r.id) === String(rec.id)) return;
                var t = String(r.xray_type || '').toLowerCase();
                if (t.indexOf('ceph') < 0 && t.indexOf('lateral') < 0) return;
                out.push({
                    xrayId: r.id,
                    fileName: r.file_name || r.file_path || '',
                    taken: r.taken_date || r.created_at || '',
                    tracing: r.ceph_tracing
                });
            });
            return out;
        })(),
        build: (typeof window !== 'undefined' && window.__JSM_BUILD) || ''
    };
}

function xrayCephViewerOpen(rec) {
    if (typeof xrayPatientId === 'undefined' || !xrayPatientId) {
        if (typeof xrayNotify === 'function') xrayNotify((typeof t === 'function') ? t('xc.needPatient') : 'Select a patient');
        else if (typeof showAppGlobalToast === 'function') showAppGlobalToast((typeof t === 'function') ? t('xc.needPatient') : 'Select a patient', { kind: 'warn' });
        return;
    }
    if (!rec && typeof xraySelected !== 'undefined' && xraySelected && xraySelected.size) {
        rec = xrayCephSelectedPick();
        if (!rec) {
            var msg = (typeof t === 'function') ? t('xc.needCephFilm') : 'Tick a Cephalometric film on the X-ray strip';
            if (typeof xrayNotify === 'function') xrayNotify(msg);
            else if (typeof showAppGlobalToast === 'function') showAppGlobalToast(msg, { kind: 'warn' });
            return;
        }
    }
    var ctx = xrayCephContext(rec);
    try { sessionStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e) { /* ignore */ }
    try { localStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e2) { /* ignore */ }
    var bust = encodeURIComponent(ctx.build || String(Date.now()));
    var page = 'ceph/index.html?v=' + bust + '&x=' + encodeURIComponent(ctx.xrayId || '') + '&_t=' + Date.now();
    var title = 'Banana Ceph';
    if (ctx.patientNo) title += ' · #' + ctx.patientNo;
    if (ctx.name) title += ' · ' + ctx.name;
    var w = window.open(page, 'banana-ceph', 'width=1440,height=920');
    if (w) {
        try { w.document.title = title; } catch (e2) { /* ignore until load */ }
    }
    if (typeof xrayAiProtocolWake === 'function') xrayAiProtocolWake();
    function publishOpen(t, save) {
        if (save && save.file_url && !ctx.viaStrip) ctx.studyUrl = save.file_url;
        if (save && save.source_xray_id && !ctx.xrayId) ctx.xrayId = save.source_xray_id;
        if (xrayCephIsTrace(t)) xrayCephApplyOpenCtx(ctx, t);
        try { sessionStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e3) { /* ignore */ }
        try { localStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e4) { /* ignore */ }
        try {
            var ch = new BroadcastChannel(XRAY_CEPH_CH);
            ch.postMessage({ type: 'banana.ceph.open', ctx: ctx });
            setTimeout(function () { try { ch.close(); } catch (e5) { /* ignore */ } }, 800);
        } catch (e6) { /* ignore */ }
    }
    var boot = ctx.xrayId ? xrayCephFetchTracing(ctx.xrayId) : Promise.resolve(null);
    boot.then(function (t) {
        if (xrayCephIsTrace(t)) {
            publishOpen(t);
            return;
        }
        if (ctx.viaStrip) {
            publishOpen(null);
            return;
        }
        if (!ctx.patientId) return;
        return xrayCephFetchLatestForPatient(ctx.patientId).then(function (save) {
            if (save && xrayCephIsTrace(save.tracing)) publishOpen(save.tracing, save);
            else publishOpen(null);
        });
    });
}

function xrayCephReplySave(d, result) {
    if (!d || !d.reqId) return;
    try {
        var ch = new BroadcastChannel(XRAY_CEPH_CH);
        ch.postMessage({ type: 'banana.ceph.saveTrace.done', reqId: d.reqId, result: result || { ok: false } });
        setTimeout(function () { try { ch.close(); } catch (eC) { /* ignore */ } }, 400);
    } catch (e) { /* ignore */ }
}

function xrayCephBindBus() {
    if (typeof window === 'undefined' || window.__bananaCephBus) return;
    if (typeof window.addEventListener !== 'function') return;
    window.__bananaCephBus = true;
    window.addEventListener('message', function (ev) {
        var d = ev && ev.data;
        if (!d || (d.type !== 'banana.ceph.saveTrace' && d.type !== 'banana.ceph.publishSource')) return;
        if (ev.origin && ev.origin !== window.location.origin) return;
        var run = d.type === 'banana.ceph.publishSource'
            ? xrayCephPublishSource(null, d.opt || {})
            : xrayCephSaveTracing(d.xrayId, d.tracing, d.opt || {});
        Promise.resolve(run).then(function (r) {
            xrayCephReplySave(d, r);
        }, function () { xrayCephReplySave(d, { ok: false, error: 'opener' }); });
    });
    try {
        var ch = new BroadcastChannel(XRAY_CEPH_CH);
        ch.onmessage = function (ev) {
            var d = ev && ev.data;
            if (!d || (d.type !== 'banana.ceph.saveTrace' && d.type !== 'banana.ceph.publishSource')) return;
            var runCh = d.type === 'banana.ceph.publishSource'
                ? xrayCephPublishSource(null, d.opt || {})
                : xrayCephSaveTracing(d.xrayId, d.tracing, d.opt || {});
            Promise.resolve(runCh).then(function (r) {
                xrayCephReplySave(d, r);
            }, function () { xrayCephReplySave(d, { ok: false, error: 'opener' }); });
        };
    } catch (e) { /* ignore */ }
}
xrayCephBindBus();

window.xrayCephViewerOpen = xrayCephViewerOpen;
window.xrayCephContext = xrayCephContext;
window.xrayCephIsCephType = xrayCephIsCephType;
window.xrayCephStripPick = xrayCephStripPick;
window.xrayCephSelectedPick = xrayCephSelectedPick;
window.xrayCephSaveTracing = xrayCephSaveTracing;
window.xrayCephPublishSource = xrayCephPublishSource;
window.xrayCephFetchTracing = xrayCephFetchTracing;
window.xrayCephFetchSave = xrayCephFetchSave;
window.xrayCephFetchLatestForPatient = xrayCephFetchLatestForPatient;
window.xrayCephLocalTrace = xrayCephLocalTrace;
window.xrayCephIsTrace = xrayCephIsTrace;
