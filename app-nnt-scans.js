// app-nnt-scans.js — consultation-room NNT / NEWTOM 2D SCAN strip
//
// The local X-Ray launcher (127.0.0.1:17890) lists JPEG/PNG files from
// \\RECEPTION\IMAGE\SCAN\{nnt_patid}. This module shows them in the X-ray tab
// without uploading anything to Supabase. CBCT / .pan_* studies still open
// in NNT.exe via the existing NNT / NEWTOM button.

var nntScanLoadGen = 0;

function nntScanTr(key, fallback, vars) {
    var s = '';
    if (vars && typeof mediaTrRepl === 'function') {
        s = mediaTrRepl(key, vars);
        if (s && s !== key) return s;
    }
    if (typeof mediaTr === 'function') {
        s = mediaTr(key);
        if (s && s !== key) {
            if (vars) {
                Object.keys(vars).forEach(function(k) {
                    s = String(s).split('{' + k + '}').join(String(vars[k]));
                });
            }
            return s;
        }
    }
    s = fallback || key;
    if (vars) {
        Object.keys(vars).forEach(function(k) {
            s = String(s).split('{' + k + '}').join(String(vars[k]));
        });
    }
    return s;
}

function ensureNntScanStyles() {
    if (g('nntScanStripStyle')) return;
    var css = document.createElement('style');
    css.id = 'nntScanStripStyle';
    css.textContent =
        '.nnt-scan-strip{margin:10px 0 12px;padding:12px 14px;background:#f0fdfa;' +
        'border:1px solid #99f6e4;border-radius:10px}' +
        '.nnt-scan-strip-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}' +
        '.nnt-scan-strip-head strong{color:#0f766e;font-size:13px}' +
        '.nnt-scan-count{font-size:12px;color:#0f766e;font-weight:700}' +
        '.nnt-scan-hint{margin:4px 0 8px;font-size:12px;color:#64748b}' +
        '.nnt-scan-thumbs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}' +
        '.nnt-scan-thumb{flex:0 0 auto;width:112px;border:1px solid #99f6e4;border-radius:8px;' +
        'background:#fff;cursor:pointer;padding:0;overflow:hidden}' +
        '.nnt-scan-thumb:hover{border-color:#0f766e}' +
        '.nnt-scan-thumb img{display:block;width:112px;height:84px;object-fit:cover;background:#ecfdf5}' +
        '.nnt-scan-thumb span{display:block;padding:4px 6px 6px;font-size:10px;color:#334155;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.nnt-scan-lightbox{position:fixed;inset:0;z-index:12000;background:rgba(15,23,42,.78);' +
        'display:flex;align-items:center;justify-content:center;padding:24px}' +
        '.nnt-scan-lightbox img{max-width:min(92vw,1100px);max-height:88vh;object-fit:contain;' +
        'border-radius:8px;background:#000}';
    document.head.appendChild(css);
}

function ensureNntScanStrip() {
    ensureNntScanStyles();
    var existing = g('nntLocalScanStrip');
    if (existing) return existing;
    var strip = document.createElement('div');
    strip.id = 'nntLocalScanStrip';
    strip.className = 'nnt-scan-strip';
    strip.style.display = 'none';
    strip.innerHTML =
        '<div class="nnt-scan-strip-head">' +
        '<strong>' + esc(nntScanTr('media.local.nntScansTitle', 'NNT / NEWTOM 2D scans on this PC')) + '</strong>' +
        '<span id="nntLocalScanCount" class="nnt-scan-count"></span></div>' +
        '<p class="nnt-scan-hint">' + esc(nntScanTr(
            'media.local.nntScansHint',
            'Fetched from the NNT SCAN folder for this patient. Not uploaded to Banana. Click a thumbnail to enlarge; use the NNT / NEWTOM button for CBCT.'
        )) + '</p>' +
        '<div id="nntLocalScanThumbs" class="nnt-scan-thumbs"></div>';
    var systemsBar = document.querySelector('#con-xrays .xray-systems-bar');
    if (systemsBar && systemsBar.parentNode) {
        systemsBar.parentNode.insertBefore(strip, systemsBar.nextSibling);
    } else {
        var main = g('xrayMainContent');
        if (main) main.insertBefore(strip, main.firstChild);
        else document.body.appendChild(strip);
    }
    return strip;
}

function hideNntLocalScans() {
    var strip = g('nntLocalScanStrip');
    var thumbs = g('nntLocalScanThumbs');
    if (strip) strip.style.display = 'none';
    if (thumbs) thumbs.innerHTML = '';
}

function nntScanFileUrl(patientNo, name) {
    var base = (typeof XRAY_LAUNCHER_BASE === 'string' && XRAY_LAUNCHER_BASE)
        ? XRAY_LAUNCHER_BASE
        : 'http://127.0.0.1:17890';
    return base + '/nnt/file?patient_no=' + encodeURIComponent(patientNo) +
        '&name=' + encodeURIComponent(name);
}

