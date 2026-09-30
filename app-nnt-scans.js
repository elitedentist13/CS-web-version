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

// Local film strips are files on this PC, served by the bridge on :17890.
// The Banana page (127.0.0.1:5500 / :8123) loads them directly. The GitHub
// page does not call 127.0.0.1; its X-ray buttons use csxray:// instead.
function clinicPageIsLocalServer() {
    try {
        var host = String(window.location.hostname || '').toLowerCase();
        return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
    } catch (e) {
        return false;
    }
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
    if (!no || !clinicPageIsLocalServer() || (typeof xrayLauncherBlockedByPage === 'function' && xrayLauncherBlockedByPage())) {
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

var carestreamLoadGen = 0;

function carestreamAsList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function ensureCarestreamStrip() {
    ensureNntScanStyles();
    if (!g('carestreamStripStyle')) {
        var css = document.createElement('style');
        css.id = 'carestreamStripStyle';
        css.textContent =
            '.cs-film-strip{margin:10px 0 12px;padding:12px 14px;background:#f8fafc;' +
            'border:1px solid #cbd5e1;border-radius:10px}' +
            '.cs-film-head strong{color:#0f172a;font-size:13px}' +
            '.cs-film-hint,.cs-film-new{margin:4px 0 8px;font-size:12px;color:#64748b}' +
            '.cs-film-new{color:#9a3412}' +
            '.cs-film-group{margin:8px 0 4px;font-size:12px;font-weight:800;color:#334155}' +
            '.cs-film-empty{font-size:12px;color:#94a3b8;margin:0 0 8px}' +
            '.cs-film-badge{display:block;padding:0 6px 6px;font-size:10px;color:#0369a1;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.cs-film-unfiled{color:#9a3412}';
        document.head.appendChild(css);
    }
    var existing = g('carestreamLocalStrip');
    if (existing) return existing;
    var strip = document.createElement('div');
    strip.id = 'carestreamLocalStrip';
    strip.className = 'cs-film-strip';
    strip.style.display = 'none';
    strip.innerHTML =
        '<div class="cs-film-head"><strong>Carestream films</strong> ' +
        '<span id="carestreamLocalCount" class="nnt-scan-count"></span></div>' +
        '<p class="cs-film-hint">On or before 11 July 2026, and after that date, Banana reads both the chart folder and D:\\CSDB. A case marked "not filed to this chart" is not attached until you add it.</p>' +
        '<p id="carestreamNewPatient" class="cs-film-new" style="display:none">No film is filed to this chart yet. Carestream opens a new file with this patient\'s name, ready for the next x-ray.</p>' +
        '<div class="nnt-scan-actions"><button type="button" id="carestreamAddBtn">Add to Banana xray tab</button></div>' +
        '<div id="carestreamBeforeLabel" class="cs-film-group">On or before 11 July 2026</div>' +
        '<div id="carestreamBeforeEmpty" class="cs-film-empty">None in the chart folder or in D:\\CSDB.</div>' +
        '<div id="carestreamBeforeThumbs" class="nnt-scan-thumbs"></div>' +
        '<div id="carestreamAfterLabel" class="cs-film-group">After 11 July 2026</div>' +
        '<div id="carestreamAfterEmpty" class="cs-film-empty">None in the chart folder or in D:\\CSDB.</div>' +
        '<div id="carestreamAfterThumbs" class="nnt-scan-thumbs"></div>';
    var anchor = g('nntLocalScanStrip');
    if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(strip, anchor.nextSibling);
    } else {
        var systemsBar = document.querySelector('#con-xrays .xray-systems-bar');
        if (systemsBar && systemsBar.parentNode) systemsBar.parentNode.insertBefore(strip, systemsBar.nextSibling);
        else {
            var main = g('xrayMainContent');
            if (main) main.insertBefore(strip, main.firstChild);
            else document.body.appendChild(strip);
        }
    }
    var btn = g('carestreamAddBtn');
    if (btn && !btn._csBound) {
        btn._csBound = true;
        btn.addEventListener('click', addSelectedCarestreamFilesToBanana);
    }
    return strip;
}

function hideCarestreamFilms() {
    var strip = g('carestreamLocalStrip');
    ['carestreamBeforeThumbs', 'carestreamAfterThumbs'].forEach(function(id) {
        var el = g(id);
        if (el) el.innerHTML = '';
    });
    if (strip) strip.style.display = 'none';
}

function carestreamFileUrl(patientNo, file, view) {
    var base = (typeof XRAY_LAUNCHER_BASE === 'string' && XRAY_LAUNCHER_BASE)
        ? XRAY_LAUNCHER_BASE
        : 'http://127.0.0.1:17890';
    if (file && file.store === 'csdb') {
        return base + '/carestream/file?source=csdb&id=' + encodeURIComponent(file.case_id || '') +
            '&name=' + encodeURIComponent(file.name || '') + '&view=' + encodeURIComponent(view || 'full');
    }
    return base + '/carestream/file?source=scan&patient_no=' + encodeURIComponent(patientNo) +
        '&name=' + encodeURIComponent(file && file.name ? file.name : '') +
        '&view=' + encodeURIComponent(view || 'full');
}

function carestreamBadge(file) {
    if (!file || file.store === 'scan') return 'Chart folder';
    if (file.matched) return 'D:\\CSDB';
    return 'D:\\CSDB · not filed to this chart';
}

function renderCarestreamGroup(patientNo, containerId, emptyId, files) {
    var box = g(containerId);
    var empty = g(emptyId);
    if (!box) return;
    box.innerHTML = '';
    if (!files.length) {
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';
    files.forEach(function(file) {
        var name = file && file.name ? String(file.name) : '';
        if (!name) return;
        var full = carestreamFileUrl(patientNo, file, 'full');
        var useThumb = file.store === 'csdb' && file.preview === 'thumb';
        var preview = useThumb ? carestreamFileUrl(patientNo, file, 'thumb') : (file.store === 'scan' ? full : '');
        var taken = file.taken ? String(file.taken).slice(0, 16).replace('T', ' ') : '';
        var badge = carestreamBadge(file);
        var item = document.createElement('div');
        item.className = 'nnt-scan-item';
        var chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'nnt-scan-chk cs-film-chk';
        chk.setAttribute('data-cs-name', name);
        chk.setAttribute('data-cs-taken', file.taken ? String(file.taken) : '');
        chk.setAttribute('data-cs-store', file.store || '');
        chk.setAttribute('data-cs-id', file.case_id || '');
        chk.setAttribute('data-cs-matched', file.matched ? '1' : '0');
        chk.addEventListener('click', function(ev) { ev.stopPropagation(); });
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nnt-scan-thumb';
        btn.title = badge + ' ' + name;
        var imgHtml = preview
            ? '<img alt="" src="' + esc(preview) + '">'
            : '<img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
        btn.innerHTML = imgHtml + '<span>' + esc(taken || name) + '</span>' +
            '<span class="cs-film-badge' + (file.matched ? '' : ' cs-film-unfiled') + '">' + esc(badge) + '</span>';
        btn.addEventListener('click', function() { openNntScanLightbox(full, name); });
        item.appendChild(chk);
        item.appendChild(btn);
        box.appendChild(item);
    });
}

function renderCarestreamFilms(patientNo, body) {
    var strip = ensureCarestreamStrip();
    if (!strip) return;
    var files = carestreamAsList(body && body.files);
    strip.style.display = '';
    var before = files.filter(function(f) { return f && f.side === 'before'; });
    var after = files.filter(function(f) { return f && f.side !== 'before'; });
    function byFilm(a, b) {
        var am = a && a.matched ? 0 : 1;
        var bm = b && b.matched ? 0 : 1;
        if (am !== bm) return am - bm;
        return String(b.taken || '').localeCompare(String(a.taken || ''));
    }
    before.sort(byFilm);
    after.sort(byFilm);
    var countEl = g('carestreamLocalCount');
    if (countEl) countEl.textContent = String(files.length) + ' film(s)';
    var neu = g('carestreamNewPatient');
    if (neu) neu.style.display = (body && body.new_patient) ? '' : 'none';
    renderCarestreamGroup(patientNo, 'carestreamBeforeThumbs', 'carestreamBeforeEmpty', before);
    renderCarestreamGroup(patientNo, 'carestreamAfterThumbs', 'carestreamAfterEmpty', after);
}

function addSelectedCarestreamFilesToBanana() {
    if (nntScanImportBusy) return;
    if (typeof xrayPatientId === 'undefined' || !xrayPatientId) {
        alert('Open a patient in the X-ray tab first.');
        return;
    }
    if (typeof uploadSingleXrayFile !== 'function') return;
    var patient = (typeof xrayPatientData !== 'undefined') ? xrayPatientData : null;
    var patientNo = nntScanChartNo(patient);
    if (!patientNo) {
        alert('Open a patient in the X-ray tab first.');
        return;
    }
    var checks = Array.prototype.slice.call(document.querySelectorAll('#carestreamLocalStrip .cs-film-chk:checked'));
    if (!checks.length) {
        alert('Select at least one film first.');
        return;
    }
    var unfiled = checks.some(function(chk) { return chk.getAttribute('data-cs-matched') !== '1'; });
    var msg = unfiled
        ? 'Add ' + checks.length + ' film(s) to this patient? One or more are not filed to this chart in Carestream.'
        : 'Copy ' + checks.length + ' film(s) into this patient\'s Banana X-ray tab?';
    if (!confirm(msg)) return;
    var items = checks.map(function(chk) {
        return {
            name: chk.getAttribute('data-cs-name') || '',
            taken: chk.getAttribute('data-cs-taken') || '',
            store: chk.getAttribute('data-cs-store') || 'scan',
            case_id: chk.getAttribute('data-cs-id') || ''
        };
    }).filter(function(it) { return !!it.name; });
    nntScanImportBusy = true;
    var btn = g('carestreamAddBtn');
    if (btn) btn.disabled = true;
    uploadCarestreamItemAt(items, 0, patientNo);
}

function uploadCarestreamItemAt(items, idx, patientNo, btnId) {
    var buttonId = btnId || 'carestreamAddBtn';
    if (idx >= items.length) {
        nntScanImportBusy = false;
        var btn = g(buttonId);
        if (btn) btn.disabled = false;
        if (typeof showUploadProgress === 'function') showUploadProgress(false);
        if (typeof loadXrayRecords === 'function') loadXrayRecords();
        return;
    }
    var item = items[idx];
    if (typeof showUploadProgress === 'function') {
        showUploadProgress(true, 'Adding ' + (idx + 1) + ' of ' + items.length + '…',
            Math.round((idx / items.length) * 100));
    }
    var url = carestreamFileUrl(patientNo, item, 'full');
    fetch(url, nntScanFetchOpts())
        .then(function(r) {
            if (!r.ok) throw new Error('carestream file ' + r.status);
            return r.blob().then(function(blob) {
                return { blob: blob, type: r.headers.get('Content-Type') || blob.type };
            });
        })
        .then(function(res) {
            var mime = (res.type || res.blob.type || 'image/jpeg').split(';')[0];
            var ext = mime.indexOf('png') >= 0 ? '.png' : '.jpg';
            var base = String(item.name || 'film').replace(/\.[^.]+$/, '');
            var file = new File([res.blob], base + ext, { type: mime });
            var where = item.store === 'csdb' ? 'D:\\CSDB' : 'the chart folder';
            var note = 'Copied from Carestream (' + where + '): ' + item.name;
            var date = nntScanDateFromMeta(item.name, item.taken);
            uploadSingleXrayFile(file, 'Panoramic', date, note, function() {
                uploadCarestreamItemAt(items, idx + 1, patientNo, buttonId);
            });
        })
        .catch(function() {
            nntScanImportBusy = false;
            var btn2 = g(buttonId);
            if (btn2) btn2.disabled = false;
            if (typeof showUploadProgress === 'function') showUploadProgress(false);
            alert('Could not read ' + item.name + ' from Carestream.');
        });
}

function loadCarestreamFiles() {
    var patient = (typeof xrayPatientData !== 'undefined') ? xrayPatientData : null;
    var ids = nntScanIdCandidates(patient);
    var no = ids.length ? ids[0] : '';
    if (!no || !clinicPageIsLocalServer() || (typeof xrayLauncherBlockedByPage === 'function' && xrayLauncherBlockedByPage())) {
        hideCarestreamFilms();
        return;
    }
    var gen = ++carestreamLoadGen;
    var ports = (typeof xrayLauncherPortList === 'function') ? xrayLauncherPortList() : [17890];
    var hosts = (typeof xrayLauncherHostList === 'function') ? xrayLauncherHostList() : ['127.0.0.1'];
    if (!ports.length) ports = [17890];
    if (ports.indexOf(17890) < 0) ports = [17890].concat(ports);
    var attempts = [];
    hosts.forEach(function(host) {
        ports.forEach(function(port) {
            attempts.push({ host: host, port: port, id: no });
        });
    });
    var name = patient && patient.full_name ? String(patient.full_name) : '';

    function tryAt(idx) {
        if (gen !== carestreamLoadGen) return;
        if (idx >= attempts.length) {
            if (gen === carestreamLoadGen) hideCarestreamFilms();
            return;
        }
        var a = attempts[idx];
        var url = 'http://' + a.host + ':' + a.port + '/carestream/files?patient_no=' +
            encodeURIComponent(a.id) + '&patient_name=' + encodeURIComponent(name);
        var opts = nntScanFetchOpts();
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (ctrl) opts.signal = ctrl.signal;
        var timer = setTimeout(function() { if (ctrl) ctrl.abort(); }, 20000);
        fetch(url, opts).then(function(r) {
            if (!r.ok) throw new Error('carestream files ' + r.status);
            return r.json();
        }).then(function(body) {
            clearTimeout(timer);
            if (gen !== carestreamLoadGen) return;
            if (!body || !body.ok) {
                tryAt(idx + 1);
                return;
            }
            if (typeof xraySetActiveLauncherPort === 'function') xraySetActiveLauncherPort(a.port, a.host);
            renderCarestreamFilms(a.id, body);
        }).catch(function() {
            clearTimeout(timer);
            tryAt(idx + 1);
        });
    }
    tryAt(0);
}

var mcpScanLoadGen = 0;
var mcpScanLightboxFiles = [];
var mcpScanLightboxIndex = 0;
var mcpScanLightboxPatient = '';

function isMcpClinicContext() {
    var parts = [];
    if (typeof currentClinicCodeForTagging === 'function') {
        parts.push(currentClinicCodeForTagging());
    }
    if (typeof currentClinicLabel === 'string') parts.push(currentClinicLabel);
    if (typeof clinicRecordFromId === 'function' && typeof currentClinicId !== 'undefined') {
        var rec = clinicRecordFromId(currentClinicId);
        if (rec) {
            parts.push(rec.clinic_code, rec.english_name, rec.chinese_name, rec.name);
        }
    }
    var blob = parts.filter(Boolean).join(' ');
    return /(^|[^A-Za-z0-9])MCP([^A-Za-z0-9]|$)/i.test(blob);
}

function ensureMcpScanStrip() {
    ensureNntScanStyles();
    if (!g('mcpScanStripStyle')) {
        var css = document.createElement('style');
        css.id = 'mcpScanStripStyle';
        css.textContent =
            '.mcp-scan-strip{margin:10px 0 12px;padding:12px 14px;background:#fffbeb;' +
            'border:1px solid #fcd34d;border-radius:10px}' +
            '.mcp-scan-strip strong{color:#92400e;font-size:13px}' +
            '.mcp-scan-hint{margin:4px 0 8px;font-size:12px;color:#78716c}' +
            '.mcp-scan-empty{font-size:12px;color:#a8a29e;margin:0}' +
            '.mcp-lb{position:fixed;inset:0;z-index:12000;background:rgba(15,23,42,.82);' +
            'display:flex;align-items:center;justify-content:center;padding:24px}' +
            '.mcp-lb-frame{position:relative;max-width:min(92vw,1100px);max-height:88vh}' +
            '.mcp-lb-frame img{display:block;max-width:min(92vw,1100px);max-height:80vh;' +
            'object-fit:contain;border-radius:8px;background:#000}' +
            '.mcp-lb-cap{margin-top:8px;text-align:center;color:#f8fafc;font-size:13px}' +
            '.mcp-lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;' +
            'border:none;border-radius:999px;background:rgba(255,255,255,.92);color:#0f172a;' +
            'font-size:22px;font-weight:800;cursor:pointer}' +
            '.mcp-lb-prev{left:-54px}.mcp-lb-next{right:-54px}' +
            '@media(max-width:720px){.mcp-lb-prev{left:4px}.mcp-lb-next{right:4px}}';
        document.head.appendChild(css);
    }
    var existing = g('mcpScanStrip');
    if (existing) return existing;
    var strip = document.createElement('div');
    strip.id = 'mcpScanStrip';
    strip.className = 'mcp-scan-strip';
    strip.style.display = 'none';
    strip.innerHTML =
        '<div><strong id="mcpScanTitle">MCP older films</strong> ' +
        '<span id="mcpScanCount" class="nnt-scan-count"></span></div>' +
        '<p class="mcp-scan-hint">From \\\\RECEPTION_MCP\\IMAGE\\SCAN\\{chart}. Tick a film to add it to Banana. Click a film to open the slider.</p>' +
        '<div class="nnt-scan-actions"><button type="button" id="mcpScanAddBtn">Add to Banana xray tab</button></div>' +
        '<p id="mcpScanEmpty" class="mcp-scan-empty" style="display:none">No films in this chart folder.</p>' +
        '<div id="mcpScanThumbs" class="nnt-scan-thumbs"></div>';
    var anchor = g('carestreamLocalStrip') || g('nntLocalScanStrip');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(strip, anchor);
    else {
        var systemsBar = document.querySelector('#con-xrays .xray-systems-bar');
        if (systemsBar && systemsBar.parentNode) systemsBar.parentNode.insertBefore(strip, systemsBar.nextSibling);
        else {
            var main = g('xrayMainContent');
            if (main) main.insertBefore(strip, main.firstChild);
        }
    }
    var addBtn = g('mcpScanAddBtn');
    if (addBtn && !addBtn._mcpBound) {
        addBtn._mcpBound = true;
        addBtn.addEventListener('click', addSelectedMcpScanFilms);
    }
    return strip;
}

function hideMcpScanStrip() {
    var strip = g('mcpScanStrip');
    var thumbs = g('mcpScanThumbs');
    if (thumbs) thumbs.innerHTML = '';
    if (strip) strip.style.display = 'none';
    closeMcpScanLightbox();
}

function renderMcpScanStrip(patientNo, files) {
    var strip = ensureMcpScanStrip();
    if (!strip) return;
    var list = carestreamAsList(files).filter(function(f) { return f && f.name; });
    list.sort(function(a, b) { return String(a.taken || '').localeCompare(String(b.taken || '')); });
    mcpScanLightboxFiles = list;
    mcpScanLightboxPatient = patientNo;
    strip.style.display = '';
    var countEl = g('mcpScanCount');
    if (countEl) countEl.textContent = list.length ? (String(list.length) + ' film(s)') : '';
    var empty = g('mcpScanEmpty');
    var thumbs = g('mcpScanThumbs');
    if (!thumbs) return;
    thumbs.innerHTML = '';
    if (!list.length) {
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';
    list.forEach(function(file, index) {
        var url = carestreamFileUrl(patientNo, { store: 'scan', name: file.name }, 'full');
        var taken = file.taken ? String(file.taken).slice(0, 16).replace('T', ' ') : file.name;
        var item = document.createElement('div');
        item.className = 'nnt-scan-item';
        var chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'nnt-scan-chk mcp-film-chk';
        chk.setAttribute('data-mcp-name', file.name);
        chk.setAttribute('data-mcp-taken', file.taken ? String(file.taken) : '');
        chk.title = file.name;
        chk.addEventListener('click', function(ev) { ev.stopPropagation(); });
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nnt-scan-thumb';
        btn.title = file.name;
        btn.innerHTML = '<img alt="" src="' + esc(url) + '"><span>' + esc(taken) + '</span>';
        btn.addEventListener('click', function() { openMcpScanLightbox(index); });
        item.appendChild(chk);
        item.appendChild(btn);
        thumbs.appendChild(item);
    });
}

function addSelectedMcpScanFilms() {
    if (nntScanImportBusy) return;
    if (typeof xrayPatientId === 'undefined' || !xrayPatientId) {
        alert('Open a patient in the X-ray tab first.');
        return;
    }
    if (typeof uploadSingleXrayFile !== 'function') return;
    var patient = (typeof xrayPatientData !== 'undefined') ? xrayPatientData : null;
    var patientNo = nntScanChartNo(patient);
    if (!patientNo) {
        alert('Open a patient in the X-ray tab first.');
        return;
    }
    var checks = Array.prototype.slice.call(document.querySelectorAll('#mcpScanStrip .mcp-film-chk:checked'));
    if (!checks.length) {
        alert('Select at least one film first.');
        return;
    }
    if (!confirm('Copy ' + checks.length + ' film(s) into this patient\'s Banana X-ray tab?')) return;
    var items = checks.map(function(chk) {
        return {
            name: chk.getAttribute('data-mcp-name') || '',
            taken: chk.getAttribute('data-mcp-taken') || '',
            store: 'scan',
            case_id: ''
        };
    }).filter(function(it) { return !!it.name; });
    nntScanImportBusy = true;
    var btn = g('mcpScanAddBtn');
    if (btn) btn.disabled = true;
    uploadCarestreamItemAt(items, 0, patientNo, 'mcpScanAddBtn');
}

function closeMcpScanLightbox() {
    var box = g('mcpScanLightbox');
    if (box && box.parentNode) box.parentNode.removeChild(box);
}

function showMcpScanLightboxFrame() {
    var box = g('mcpScanLightbox');
    var file = mcpScanLightboxFiles[mcpScanLightboxIndex];
    if (!box || !file) return;
    var img = box.querySelector('img');
    var cap = box.querySelector('.mcp-lb-cap');
    var url = carestreamFileUrl(mcpScanLightboxPatient, { store: 'scan', name: file.name }, 'full');
    if (img) {
        img.src = url;
        img.alt = file.name;
    }
    if (cap) {
        var taken = file.taken ? String(file.taken).slice(0, 16).replace('T', ' ') : '';
        cap.textContent = (mcpScanLightboxIndex + 1) + ' / ' + mcpScanLightboxFiles.length +
            (taken ? ' · ' + taken : '') + ' · ' + file.name;
    }
}

function openMcpScanLightbox(index) {
    if (!mcpScanLightboxFiles.length) return;
    mcpScanLightboxIndex = index;
    closeMcpScanLightbox();
    var box = document.createElement('div');
    box.id = 'mcpScanLightbox';
    box.className = 'mcp-lb';
    box.setAttribute('role', 'dialog');
    box.innerHTML =
        '<div class="mcp-lb-frame">' +
        '<button type="button" class="mcp-lb-nav mcp-lb-prev" aria-label="Previous">‹</button>' +
        '<img alt="">' +
        '<button type="button" class="mcp-lb-nav mcp-lb-next" aria-label="Next">›</button>' +
        '<div class="mcp-lb-cap"></div></div>';
    box.addEventListener('click', function(ev) {
        if (ev.target === box) closeMcpScanLightbox();
    });
    box.querySelector('.mcp-lb-prev').addEventListener('click', function(ev) {
        ev.stopPropagation();
        stepMcpScanLightbox(-1);
    });
    box.querySelector('.mcp-lb-next').addEventListener('click', function(ev) {
        ev.stopPropagation();
        stepMcpScanLightbox(1);
    });
    document.body.appendChild(box);
    showMcpScanLightboxFrame();
}

function stepMcpScanLightbox(delta) {
    var n = mcpScanLightboxFiles.length;
    if (!n || !g('mcpScanLightbox')) return;
    mcpScanLightboxIndex = (mcpScanLightboxIndex + delta + n) % n;
    showMcpScanLightboxFrame();
}

function loadMcpScanStrip() {
    if (!isMcpClinicContext()) {
        hideMcpScanStrip();
        return;
    }
    var patient = (typeof xrayPatientData !== 'undefined') ? xrayPatientData : null;
    var ids = nntScanIdCandidates(patient);
    var no = ids.length ? ids[0] : '';
    if (!no || !clinicPageIsLocalServer() || (typeof xrayLauncherBlockedByPage === 'function' && xrayLauncherBlockedByPage())) {
        hideMcpScanStrip();
        return;
    }
    var gen = ++mcpScanLoadGen;
    ensureMcpScanStrip();
    var strip = g('mcpScanStrip');
    if (strip) strip.style.display = '';
    var empty = g('mcpScanEmpty');
    if (empty) {
        empty.style.display = '';
        empty.textContent = 'Loading films from \\\\RECEPTION_MCP\\IMAGE\\SCAN\\' + no + '…';
    }
    var ports = (typeof xrayLauncherPortList === 'function') ? xrayLauncherPortList() : [17890];
    var hosts = (typeof xrayLauncherHostList === 'function') ? xrayLauncherHostList() : ['127.0.0.1'];
    if (!ports.length) ports = [17890];
    if (ports.indexOf(17890) < 0) ports = [17890].concat(ports);
    var attempts = [];
    hosts.forEach(function(host) {
        ports.forEach(function(port) { attempts.push({ host: host, port: port }); });
    });

    function tryAt(idx, round) {
        if (gen !== mcpScanLoadGen) return;
        if (idx >= attempts.length) {
            if (round < 2) {
                setTimeout(function() { tryAt(0, round + 1); }, 1500);
                return;
            }
            if (empty) empty.textContent = 'Could not read \\\\RECEPTION_MCP\\IMAGE\\SCAN\\' + no + '.';
            return;
        }
        var a = attempts[idx];
        var url = 'http://' + a.host + ':' + a.port +
            '/carestream/files?scope=scan&patient_no=' + encodeURIComponent(no);
        var opts = nntScanFetchOpts();
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (ctrl) opts.signal = ctrl.signal;
        var timer = setTimeout(function() { if (ctrl) ctrl.abort(); }, 25000);
        fetch(url, opts).then(function(r) {
            if (!r.ok) throw new Error('mcp scan ' + r.status);
            return r.json();
        }).then(function(body) {
            clearTimeout(timer);
            if (gen !== mcpScanLoadGen) return;
            if (!body || !body.ok || body.scope !== 'scan') {
                tryAt(idx + 1, round);
                return;
            }
            if (typeof xraySetActiveLauncherPort === 'function') xraySetActiveLauncherPort(a.port, a.host);
            renderMcpScanStrip(no, body.files);
        }).catch(function() {
            clearTimeout(timer);
            tryAt(idx + 1, round);
        });
    }
    tryAt(0, 0);
}

function wrapNntScanPatientHooks() {
    if (typeof syncXrayPatient === 'function' && !syncXrayPatient._nntScanWrapped) {
        var origSync = syncXrayPatient;
        syncXrayPatient = function(patientId, patientData) {
            origSync(patientId, patientData);
            loadNntLocalScans();
            loadCarestreamFiles();
            loadMcpScanStrip();
        };
        syncXrayPatient._nntScanWrapped = true;
    }
    if (typeof selectXrayPatient === 'function' && !selectXrayPatient._nntScanWrapped) {
        var origSelect = selectXrayPatient;
        selectXrayPatient = function(p) {
            origSelect(p);
            loadNntLocalScans();
            loadCarestreamFiles();
            loadMcpScanStrip();
        };
        selectXrayPatient._nntScanWrapped = true;
    }
    if (typeof refreshXrays === 'function' && !refreshXrays._nntScanWrapped) {
        var origRefresh = refreshXrays;
        refreshXrays = function() {
            origRefresh();
            loadNntLocalScans();
            loadCarestreamFiles();
            loadMcpScanStrip();
        };
        refreshXrays._nntScanWrapped = true;
    }
    if (typeof tryLaunchDesktopAppViaLocalBridge === 'function' &&
        !tryLaunchDesktopAppViaLocalBridge._nntScanWrapped) {
        var origLaunch = tryLaunchDesktopAppViaLocalBridge;
        tryLaunchDesktopAppViaLocalBridge = function(launcherKey, patient, opts, cb) {
            origLaunch(launcherKey, patient, opts, function(attached, body) {
                if (launcherKey === 'nntnewtom' || launcherKey === 'myray') loadNntLocalScans();
                if (launcherKey === 'carestream' || launcherKey === 'trophy') {
                    loadCarestreamFiles();
                    loadMcpScanStrip();
                }
                if (typeof cb === 'function') cb(attached, body);
            });
        };
        tryLaunchDesktopAppViaLocalBridge._nntScanWrapped = true;
    }
    if (typeof setWorkingClinic === 'function' && !setWorkingClinic._mcpScanWrapped) {
        var origClinic = setWorkingClinic;
        setWorkingClinic = function(clinicId, options) {
            origClinic(clinicId, options);
            loadMcpScanStrip();
        };
        setWorkingClinic._mcpScanWrapped = true;
    }
}

document.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape') {
        closeNntScanLightbox();
        closeMcpScanLightbox();
    } else if (ev.key === 'ArrowLeft' && g('mcpScanLightbox')) {
        stepMcpScanLightbox(-1);
    } else if (ev.key === 'ArrowRight' && g('mcpScanLightbox')) {
        stepMcpScanLightbox(1);
    }
});

