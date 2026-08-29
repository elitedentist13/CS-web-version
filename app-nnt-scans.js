// app-nnt-scans.js — consultation-room NNT / NEWTOM 2D SCAN strip
//
// The local X-Ray launcher (127.0.0.1:17890) lists JPEG/PNG files from
// \\RECEPTION*\IMAGE\SCAN\{clinic_no_numbers_only} (auto-detected per clinic).
// Banana chart prefixes (MK/TKO/PL) are stripped before matching CS folders.
// Nothing is uploaded to Supabase. CBCT / .pan_* studies still open in NNT.exe.

var nntScanLoadGen = 0;
var nntScanImportBusy = false;

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
        '.nnt-scan-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 8px}' +
        '.nnt-scan-actions button{padding:6px 12px;font-size:12px;font-weight:800;' +
        'border:none;border-radius:8px;background:#0f766e;color:#fff;cursor:pointer}' +
        '.nnt-scan-actions button:disabled{opacity:.55;cursor:wait}' +
        '.nnt-scan-thumbs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}' +
        '.nnt-scan-item{flex:0 0 auto;width:112px;position:relative}' +
        '.nnt-scan-chk{position:absolute;top:4px;left:4px;z-index:2;width:16px;height:16px;' +
        'margin:0;accent-color:#0f766e;cursor:pointer}' +
        '.nnt-scan-thumb{display:block;width:112px;border:1px solid #99f6e4;border-radius:8px;' +
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

function nntScanClinicLabel() {
    if (typeof currentClinicLabel === 'string' && currentClinicLabel.trim()) {
        return currentClinicLabel.trim();
    }
    if (typeof clinicRecordFromId === 'function' && typeof clinicDisplayName === 'function' &&
        typeof currentClinicId !== 'undefined' && currentClinicId) {
        var rec = clinicRecordFromId(currentClinicId);
        var name = rec ? clinicDisplayName(rec) : '';
        if (name) return name;
    }
    return '';
}

function nntScanStripTitle() {
    var clinic = nntScanClinicLabel() || 'clinic';
    return nntScanTr('media.local.nntScansTitle', 'CS scan photos / xrays / doc in {CLINIC}', {
        CLINIC: clinic,
        clinic: clinic
    });
}

function refreshNntScanStripTitle() {
    var el = g('nntLocalScanTitle');
    if (el) el.textContent = nntScanStripTitle();
    var btn = g('nntScanAddToBananaBtn');
    if (btn) btn.textContent = nntScanTr('media.local.nntScansAddToBanana', 'Add to Banana xray tab');
    var hint = document.querySelector('#nntLocalScanStrip .nnt-scan-hint');
    if (hint) {
        hint.textContent = nntScanTr(
            'media.local.nntScansHint',
            'Fetched from this patient\'s Clinic Solution SCAN folder. Not uploaded to Banana. Click a thumbnail to enlarge.'
        );
    }
}

function ensureNntScanStrip() {
    ensureNntScanStyles();
    var existing = g('nntLocalScanStrip');
    if (existing) {
        refreshNntScanStripTitle();
        bindNntScanAddButton();
        return existing;
    }
    var strip = document.createElement('div');
    strip.id = 'nntLocalScanStrip';
    strip.className = 'nnt-scan-strip';
    strip.style.display = 'none';
    strip.innerHTML =
        '<div class="nnt-scan-strip-head">' +
        '<strong id="nntLocalScanTitle">' + esc(nntScanStripTitle()) + '</strong>' +
        '<span id="nntLocalScanCount" class="nnt-scan-count"></span></div>' +
        '<p class="nnt-scan-hint">' + esc(nntScanTr(
            'media.local.nntScansHint',
            'Fetched from this patient\'s Clinic Solution SCAN folder. Not uploaded to Banana. Click a thumbnail to enlarge.'
        )) + '</p>' +
        '<div class="nnt-scan-actions">' +
        '<button type="button" id="nntScanAddToBananaBtn">' +
        esc(nntScanTr('media.local.nntScansAddToBanana', 'Add to Banana xray tab')) +
        '</button></div>' +
        '<div id="nntLocalScanThumbs" class="nnt-scan-thumbs"></div>';
    var systemsBar = document.querySelector('#con-xrays .xray-systems-bar');
    if (systemsBar && systemsBar.parentNode) {
        systemsBar.parentNode.insertBefore(strip, systemsBar.nextSibling);
    } else {
        var main = g('xrayMainContent');
        if (main) main.insertBefore(strip, main.firstChild);
        else document.body.appendChild(strip);
    }
    bindNntScanAddButton();
    return strip;
}

function bindNntScanAddButton() {
    var btn = g('nntScanAddToBananaBtn');
    if (!btn || btn._nntBound) return;
    btn._nntBound = true;
    btn.addEventListener('click', addSelectedNntScansToBanana);
}