function openNntScanLightbox(url, title) {
    closeNntScanLightbox();
    var box = document.createElement('div');
    box.id = 'nntScanLightbox';
    box.className = 'nnt-scan-lightbox';
    box.setAttribute('role', 'dialog');
    box.innerHTML = '<img alt="' + esc(title || 'NNT scan') + '" src="' + esc(url) + '">';
    box.addEventListener('click', closeNntScanLightbox);
    document.body.appendChild(box);
}

function closeNntScanLightbox() {
    var box = g('nntScanLightbox');
    if (box && box.parentNode) box.parentNode.removeChild(box);
}

function renderNntLocalScans(patientNo, files) {
    var strip = ensureNntScanStrip();
    var thumbs = g('nntLocalScanThumbs');
    var countEl = g('nntLocalScanCount');
    if (!strip || !thumbs) return;
    thumbs.innerHTML = '';
    if (!files || !files.length) {
        strip.style.display = 'none';
        return;
    }
    strip.style.display = '';
    if (countEl) {
        countEl.textContent = nntScanTr('media.local.nntScansCount', '{N} image(s)', {
            N: String(files.length)
        });
    }
    files.forEach(function(file) {
        var name = file && file.name ? String(file.name) : '';
        if (!name) return;
        var url = nntScanFileUrl(patientNo, name);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nnt-scan-thumb';
        btn.title = name;
        btn.innerHTML = '<img alt="" src="' + esc(url) + '"><span>' + esc(name) + '</span>';
        btn.addEventListener('click', function() {
            openNntScanLightbox(url, name);
        });
        thumbs.appendChild(btn);
    });
}

function loadNntLocalScans() {
    var patient = (typeof xrayPatientData !== 'undefined') ? xrayPatientData : null;
    var no = patient && String(patient.patient_no || '').trim();
    if (!no || (typeof xrayLauncherBlockedByPage === 'function' && xrayLauncherBlockedByPage())) {
        hideNntLocalScans();
        return;
    }
    var gen = ++nntScanLoadGen;
    var base = (typeof XRAY_LAUNCHER_BASE === 'string' && XRAY_LAUNCHER_BASE)
        ? XRAY_LAUNCHER_BASE
        : 'http://127.0.0.1:17890';
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function() {
        if (ctrl) ctrl.abort();
        if (gen === nntScanLoadGen) hideNntLocalScans();
    }, 2500);
    fetch(base + '/nnt/scans?patient_no=' + encodeURIComponent(no), {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
    }).then(function(r) {
        if (!r.ok) throw new Error('nnt scans ' + r.status);
        return r.json();
    }).then(function(body) {
        if (gen !== nntScanLoadGen) return;
        clearTimeout(timer);
        var files = (body && body.ok && body.files) ? body.files : [];
        renderNntLocalScans(no, files);
    }).catch(function() {
        if (gen !== nntScanLoadGen) return;
        clearTimeout(timer);
        hideNntLocalScans();
    });
}

function wrapNntScanPatientHooks() {
    if (typeof syncXrayPatient === 'function' && !syncXrayPatient._nntScanWrapped) {
        var origSync = syncXrayPatient;
        syncXrayPatient = function(patientId, patientData) {
            origSync(patientId, patientData);
            loadNntLocalScans();
        };
        syncXrayPatient._nntScanWrapped = true;
    }
    if (typeof selectXrayPatient === 'function' && !selectXrayPatient._nntScanWrapped) {
        var origSelect = selectXrayPatient;
        selectXrayPatient = function(p) {
            origSelect(p);
            loadNntLocalScans();
        };
        selectXrayPatient._nntScanWrapped = true;
    }
    if (typeof refreshXrays === 'function' && !refreshXrays._nntScanWrapped) {
        var origRefresh = refreshXrays;
        refreshXrays = function() {
            origRefresh();
            loadNntLocalScans();
        };
        refreshXrays._nntScanWrapped = true;
    }
    if (typeof tryLaunchDesktopAppViaLocalBridge === 'function' &&
        !tryLaunchDesktopAppViaLocalBridge._nntScanWrapped) {
        var origLaunch = tryLaunchDesktopAppViaLocalBridge;
        tryLaunchDesktopAppViaLocalBridge = function(launcherKey, patient, opts, cb) {
            origLaunch(launcherKey, patient, opts, function(attached, body) {
                if (launcherKey === 'nntnewtom') loadNntLocalScans();
                if (typeof cb === 'function') cb(attached, body);
            });
        };
        tryLaunchDesktopAppViaLocalBridge._nntScanWrapped = true;
    }
}

document.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape') closeNntScanLightbox();
});

wrapNntScanPatientHooks();

document.addEventListener('DOMContentLoaded', function() {
    wrapNntScanPatientHooks();
    ensureNntScanStrip();
    loadNntLocalScans();
});
