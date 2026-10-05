/* =========================================================
   app-xray-ceph.js - open the lateral cephalometric sidecar.
   Same wiring as CBCT / OHIF: new window + X-ray Helper save-back.
   Save tracing copies the film into the xrays bucket, creates a
   ceph_saves ID, and wires that ID to the tracing so the same
   study reopens with those landmarks on any clinic PC.
   ========================================================= */

(function () {
    var MORE = {
        'xc.open': { en: 'Banana Ceph analysis', 'zh-CN': '香蕉头影测量', 'zh-Hant': '香蕉頭影測量' },
        'xc.openTitle': { en: 'Open the lateral cephalometric sidecar. A saved tracing on this film is restored as the default landmarks. Choose Published 1502 or Published + in-house training, auto-detect three 19-point sets, view them, Adopt selection, and add the whole set to clinic training. Compare Steiner / Downs / Tweed / Wits / McNamara to Caucasian or HK Chinese norms. An extraction index is ceph-only guidance (crowding not assessed), not a treatment plan. Export JSON, CSV or a marked PNG. Share that window in X-ray Helper to save a view to this patient.', 'zh-CN': '打开侧位头影片侧窗。若此片已保存描记，会作为默认标志点载入。可选只用 1502 份公开描记，或公开库加诊所训练。自动标 3 组 19 点，点看后采用选定组并整组纳入训练库。测量对照白人或香港华人常值。Steiner / Downs / Tweed / Wits / McNamara。拔牙倾向仅供头影参考，不是治疗计划。导出 JSON、CSV 或带点的 PNG。用 X 光助手分享该窗口即可存回当前病人。', 'zh-Hant': '開啟側位頭影片側窗。若此片已儲存描記，會作為預設標誌點載入。可選只用 1502 份公開描記，或公開庫加診所訓練。自動標 3 組 19 點，點看後採用選定組並整組納入訓練庫。測量對照白人或香港華人常值。Steiner / Downs / Tweed / Wits / McNamara。拔牙傾向僅供頭影參考，不是治療計劃。匯出 JSON、CSV 或帶點的 PNG。用 X 光助手分享該視窗即可存回目前病人。' },
        'xc.needPatient': { en: 'Select a patient before opening Banana Ceph analysis.', 'zh-CN': '请先选择病人再打开香蕉头影测量。', 'zh-Hant': '請先選擇病人再開啟香蕉頭影測量。' },
        'xc.traceNeedSql': { en: 'Tracing kept on this computer only. Run xray_ceph.sql in Supabase so a film copy, save ID and tracing are stored with the patient.', 'zh-CN': '描记只留在这台电脑。请在 Supabase 运行 xray_ceph.sql，才会把底片副本、保存 ID 和描记存到该病人。', 'zh-Hant': '描記只留在這台電腦。請在 Supabase 執行 xray_ceph.sql，才會把底片副本、保存 ID 和描記存到該病人。' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_CEPH_KEY = 'banana.ceph.v1';
var XRAY_CEPH_CH = 'banana.ceph.save.v1';
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

function xrayCephUploadCopy(xrayId, blob, opt) {
    opt = opt || {};
    if (!blob || typeof SB === 'undefined' || !SB || !SB.storage || typeof SB.storage.from !== 'function') {
        return Promise.resolve(null);
    }
    var rec = xrayCephSourceRec(xrayId);
    var patientId = opt.patientId || (rec && rec.patient_id) || (typeof xrayPatientId !== 'undefined' ? xrayPatientId : '') || 'unknown';
    var ext = xrayCephExtFromName(opt.fileName || (rec && rec.file_name), blob.type);
    var dest = String(patientId) + '/ceph/' + String(xrayId) + '.' + ext;
    var bucket = xrayCephBucket();
    return Promise.resolve(SB.storage.from(bucket).upload(dest, blob, {
        upsert: true,
        contentType: blob.type || 'image/jpeg'
    })).then(function (r) {
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
    if (save.file_url) tracing.fileUrl = save.file_url;
    if (save.file_path) tracing.filePath = save.file_path;
    return tracing;
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

function xrayCephSaveTracing(xrayId, tracing, opt) {
    opt = opt || {};
    if (!xrayId || !xrayCephIsTrace(tracing)) return Promise.resolve({ ok: false, error: 'payload' });
    var rec = xrayCephSourceRec(xrayId);
    var body = {
        v: 1,
        kind: tracing.kind || 'banana.ceph.savedTrace',
        savedAt: tracing.savedAt || new Date().toISOString(),
        xrayId: xrayId,
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
        cvmVia: tracing.cvmVia || ''
    };
    xrayCephPatchMem(xrayId, body);
    return xrayCephStampFilm(xrayId, body).then(function (base) {
        return xrayCephFetchFilmBlob(xrayId, opt).then(function (blob) {
            var copyP = blob ? xrayCephUploadCopy(xrayId, blob, { patientId: body.patientId, fileName: body.fileName }) : Promise.resolve(null);
            return copyP.then(function (copy) {
                var saveRow = {
                    patient_id: body.patientId || null,
                    source_xray_id: xrayId,
                    file_path: (copy && copy.filePath) || (rec && rec.file_path) || '',
                    file_url: (copy && copy.fileUrl) || (rec && rec.file_url) || '',
                    file_name: (copy && copy.fileName) || body.fileName,
                    tracing: body,
                    updated_at: new Date().toISOString()
                };
                return xrayCephUpsertSave(saveRow).then(function (saved) {
                    if (saved && saved.id) {
                        xrayCephAttachSave(body, saved);
                        xrayCephPatchMem(xrayId, body);
                        return xrayCephStampFilm(xrayId, body).then(function (again) {
                            var out = (again && again.ok) ? again : { ok: true, cloud: !!(base && base.cloud), xrayId: xrayId };
                            if (base && base.error === 'col' && !again.ok) out.needSql = true;
                            out.cephSaveId = saved.id;
                            out.fileUrl = saved.file_url || saveRow.file_url;
                            out.filePath = saved.file_path || saveRow.file_path;
                            out.copied = !!(copy && copy.filePath);
                            if (out.ok) out.cloud = true;
                            return out;
                        });
                    }
                    if (copy && copy.filePath) {
                        body.fileUrl = copy.fileUrl;
                        body.filePath = copy.filePath;
                        xrayCephPatchMem(xrayId, body);
                        base.fileUrl = copy.fileUrl;
                        base.filePath = copy.filePath;
                        base.copied = true;
                        base.needSql = !!(base.error === 'col' || XRAY_CEPH.savesOff);
                    }
                    return base;
                });
            });
        });
    }).catch(function () {
        return { ok: false, error: 'net', xrayId: xrayId };
    });
}

function xrayCephApplyOpenCtx(ctx, tracing) {
    if (!ctx || !xrayCephIsTrace(tracing)) return ctx;
    ctx.tracing = tracing;
    ctx.tracingVia = 'cloud';
    if (tracing.cephSaveId) ctx.cephSaveId = tracing.cephSaveId;
    if (tracing.fileUrl) ctx.studyUrl = tracing.fileUrl;
    return ctx;
}

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
    var tracing = rec && xrayCephIsTrace(rec.ceph_tracing) ? rec.ceph_tracing : null;
    var tracingVia = tracing ? 'cloud' : '';
    if (!tracing) {
        var local = xrayCephLocalTrace(rec && rec.id, name);
        if (local) { tracing = local; tracingVia = 'local'; }
    }
    if (tracing && tracing.fileUrl) url = tracing.fileUrl;
    return {
        patientId: (typeof xrayPatientId !== 'undefined' && xrayPatientId) || p.id || '',
        patientNo: p.patient_no || '',
        name: String(p.chinese_name || p.full_name || '').trim(),
        en: String(p.full_name || '').trim(),
        studyUrl: url,
        fileName: name,
        xrayId: rec && rec.id ? rec.id : '',
        cephSaveId: tracing && tracing.cephSaveId ? tracing.cephSaveId : '',
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
    var ctx = xrayCephContext(rec);
    try { sessionStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e) { /* ignore */ }
    try { localStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e2) { /* ignore */ }
    var bust = encodeURIComponent(ctx.build || String(Date.now()));
    var page = 'ceph/?v=' + bust + '&x=' + encodeURIComponent(ctx.xrayId || '') + '&_t=' + Date.now();
    var title = 'Banana Ceph';
    if (ctx.patientNo) title += ' · #' + ctx.patientNo;
    if (ctx.name) title += ' · ' + ctx.name;
    var w = window.open(page, 'banana-ceph', 'width=1440,height=920');
    if (w) {
        try { w.document.title = title; } catch (e2) { /* ignore until load */ }
    }
    if (typeof xrayHelperLaunch === 'function') xrayHelperLaunch();
    if (ctx.xrayId) {
        xrayCephFetchTracing(ctx.xrayId).then(function (t) {
            if (!xrayCephIsTrace(t)) return;
            xrayCephApplyOpenCtx(ctx, t);
            try { sessionStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e3) { /* ignore */ }
            try { localStorage.setItem(XRAY_CEPH_KEY, JSON.stringify(ctx)); } catch (e4) { /* ignore */ }
            try {
                var ch = new BroadcastChannel(XRAY_CEPH_CH);
                ch.postMessage({ type: 'banana.ceph.open', ctx: ctx });
                setTimeout(function () { try { ch.close(); } catch (e5) { /* ignore */ } }, 800);
            } catch (e6) { /* ignore */ }
        });
    }
}

function xrayCephBindBus() {
    if (typeof window === 'undefined' || window.__bananaCephBus) return;
    if (typeof window.addEventListener !== 'function') return;
    window.__bananaCephBus = true;
    window.addEventListener('message', function (ev) {
        var d = ev && ev.data;
        if (!d || d.type !== 'banana.ceph.saveTrace') return;
        if (ev.origin && ev.origin !== window.location.origin) return;
        xrayCephSaveTracing(d.xrayId, d.tracing, d.opt || {});
    });
    try {
        var ch = new BroadcastChannel(XRAY_CEPH_CH);
        ch.onmessage = function (ev) {
            var d = ev && ev.data;
            if (!d || d.type !== 'banana.ceph.saveTrace') return;
            xrayCephSaveTracing(d.xrayId, d.tracing, d.opt || {});
        };
    } catch (e) { /* ignore */ }
}
xrayCephBindBus();

window.xrayCephViewerOpen = xrayCephViewerOpen;
window.xrayCephContext = xrayCephContext;
window.xrayCephSaveTracing = xrayCephSaveTracing;
window.xrayCephFetchTracing = xrayCephFetchTracing;
window.xrayCephFetchSave = xrayCephFetchSave;
window.xrayCephLocalTrace = xrayCephLocalTrace;
window.xrayCephIsTrace = xrayCephIsTrace;