function hideNntLocalScans() {
    var strip = g('nntLocalScanStrip');
    var thumbs = g('nntLocalScanThumbs');
    if (strip) strip.style.display = 'none';
    if (thumbs) thumbs.innerHTML = '';
}

function rememberDetectedCsScanRoot(body) {
    if (!body || typeof window === 'undefined') return;
    var root = '';
    if (body.scan_root) root = String(body.scan_root);
    else if (body.scan_roots && body.scan_roots.length) root = String(body.scan_roots[0]);
    if (root) window.__JSM_CS_SCAN_ROOT = root;
}

function nntScanChartNo(patient) {
    var raw = patient && String(patient.patient_no || '').trim();
    if (!raw) return '';
    if (typeof clinicNoNumbersOnly === 'function') {
        return clinicNoNumbersOnly(raw) || raw;
    }
    var m = raw.match(/\d+/);
    return m ? m[0] : raw;
}

function nntScanIdCandidates(patient) {
    var raw = patient && String(patient.patient_no || '').trim();
    var digits = nntScanChartNo(patient);
    var out = [];
    if (digits) out.push(digits);
    if (raw && out.indexOf(raw) < 0) out.push(raw);
    return out;
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
    refreshNntScanStripTitle();
    if (countEl) {
        countEl.textContent = nntScanTr('media.local.nntScansCount', '{N} image(s)', {
            N: String(files.length)
        });
    }
    files.forEach(function(file) {
        var name = file && file.name ? String(file.name) : '';
        if (!name) return;
        var url = nntScanFileUrl(patientNo, name);
        var taken = file.taken ? String(file.taken) : '';
        var item = document.createElement('div');
        item.className = 'nnt-scan-item';
        var chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'nnt-scan-chk';
        chk.setAttribute('data-nnt-scan-name', name);
        chk.setAttribute('data-nnt-scan-taken', taken);
        chk.title = name;
        chk.addEventListener('click', function(ev) { ev.stopPropagation(); });
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nnt-scan-thumb';
        btn.title = name;
        btn.innerHTML = '<img alt="" src="' + esc(url) + '"><span>' + esc(name) + '</span>';
        btn.addEventListener('click', function() {
            openNntScanLightbox(url, name);
        });
        item.appendChild(chk);
        item.appendChild(btn);
        thumbs.appendChild(item);
    });
    bindNntScanAddButton();
}