wrapNntScanPatientHooks();

var csdbNewSince = '';
var csdbNewSeen = {};
var csdbNewQueue = [];
var csdbNewPromptOpen = false;
var csdbNewPollTimer = 0;

function csdbLocalStamp(d) {
    var p = function(n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function csdbCurrentPatient() {
    if (typeof xrayPatientId !== 'undefined' && xrayPatientId &&
        typeof xrayPatientData !== 'undefined' && xrayPatientData) {
        return xrayPatientData;
    }
    if (typeof activePatientSlots !== 'undefined' && activePatientSlots && activePatientSlots[0]) {
        return activePatientSlots[0];
    }
    return null;
}

function csdbPatientLabel(patient) {
    if (!patient) return '';
    var bits = [];
    if (patient.patient_no) bits.push('#' + patient.patient_no);
    if (patient.chinese_name) bits.push(patient.chinese_name);
    if (patient.full_name) bits.push(patient.full_name);
    return bits.join(' ');
}

function ensureCsdbNewPrompt() {
    if (g('csdbNewPrompt')) return g('csdbNewPrompt');
    var css = document.createElement('style');
    css.id = 'csdbNewPromptStyle';
    css.textContent =
        '#csdbNewPrompt{position:fixed;inset:0;z-index:13000;background:rgba(15,23,42,.55);' +
        'display:flex;align-items:center;justify-content:center;padding:24px}' +
        '#csdbNewPrompt .csdb-new-box{width:min(440px,92vw);background:#fff;border-radius:12px;' +
        'padding:18px 18px 16px;box-shadow:0 16px 40px rgba(15,23,42,.25)}' +
        '#csdbNewPrompt h3{margin:0 0 8px;font-size:16px;color:#0f172a}' +
        '#csdbNewPrompt p{margin:0 0 12px;font-size:13px;color:#334155;line-height:1.45}' +
        '#csdbNewPrompt img{display:block;width:100%;max-height:180px;object-fit:contain;' +
        'background:#0f172a;border-radius:8px;margin:0 0 14px}' +
        '#csdbNewPrompt .csdb-new-actions{display:flex;gap:8px}' +
        '#csdbNewPrompt button{flex:1;padding:11px 12px;border:none;border-radius:8px;' +
        'font-weight:800;cursor:pointer}' +
        '#csdbNewYes{background:#0f766e;color:#fff}' +
        '#csdbNewNo{background:#e2e8f0;color:#0f172a}';
    document.head.appendChild(css);
    var box = document.createElement('div');
    box.id = 'csdbNewPrompt';
    box.style.display = 'none';
    box.innerHTML =
        '<div class="csdb-new-box" role="dialog" aria-modal="true">' +
        '<h3>New Carestream x-ray</h3>' +
        '<p id="csdbNewPromptText"></p>' +
        '<img id="csdbNewPromptImg" alt="">' +
        '<div class="csdb-new-actions">' +
        '<button type="button" id="csdbNewYes">Yes, add to this patient</button>' +
        '<button type="button" id="csdbNewNo">Not now</button>' +
        '</div></div>';
    document.body.appendChild(box);
    g('csdbNewYes').addEventListener('click', acceptCsdbNewFilm);
    g('csdbNewNo').addEventListener('click', dismissCsdbNewFilm);
    return box;
}

function hideCsdbNewPrompt() {
    var box = g('csdbNewPrompt');
    if (box) box.style.display = 'none';
    csdbNewPromptOpen = false;
}

function showNextCsdbNewPrompt() {
    if (csdbNewPromptOpen) return;
    var patient = csdbCurrentPatient();
    if (!patient || !patient.id) return;
    var file = csdbNewQueue[0];
    if (!file) return;
    var box = ensureCsdbNewPrompt();
    var taken = (file.written || file.taken) ? String(file.written || file.taken).slice(0, 16).replace('T', ' ') : '';
    var text = g('csdbNewPromptText');
    if (text) {
        text.textContent = 'A new x-ray was saved in D:\\CSDB' +
            (taken ? ' at ' + taken : '') +
            '. Add it to the current patient ' + (csdbPatientLabel(patient) || 'on screen') + '?';
    }
    var img = g('csdbNewPromptImg');
    if (img) {
        img.src = carestreamFileUrl('', {
            store: 'csdb',
            case_id: file.case_id,
            name: file.name
        }, 'thumb');
    }
    box.style.display = 'flex';
    csdbNewPromptOpen = true;
}

function dismissCsdbNewFilm() {
    var file = csdbNewQueue.shift();
    if (file && file.case_id) csdbNewSeen[file.case_id] = 'no';
    hideCsdbNewPrompt();
    showNextCsdbNewPrompt();
}

function acceptCsdbNewFilm() {
    var file = csdbNewQueue.shift();
    hideCsdbNewPrompt();
    if (!file) return;
    if (file.case_id) csdbNewSeen[file.case_id] = 'yes';
    var patient = csdbCurrentPatient();
    if (!patient || !patient.id) {
        showNextCsdbNewPrompt();
        return;
    }
    if (typeof syncXrayPatient === 'function' &&
        (typeof xrayPatientId === 'undefined' || String(xrayPatientId || '') !== String(patient.id))) {
        syncXrayPatient(patient.id, patient);
    }
    var url = carestreamFileUrl('', {
        store: 'csdb',
        case_id: file.case_id,
        name: file.name
    }, 'full');
    fetch(url, nntScanFetchOpts()).then(function(r) {
        if (!r.ok) throw new Error('csdb new ' + r.status);
        return r.blob();
    }).then(function(blob) {
        var mime = (blob.type || 'image/jpeg').split(';')[0];
        var ext = mime.indexOf('png') >= 0 ? '.png' : '.jpg';
        var taken = file.taken ? String(file.taken).slice(0, 10) : '';
        var upload = new File([blob], 'P1' + ext, { type: mime });
        upload.xhTypeGuess = 'Panoramic';
        upload.xhDate = taken;
        upload.xhNotes = 'New Carestream film from D:\\CSDB' + (taken ? ' ' + taken : '');
        if (typeof xrayStartQueuedUpload === 'function') xrayStartQueuedUpload([upload]);
        showNextCsdbNewPrompt();
    }).catch(function() {
        alert('Could not read the new Carestream x-ray from D:\\CSDB.');
        showNextCsdbNewPrompt();
    });
}

function pollCsdbNewFilms() {
    if (!csdbNewSince) csdbNewSince = csdbLocalStamp(new Date());
    var ports = (typeof xrayLauncherPortList === 'function') ? xrayLauncherPortList() : [17890];
    var hosts = (typeof xrayLauncherHostList === 'function') ? xrayLauncherHostList() : ['127.0.0.1'];
    if (!ports.length) ports = [17890];
    if (ports.indexOf(17890) < 0) ports = [17890].concat(ports);
    var host = hosts[0] || '127.0.0.1';
    var port = ports[0];
    var url = 'http://' + host + ':' + port + '/carestream/new?since=' + encodeURIComponent(csdbNewSince);
    var opts = nntScanFetchOpts();
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (ctrl) opts.signal = ctrl.signal;
    var timer = setTimeout(function() { if (ctrl) ctrl.abort(); }, 8000);
    fetch(url, opts).then(function(r) {
        if (!r.ok) throw new Error('new ' + r.status);
        return r.json();
    }).then(function(body) {
        clearTimeout(timer);
        carestreamAsList(body && body.files).forEach(function(file) {
            var id = file && file.case_id ? String(file.case_id) : '';
            if (!id || csdbNewSeen[id]) return;
            csdbNewSeen[id] = 'queued';
            csdbNewQueue.push(file);
        });
        showNextCsdbNewPrompt();
    }).catch(function() {
        clearTimeout(timer);
    });
}

function startCsdbNewWatch() {
    if (csdbNewPollTimer) return;
    csdbNewSince = csdbLocalStamp(new Date());
    pollCsdbNewFilms();
    csdbNewPollTimer = setInterval(pollCsdbNewFilms, 5000);
}

document.addEventListener('DOMContentLoaded', function() {
    wrapNntScanPatientHooks();
    ensureNntScanStrip();
    ensureCarestreamStrip();
    ensureMcpScanStrip();
    loadNntLocalScans();
    loadCarestreamFiles();
    loadMcpScanStrip();
    startCsdbNewWatch();
});

document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        loadNntLocalScans();
        loadCarestreamFiles();
        loadMcpScanStrip();
    }
});

document.addEventListener('app-lang-change', refreshNntScanStripTitle);
document.addEventListener('app-session-sync', function() {
    refreshNntScanStripTitle();
    loadMcpScanStrip();
});