function nntScanDateFromMeta(name, taken) {
    if (taken) return String(taken).slice(0, 10);
    var m = String(name || '').match(/_(\d{4})(\d{2})(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return (typeof todayISO === 'function') ? todayISO() : '';
}

function nntScanFetchOpts() {
    var opts = { method: 'GET', mode: 'cors', cache: 'no-store' };
    if (typeof XRAY_LAUNCHER_FETCH_OPTS === 'object' && XRAY_LAUNCHER_FETCH_OPTS) {
        Object.keys(XRAY_LAUNCHER_FETCH_OPTS).forEach(function(k) {
            opts[k] = XRAY_LAUNCHER_FETCH_OPTS[k];
        });
    }
    return opts;
}

function nntScanSelectedChecks() {
    return Array.prototype.slice.call(
        document.querySelectorAll('#nntLocalScanThumbs .nnt-scan-chk:checked')
    );
}

function addSelectedNntScansToBanana() {
    if (nntScanImportBusy) return;
    if (typeof xrayPatientId === 'undefined' || !xrayPatientId) {
        alert(nntScanTr('media.local.nntScansNeedPatient', 'Open a patient in the X-ray tab first.'));
        return;
    }
    if (typeof uploadSingleXrayFile !== 'function') {
        alert(nntScanTr('media.local.nntScansImportFail', 'Could not read {FILE} from the Clinic Solution SCAN folder.', { FILE: '' }));
        return;
    }
    var patient = (typeof xrayPatientData !== 'undefined') ? xrayPatientData : null;
    var patientNo = nntScanChartNo(patient);
    if (!patientNo) {
        alert(nntScanTr('media.local.nntScansNeedPatient', 'Open a patient in the X-ray tab first.'));
        return;
    }
    var checks = nntScanSelectedChecks();
    if (!checks.length) {
        alert(nntScanTr('media.local.nntScansSelectFirst', 'Select at least one thumbnail first.'));
        return;
    }
    var msg = nntScanTr('media.local.nntScansConfirmAdd',
        'Copy {N} selected file(s) from Clinic Solution SCAN into this patient\'s Banana X-ray tab?',
        { N: String(checks.length) });
    if (!confirm(msg)) return;

    var items = checks.map(function(chk) {
        return {
            name: chk.getAttribute('data-nnt-scan-name') || '',
            taken: chk.getAttribute('data-nnt-scan-taken') || ''
        };
    }).filter(function(it) { return !!it.name; });

    nntScanImportBusy = true;
    var btn = g('nntScanAddToBananaBtn');
    if (btn) btn.disabled = true;
    uploadNntScanItemAt(items, 0, patientNo);
}

function uploadNntScanItemAt(items, idx, patientNo) {
    if (idx >= items.length) {
        nntScanImportBusy = false;
        var btn = g('nntScanAddToBananaBtn');
        if (btn) btn.disabled = false;
        if (typeof showUploadProgress === 'function') showUploadProgress(false);
        if (typeof loadXrayRecords === 'function') loadXrayRecords();
        return;
    }
    var item = items[idx];
    var label = nntScanTr('media.local.nntScansImporting', 'Adding {N} of {TOTAL} to Banana…', {
        N: String(idx + 1),
        TOTAL: String(items.length)
    });
    if (typeof showUploadProgress === 'function') {
        showUploadProgress(true, label, Math.round((idx / items.length) * 100));
    }
    var url = nntScanFileUrl(patientNo, item.name);
    fetch(url, nntScanFetchOpts())
        .then(function(r) {
            if (!r.ok) throw new Error('nnt file ' + r.status);
            return r.blob().then(function(blob) {
                return { blob: blob, type: r.headers.get('Content-Type') || blob.type };
            });
        })
        .then(function(res) {
            var mime = (res.type || res.blob.type || 'image/jpeg').split(';')[0];
            var file = new File([res.blob], item.name, { type: mime });
            var note = nntScanTr('media.local.nntScansImportNote',
                'Copied from Clinic Solution SCAN: {FILE}', { FILE: item.name });
            var date = nntScanDateFromMeta(item.name, item.taken);
            uploadSingleXrayFile(file, 'Other', date, note, function() {
                uploadNntScanItemAt(items, idx + 1, patientNo);
            });
        })
        .catch(function() {
            nntScanImportBusy = false;
            var btn2 = g('nntScanAddToBananaBtn');
            if (btn2) btn2.disabled = false;
            if (typeof showUploadProgress === 'function') showUploadProgress(false);
            alert(nntScanTr('media.local.nntScansImportFail',
                'Could not read {FILE} from the Clinic Solution SCAN folder.',
                { FILE: item.name }));
        });
}

function loadNntLocalScans() {
    var patient = (typeof xrayPatientData !== 'undefined') ? xrayPatientData : null;
    var ids = nntScanIdCandidates(patient);
    var no = ids.length ? ids[0] : '';
    if (!no || (typeof xrayLauncherBlockedByPage === 'function' && xrayLauncherBlockedByPage())) {
        hideNntLocalScans();
        return;
    }
    var gen = ++nntScanLoadGen;

    function done(chartNo, files, body) {
        if (gen !== nntScanLoadGen) return;
        rememberDetectedCsScanRoot(body);
        renderNntLocalScans(chartNo, files || []);
    }

    function fail() {
        if (gen !== nntScanLoadGen) return;
        hideNntLocalScans();
    }

    var ports = (typeof xrayLauncherPortList === 'function') ? xrayLauncherPortList() : [17891, 17890];
    var hosts = (typeof xrayLauncherHostList === 'function') ? xrayLauncherHostList() : ['127.0.0.1'];
    if (!ports.length) ports = [17890, 17891];
    if (ports.indexOf(17891) < 0) ports = [17891].concat(ports);
    var attempts = [];
    hosts.forEach(function(host) {
        ports.forEach(function(port) {
            ids.forEach(function(id) {
                attempts.push({ host: host, port: port, id: id });
            });
        });
    });

    function tryAt(idx) {
        if (gen !== nntScanLoadGen) return;
        if (idx >= attempts.length) {
            fail();
            return;
        }
        var a = attempts[idx];
        var url = 'http://' + a.host + ':' + a.port +
            '/nnt/scans?patient_no=' + encodeURIComponent(a.id);
        var opts = nntScanFetchOpts();
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (ctrl) opts.signal = ctrl.signal;
        var timer = setTimeout(function() {
            if (ctrl) ctrl.abort();
        }, 7000);
        fetch(url, opts).then(function(r) {
            if (!r.ok) throw new Error('nnt scans ' + r.status);
            return r.json();
        }).then(function(body) {
            clearTimeout(timer);
            if (gen !== nntScanLoadGen) return;
            var files = (body && body.ok && body.files) ? body.files : [];
            if (files.length) {
                if (typeof xraySetActiveLauncherPort === 'function') {
                    xraySetActiveLauncherPort(a.port, a.host);
                }
                done(a.id, files, body);
                return;
            }
            tryAt(idx + 1);
        }).catch(function() {
            clearTimeout(timer);
            tryAt(idx + 1);
        });
    }

    tryAt(0);
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
                if (launcherKey === 'nntnewtom' || launcherKey === 'myray') loadNntLocalScans();
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

document.addEventListener('visibilitychange', function() {
    if (!document.hidden) loadNntLocalScans();
});

document.addEventListener('app-lang-change', refreshNntScanStripTitle);
document.addEventListener('app-session-sync', refreshNntScanStripTitle);
