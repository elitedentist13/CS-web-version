// ════════════════════════════════════════════════════════════════
// app-xray.js  –  X-RAY MODULE  (drop-in safe)
// Depends on globals already defined by main app:
//   SB, g(), sv(), esc(), openModal(), closeModal(),
//   formatDobAge(), fmtDateLong(), todayISO(), currentName
// ════════════════════════════════════════════════════════════════

// ── Module State ──────────────────────────────────────────────
var xrayPatientId   = null;
var xrayPatientData = null;
var xrayAllRecords  = [];   // all DB records for this patient
var xrayFiltered    = [];   // after filter/search
var xraySelected    = new Set();
var xrayCurrentIdx  = 0;
var xrayView        = 'grid';
var xrayUploadQueue = [];   // files queued for sequential upload
var xrayUploadQIdx  = 0;
var diyLinks        = [];   // custom external-system links
var xrayLocalPaths  = {};   // per-system desktop paths (localStorage)
var xrayPendingLocalImportKey = null;
var xrayBulkLocalImport = false;

var XRAY_LOCAL_PATHS_KEY = 'jsm_xray_local_paths_v1';
var XRAY_IMAGE_EXT_RE    = /\.(jpe?g|png|bmp|gif|tif?f|webp|dcm)$/i;

function xrayClinicImageRoot() {
    return (typeof CLINIC_IMAGE_ROOT === 'string' && CLINIC_IMAGE_ROOT)
        ? CLINIC_IMAGE_ROOT
        : 'C:\\Image';
}

function xrayDefaultSubPattern() {
    return 'Xrays\\{patient_no}';
}

var XRAY_TYPE_PAIRS = [
    ['Periapical', 'media.xrayType.periapical'],
    ['Bitewing', 'media.xrayType.bitewing'],
    ['Panoramic', 'media.xrayType.panoramic'],
    ['CBCT', 'media.xrayType.cbct'],
    ['Cephalometric', 'media.xrayType.cephalometric'],
    ['Occlusal', 'media.xrayType.occlusal'],
    ['Other', 'media.categoryOther']
];

function xrayTypeLabel(raw) {
    var s = String(raw || '').trim();
    if (!s) return mediaTr('media.categoryOther');
    var i;
    for (i = 0; i < XRAY_TYPE_PAIRS.length; i++) {
        if (XRAY_TYPE_PAIRS[i][0] === s) return mediaTr(XRAY_TYPE_PAIRS[i][1]);
    }
    if (/^other$/i.test(s)) return mediaTr('media.categoryOther');
    return s;
}

function refreshXrayTypeSelects() {
    function fill(selId, includeAll) {
        var sel = g(selId);
        if (!sel) return;
        var prev = sel.value;
        var html = includeAll
            ? '<option value="">' + esc(mediaTr('media.allTypes')) + '</option>'
            : '';
        XRAY_TYPE_PAIRS.forEach(function(pair) {
            html += '<option value="' + esc(pair[0]) + '">' + esc(mediaTr(pair[1])) + '</option>';
        });
        sel.innerHTML = html;
        if (prev) sel.value = prev;
    }
    fill('xrayFilterType', true);
    fill('uploadType', false);
    fill('lbType', false);
}

function refreshXrayBannerI18n() {
    var p = xrayPatientData;
    if (!p) return;
    var dobEl = g('conXrayBannerDob');
    if (dobEl) dobEl.textContent = p.dob ? formatDobAge(p.dob) : '-';
    var alertEl = g('conXrayBannerAlert');
    if (alertEl) {
        alertEl.textContent = p.medical_alerts || mediaTr('con.banner.none');
        alertEl.style.color = p.medical_alerts ? 'var(--danger)' : '#999';
    }
}

function mediaTr(key) {
    return (typeof t === 'function') ? t(key) : key;
}

function mediaTrRepl(key, pairs) {
    var s = mediaTr(key);
    if (!pairs) return s;
    for (var k in pairs) {
        if (Object.prototype.hasOwnProperty.call(pairs, k)) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        }
    }
    return s;
}

function mediaErr(msg) {
    return mediaTrRepl('media.alert.error', { MSG: msg });
}

// Image transform state — slide view
var slideTransform = {
    scale: 1, rotate: 0, flipH: false, flipV: false, invert: false
};

// Image transform state — lightbox
var lbChromeMaximized = false;
var lbChromeMetaVisible = true;
var lbChromeMetaVisibleBeforeMax = true;
var lbChromeScaleBeforeMax = 1;
var lbTransform = {
    scale: 1, rotate: 0, flipH: false, flipV: false, invert: false
};

var lbCurrentId  = null;    // id of record open in lightbox
var _lbMetaDirty = false;   // true when metadata fields edited without saving
var XRAY_BUCKET  = 'xrays'; // Supabase Storage bucket name

function xrayGetPublicUrlForPath(storagePath) {
    var ur = SB.storage.from(XRAY_BUCKET).getPublicUrl(storagePath);
    if (ur && ur.data && ur.data.publicUrl) return ur.data.publicUrl;
    if (ur && typeof ur.publicUrl === 'string') return ur.publicUrl;
    return '';
}

// ── Lightbox extended state ──────────────────────────────
var lbBrightness  = 100;    // CSS brightness %
var lbContrast    = 100;    // CSS contrast %
var lbTool        = 'none'; // none | pan | free | line | arrow | rect | ellipse | poly | crop | text

var lbDrawColor   = '#ff0000';
var lbStrokeWidth = 4;
var lbIsDrawing   = false;
var lbDrawStart   = {x:0, y:0};
var lbPolyPts     = [];
var lbDrawHistory = [];     // ImageData undo stack (max 20)
var lbCropRect    = null;   // {x,y,w,h} in canvas coords
var lbIsVideo       = false;
var lbLayoutBaseW   = 0;
var lbLayoutBaseH   = 0;
var lbScrollDragging = false;
var lbScrollLast     = { x: 0, y: 0 };

// ════════════════════════════════════════════════════════════════
// BUCKET HEALTH CHECK
// Called once when a patient is selected to give an early warning
// if the storage bucket is missing or mis-configured.
// ════════════════════════════════════════════════════════════════
function checkXrayBucket() {
    // list() with limit 1 is the lightest possible probe
    SB.storage.from(XRAY_BUCKET)
        .list('', { limit: 1 })
        .then(function(r) {
            if (r.error) {
                var msg = r.error.message || '';
                if (msg.toLowerCase().includes('bucket not found') ||
                    msg.toLowerCase().includes('not found')) {
                    showXrayError(
                        mediaTr('media.err.bucketProbeTitle'),
                        mediaTrRepl('media.err.bucketProbeHtml', { BUCKET: XRAY_BUCKET })
                    );
                } else {
                    // Non-fatal warning (e.g. policy issue) — log only
                    console.warn('[X-Ray] Bucket probe warning:', msg);
                }
            }
            // No error → bucket is reachable; do nothing
        });
}

// ════════════════════════════════════════════════════════════════
// PATIENT SEARCH
// ════════════════════════════════════════════════════════════════
function doConPatientSearchXray() {
    runPatientSearchDropdown({
        inputId: 'conPsInputXray',
        dropId: 'conPsDropXray',
        clinicFilterId: 'conPsClinicFilterXray',
        autoSelectSingle: false,
        activeSource: 'consultation-xray-search',
        onSelect: selectXrayPatient
    });
}

// ════════════════════════════════════════════════════════════════
// SYNC FUNCTION — called from consultation module
// ════════════════════════════════════════════════════════════════
function xrayPatientBannerName(patientData) {
    if (!patientData) return '—';
    var en = String(patientData.full_name || '').trim();
    var cn = String(patientData.chinese_name || '').trim();
    return en || cn || '—';
}

function xrayPatientSearchLabel(patientData) {
    if (!patientData) return '';
    if (typeof xrayPatientSearchClipboardText === 'function') {
        return xrayPatientSearchClipboardText(patientData);
    }
    var name = xrayPatientBannerName(patientData);
    var no = String(patientData.patient_no || '').trim();
    if (name && name !== '—' && no) return name + ' (#' + no + ')';
    if (name && name !== '—') return name;
    return no ? ('#' + no) : '';
}

function xrayMergePatientRecord(base, extra) {
    if (!extra || !extra.id) return base || null;
    if (!base || !base.id || String(base.id) !== String(extra.id)) {
        return Object.assign({}, extra);
    }
    return Object.assign({}, base, extra);
}

function xrayResolveCurrentPatient() {
    if (xrayPatientId && xrayPatientData) return xrayPatientData;
    if (typeof activePatientSlots !== 'undefined' && activePatientSlots[0] &&
        activePatientSlots[0].id) {
        return activePatientSlots[0];
    }
    if (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id) {
        return conPatientData;
    }
    if (typeof _patientDetailsPatient !== 'undefined' && _patientDetailsPatient &&
        _patientDetailsPatient.id) {
        return _patientDetailsPatient;
    }
    return null;
}

function xrayHydratePatientRecord(patientId, onDone) {
    if (!patientId || typeof SB === 'undefined' || !SB.from) {
        if (onDone) onDone(null);
        return;
    }
    SB.from('patients').select('*').eq('id', patientId).limit(1)
        .then(function(r) {
            if (onDone) onDone((r.data && r.data[0]) ? r.data[0] : null);
        })
        .catch(function() {
            if (onDone) onDone(null);
        });
}

function xraySyncFromActivePatientPayload(p, source) {
    if (!p || !p.id) return;
    if (source && (source.indexOf('xray') >= 0 || source === 'patient-row')) return;
    var merged = xrayMergePatientRecord(p, xrayResolveCurrentPatient());
    syncXrayPatient(merged.id, merged);
    xrayHydratePatientRecord(merged.id, function(full) {
        if (!full || String(xrayPatientId) !== String(full.id)) return;
        syncXrayPatient(full.id, full);
    });
}

function syncXrayPatient(patientId, patientData) {
    // This is called when a patient is selected in ANY consultation tab
    // It pre-populates the X-ray tab so it's ready when clicked
    xrayPatientId   = patientId;
    xrayPatientData = patientData;
    
    // Populate the search input
    var searchInput = g('conPsInputXray');
    if (searchInput && patientData && document.activeElement !== searchInput) {
        searchInput.value = (typeof patientSearchInputDisplayValue === 'function')
            ? patientSearchInputDisplayValue(patientData)
            : xrayPatientSearchLabel(patientData);
        searchInput.dataset.psLockedPatientId = String(patientData.id || patientId || '');
    }
    
    // Close dropdown if open
    var dd = g('conPsDropXray');
    if (dd) dd.style.display = 'none';
    
    // Populate banner
    var banner = g('conXrayBanner');
    if (banner) banner.style.display = 'flex';
    
    if (patientData) {
        var nameEl = g('conXrayBannerName');
        if (nameEl) nameEl.textContent = xrayPatientBannerName(patientData);
        
        var noEl = g('conXrayBannerNo');
        if (noEl) noEl.textContent = patientData.patient_no || '-';
        
        var dobEl = g('conXrayBannerDob');
        if (dobEl && patientData.dob) {
            dobEl.textContent = formatDobAge(patientData.dob);
        }
        
        var alertEl = g('conXrayBannerAlert');
        if (alertEl) {
            alertEl.textContent = patientData.medical_alerts || mediaTr('con.banner.none');
            alertEl.style.color = patientData.medical_alerts ? 'var(--danger)' : '#999';
        }
    }
    
    // Reveal main content
    var main = g('xrayMainContent');
    if (main) main.style.display = 'block';
    syncXrayNotesToggleLabel();

    if (typeof conPatientId !== 'undefined') conPatientId = patientId;
    if (typeof conPatientData !== 'undefined') conPatientData = patientData || conPatientData;
    if (typeof loadConNotes === 'function') loadConNotes(patientId);
    
    // Pre-load x-ray records so they're ready
    loadXrayRecords();
    loadDiyLinks();
}

// ── Single, authoritative definition of selectXrayPatient ─────
function selectXrayPatient(p) {
    xrayPatientId   = p.id;
    xrayPatientData = p;

    // Show patient banner
    var banner = g('conXrayBanner');
    if (banner) banner.style.display = 'flex';

    g('conXrayBannerName').textContent = p.full_name;
    g('conXrayBannerNo').textContent   = p.patient_no || '-';
    g('conXrayBannerDob').textContent  = p.dob ? formatDobAge(p.dob) : '-';

    var alertEl = g('conXrayBannerAlert');
    if (alertEl) {
        alertEl.textContent = p.medical_alerts || mediaTr('con.banner.none');
        alertEl.style.color = p.medical_alerts ? 'var(--danger)' : '#999';
    }

    // Reveal the main X-ray content area
    var main = g('xrayMainContent');
    if (main) main.style.display = 'block';
    syncXrayNotesToggleLabel();

    if (typeof conPatientId !== 'undefined') conPatientId = p.id;
    if (typeof conPatientData !== 'undefined') conPatientData = p;
    if (typeof loadConNotes === 'function') loadConNotes(p.id);

    // Probe bucket once so we surface config problems early
    checkXrayBucket();

    // Load records and any saved external-system links
    loadXrayRecords();
    loadDiyLinks();
}

// ════════════════════════════════════════════════════════════════
// REFRESH  — wired to the ↻ Refresh button in the action bar
// ════════════════════════════════════════════════════════════════
function refreshXrays() {
    if (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id &&
        String(conPatientData.id) !== String(xrayPatientId || '')) {
        syncXrayPatient(conPatientData.id, conPatientData);
        return;
    }
    if (!xrayPatientId) {
        var current = xrayResolveCurrentPatient();
        if (current && current.id) {
            syncXrayPatient(current.id, current);
            return;
        }
        return;
    }
    loadXrayRecords();
}

function xrayNotesPanelHidden() {
    var wb = g('xrayWorkbench');
    return !!(wb && wb.classList.contains('xray-workbench--notes-hidden'));
}

function syncXrayNotesToggleLabel() {
    var btn = g('xrayNotesToggleBtn');
    if (!btn) return;
    var hidden = xrayNotesPanelHidden();
    btn.textContent = mediaTr(hidden ? 'con.xray.showNotes' : 'con.xray.hideNotes');
    btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
}

function toggleXrayNotesPanel(forceHidden) {
    var wb = g('xrayWorkbench');
    if (!wb) return;
    var hidden = typeof forceHidden === 'boolean'
        ? forceHidden
        : !wb.classList.contains('xray-workbench--notes-hidden');
    wb.classList.toggle('xray-workbench--notes-hidden', hidden);
    syncXrayNotesToggleLabel();
}

// Plain DB URL (no cache-bust params)
function xrayBareUrl(record) {
    return (record && record.file_url) ? record.file_url : '';
}

// Public URLs for <img>/<video>/fetch — cache-bust tied to bucket object + row meta
function xrayDisplayUrl(record) {
    var raw = xrayBareUrl(record);
    if (!raw || raw.indexOf('data:') === 0) return raw || '';
    var token = encodeURIComponent([
        record.file_path || '',
        record.file_size != null ? String(record.file_size) : '',
        record.updated_at || record.created_at || '',
        record.id != null ? String(record.id) : ''
    ].join('|'));
    return raw.indexOf('?') >= 0 ? raw + '&_xr=' + token : raw + '?_xr=' + token;
}

// ════════════════════════════════════════════════════════════════
// LOAD X-RAY RECORDS FROM DATABASE
// ════════════════════════════════════════════════════════════════
function loadXrayRecords() {
    if (!xrayPatientId) {
        return Promise.resolve();
    }
    return SB.from('xrays')
        .select('*')
        .eq('patient_id', xrayPatientId)
        .order('taken_date', { ascending: false })
        .order('created_at', { ascending: false })
    .then(function(r) {
        if (r.error) {
            console.error('[X-Ray] load error:', r.error);
            xrayAllRecords = [];
        } else {
            xrayAllRecords = r.data || [];
        }
        populateYearFilter();
        filterXrays();
    });
}

function populateYearFilter() {
    var sel   = g('xrayFilterYear');
    if (!sel) return;
    var years = new Set();
    xrayAllRecords.forEach(function(x) {
        if (x.taken_date) years.add(x.taken_date.slice(0, 4));
    });
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(mediaTr('media.allYears')) + '</option>';
    Array.from(years).sort().reverse().forEach(function(y) {
        var o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === cur) o.selected = true;
        sel.appendChild(o);
    });
}

// ════════════════════════════════════════════════════════════════
// FILTER & SEARCH
// ════════════════════════════════════════════════════════════════
function filterXrays() {
    var type  = (g('xrayFilterType').value   || '').toLowerCase();
    var year  = (g('xrayFilterYear').value   || '');
    var query = (g('xrayFilterSearch').value || '').toLowerCase();

    xrayFiltered = xrayAllRecords.filter(function(x) {
        if (type  && (x.xray_type  || '').toLowerCase() !== type) return false;
        if (year  && (!x.taken_date || !x.taken_date.startsWith(year))) return false;
        if (query && !(x.notes || '').toLowerCase().includes(query)) return false;
        return true;
    });

    xraySelected.clear();
    updateSelectedCount();

    var sa = g('xraySelectAll');
    if (sa) sa.checked = false;

    if (xrayView === 'grid') renderXrayGrid();
    else                     renderXraySlide();
}

// ════════════════════════════════════════════════════════════════
// VIEW TOGGLE  (grid / slide)
// ════════════════════════════════════════════════════════════════
function setXrayView(view) {
    xrayView = view;
    var btnG = g('btnGridView');
    var btnS = g('btnSlideView');
    if (btnG) btnG.classList.toggle('active', view === 'grid');
    if (btnS) btnS.classList.toggle('active', view === 'slide');

    var gv = g('xrayGridView');
    var sv2 = g('xraySlideView');  // avoid shadowing the global sv()
    if (gv)  gv.style.display  = view === 'grid'  ? '' : 'none';
    if (sv2) sv2.style.display = view === 'slide' ? '' : 'none';

    if (view === 'slide') renderXraySlide();
    else                  renderXrayGrid();
}

// ════════════════════════════════════════════════════════════════
// GRID RENDER
// ════════════════════════════════════════════════════════════════
function renderXrayGrid() {
    var grid  = g('xrayGridView');
    var empty = g('xrayEmptyState');
    if (!grid) return;

    // Remove existing cards, keep the empty-state sentinel
    Array.from(grid.children).forEach(function(c) {
        if (c !== empty) grid.removeChild(c);
    });

    if (!xrayFiltered.length) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    xrayFiltered.forEach(function(x, idx) {
        var card    = document.createElement('div');
        card.className  = 'xray-card';
        card.dataset.id = x.id;

        var typeBadge = getTypeBadge(x.xray_type);
        var dateStr   = x.taken_date ? fmtDateLong(x.taken_date) : mediaTr('media.noDate');
        var imgSrc    = xrayDisplayUrl(x);

        var noPreviewSVG =
            'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">' +
                '<rect fill="#1a1a2e"/>' +
                '<text x="50%" y="50%" fill="#666" text-anchor="middle" ' +
                'dy=".3em" font-size="14">' + esc(mediaTr('media.noPreview')) + '</text></svg>'
            );

        card.innerHTML =
            '<div class="xray-card-check">' +
                '<input type="checkbox" class="xray-cb" data-id="' + x.id + '"' +
                (xraySelected.has(x.id) ? ' checked' : '') + '>' +
            '</div>' +
            '<div class="xray-card-img" data-idx="' + idx + '">' +
                (imgSrc
                    ? '<img src="' + imgSrc + '" alt="X-Ray" ' +
                      'onerror="this.src=\'' + noPreviewSVG + '\'">'
                    : '<div class="xray-no-img">🔬<br><small>' + esc(mediaTr('media.noPreview')) + '</small></div>') +
            '</div>' +
            '<div class="xray-card-body">' +
                '<div class="xray-card-top">' +
                    typeBadge +
                    '<span class="xray-card-date">' + dateStr + '</span>' +
                '</div>' +
                (x.notes
                    ? '<div class="xray-card-notes">' + esc(x.notes) + '</div>'
                    : '') +
                '<div class="xray-card-actions">' +
                    '<button class="xray-cb-open" data-idx="' + idx + '">' +
                        esc(mediaTr('media.btn.view')) +
                    '</button>' +
                    '<button type="button" class="xray-cb-dl" data-dl="' + idx + '"' +
                        'data-name="' + esc(x.xray_type || 'image') + '">' +
                        '💾' +
                    '</button>' +
                '</div>' +
            '</div>';

        grid.appendChild(card);

        var dlBtn = card.querySelector('.xray-cb-dl');
        if (dlBtn && imgSrc) dlBtn.dataset.url = imgSrc;

        // Checkbox toggle
        card.querySelector('.xray-cb').addEventListener('change', function() {
            if (this.checked) xraySelected.add(x.id);
            else              xraySelected.delete(x.id);
            updateSelectedCount();
        });

        // Open lightbox — image click or View button
        card.querySelector('.xray-card-img')
            .addEventListener('click', function() { openLightbox(idx); });
        card.querySelector('.xray-cb-open')
            .addEventListener('click', function() { openLightbox(idx); });

        card.querySelector('.xray-cb-dl').addEventListener('click', function(ev) {
            var u = this.dataset.url;
            downloadFile(u, 'xray-' + (ev.currentTarget.dataset.name || 'image') + '.jpg');
        });
    });
}

// Returns a coloured pill badge for the X-ray type
function getTypeBadge(type) {
    var palette = {
        'Periapical':    '#dbeafe:#1d4ed8',
        'Bitewing':      '#dcfce7:#166534',
        'Panoramic':     '#fef9c3:#713f12',
        'CBCT':          '#fce7f3:#9d174d',
        'Cephalometric': '#ede9fe:#5b21b6',
        'Occlusal':      '#ffedd5:#9a3412',
        'Other':         '#f3f4f6:#374151'
    };
    var c = (palette[type] || palette['Other']).split(':');
    return '<span style="background:' + c[0] + ';color:' + c[1] + ';' +
           'font-size:10px;font-weight:700;padding:2px 8px;' +
           'border-radius:10px;">' + esc(xrayTypeLabel(type)) + '</span>';
}

// ════════════════════════════════════════════════════════════════
// SLIDE VIEW
// ════════════════════════════════════════════════════════════════
function renderXraySlide() {
    if (!xrayFiltered.length) {
        var viewer = g('xraySlideViewer');
        if (viewer) {
            viewer.innerHTML =
                '<div class="xray-empty" style="height:100%;' +
                'display:flex;align-items:center;justify-content:center;">' +
                '<div style="text-align:center;color:#666;">' +
                '<div style="font-size:48px;">🔬</div>' +
                '<p>' + esc(mediaTr('media.noXrays')) + '</p></div></div>';
        }
        var fs = g('xrayFilmstrip');
        if (fs) fs.innerHTML = '';
        return;
    }
    if (xrayCurrentIdx >= xrayFiltered.length) xrayCurrentIdx = 0;
    renderSlideAt(xrayCurrentIdx);
    renderFilmstrip();
}

function renderSlideAt(idx) {
    xrayCurrentIdx = idx;
    slideTransform = { scale:1, rotate:0, flipH:false, flipV:false, invert:false };

    var x   = xrayFiltered[idx];
    var img = g('xraySlideImg');
    if (img) { img.src = xrayDisplayUrl(x); }
    applySlideTransform();

    var ctr = g('xraySlideCounter');
    if (ctr) {
        ctr.textContent = mediaTrRepl('media.slide.counterFmt', {
            CURRENT: String(idx + 1),
            TOTAL: String(xrayFiltered.length)
        });
    }

    var typeEl = g('xraySlideType');
    if (typeEl) typeEl.textContent = xrayTypeLabel(x.xray_type);

    var dateEl = g('xraySlideDate');
    if (dateEl) dateEl.textContent = x.taken_date ? fmtDateLong(x.taken_date) : '—';

    var notesEl = g('xraySlideNotes');
    if (notesEl) notesEl.textContent = x.notes || '—';

    // Highlight active filmstrip thumbnail
    document.querySelectorAll('.xray-fs-thumb').forEach(function(t, i) {
        t.classList.toggle('active', i === idx);
    });
}

function renderFilmstrip() {
    var fs = g('xrayFilmstrip');
    if (!fs) return;
    fs.innerHTML = '';
    xrayFiltered.forEach(function(x, i) {
        var div = document.createElement('div');
        div.className = 'xray-fs-thumb' + (i === xrayCurrentIdx ? ' active' : '');
        var thumb = x.file_url ? xrayDisplayUrl(x) : '';
        div.innerHTML =
            thumb
                ? '<img src="' + thumb + '" alt="thumb">'
                : '<div class="xray-fs-no-img">🔬</div>';
        div.addEventListener('click', function() { renderSlideAt(i); });
        fs.appendChild(div);
    });
}

function slideNav(dir) {
    if (!xrayFiltered.length) return;
    var next = xrayCurrentIdx + dir;
    if (next < 0)                    next = xrayFiltered.length - 1;
    if (next >= xrayFiltered.length) next = 0;
    renderSlideAt(next);
}

// ── Slide image transforms ────────────────────────────────────
function applySlideTransform() {
    var img = g('xraySlideImg');
    if (!img) return;
    var t = slideTransform;
    img.style.transform =
        'scale(' + (t.scale * (t.flipH ? -1 : 1)) + ',' +
                   (t.scale * (t.flipV ? -1 : 1)) + ') ' +
        'rotate(' + t.rotate + 'deg)';
    img.style.filter = t.invert ? 'invert(1)' : '';
}

function xrayZoom(factor)  { slideTransform.scale  *= factor; applySlideTransform(); }
function xrayRotate(deg)   { slideTransform.rotate  = (slideTransform.rotate + deg) % 360; applySlideTransform(); }
function xrayFlip(axis)    { if (axis === 'h') slideTransform.flipH = !slideTransform.flipH; else slideTransform.flipV = !slideTransform.flipV; applySlideTransform(); }
function xrayInvert()      { slideTransform.invert  = !slideTransform.invert; applySlideTransform(); }
function xrayReset()       { slideTransform = { scale:1, rotate:0, flipH:false, flipV:false, invert:false }; applySlideTransform(); }

function downloadCurrentXray() {
    var x = xrayFiltered[xrayCurrentIdx];
    if (!x) return;
    downloadFile(xrayDisplayUrl(x), 'xray-' + (x.xray_type || 'image') + '.jpg');
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — SCROLL VIEWPORT (bars + drag when zoomed)
// ════════════════════════════════════════════════════════════════
function lbResetScrollHost() {
    var host = g('xrayLbScrollHost');
    if (host) {
        host.scrollTop  = 0;
        host.scrollLeft = 0;
    }
}

function lbResetLightboxChrome() {
    lbChromeMaximized = false;
    lbChromeMetaVisible = true;
    lbChromeMetaVisibleBeforeMax = true;
    lbChromeScaleBeforeMax = 1;
    lbSyncLightboxChrome();
}

function lbFitToScrollHost() {
    if (!lbLayoutBaseW || !lbLayoutBaseH) return;
    var host = g('xrayLbScrollHost');
    if (!host) return;

    var pad = 20;
    var vpW = Math.max(1, host.clientWidth - pad * 2);
    var vpH = Math.max(1, host.clientHeight - pad * 2);

    var prevScale = lbTransform.scale;
    lbTransform.scale = 1;
    var d = lbScrollOuterDims();
    lbTransform.scale = prevScale;

    if (!d.bw || !d.bh) return;
    var fitW = vpW / d.bw;
    var fitH = vpH / d.bh;
    // When maximized, magnify to fill the display width as much as allowed
    // (vertical overflow is handled by the scroll viewport). Otherwise fit
    // the whole image within the viewport.
    var fit = lbChromeMaximized ? fitW : Math.min(fitW, fitH);
    if (!isFinite(fit) || fit <= 0) return;

    lbTransform.scale = Math.max(0.12, Math.min(14, fit));
    lbResetScrollHost();
    lbSyncLightboxScrollShell();
}

if (!window.__lbMaxResizeBound) {
    window.__lbMaxResizeBound = true;
    window.addEventListener('resize', function () {
        var modal = g('xrayLightbox');
        if (!lbChromeMaximized || !modal || modal.style.display !== 'block') return;
        lbFitToScrollHost();
    });
}

/* Auto-fit the image whenever the lightbox panel changes size
   (manual drag-resize via the corner grip, or maximize/restore). */
function lbInitBoxResizeObserver() {
    if (window.__lbBoxRO || typeof ResizeObserver === 'undefined') return;
    var box = document.querySelector('#xrayLightbox .xray-lightbox-box');
    if (!box) return;
    window.__lbBoxRO = new ResizeObserver(function () {
        var modal = g('xrayLightbox');
        if (!modal || modal.style.display !== 'block') return;
        // Only auto-fit when maximized or after a manual resize.
        if (!lbChromeMaximized && !box.style.width && !box.style.height) return;
        if (window.__lbBoxROraf) cancelAnimationFrame(window.__lbBoxROraf);
        window.__lbBoxROraf = requestAnimationFrame(function () {
            lbFitToScrollHost();
        });
    });
    window.__lbBoxRO.observe(box);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lbInitBoxResizeObserver);
} else {
    lbInitBoxResizeObserver();
}

function lbSyncLightboxChrome(options) {
    options = options || {};
    var modal = g('xrayLightbox');
    var main = g('xrayLbMain');
    var maxBtn = g('lbToggleMaxBtn');
    var metaBtn = g('lbToggleMetaBtn');
    var restoreBtn = g('lbRestoreMaxBtn');

    if (modal) {
        modal.classList.toggle('xray-lb-maximized', lbChromeMaximized);
    }
    if (main) {
        main.classList.toggle('xray-lb-meta-hidden', !lbChromeMetaVisible);
    }
    if (maxBtn) {
        maxBtn.classList.toggle('lb-chrome-active', lbChromeMaximized);
        maxBtn.textContent = lbChromeMaximized ? '⤢' : '⛶';
        maxBtn.setAttribute('title', mediaTr(lbChromeMaximized ? 'media.lb.restore' : 'media.lb.maximize'));
        maxBtn.setAttribute('aria-pressed', lbChromeMaximized ? 'true' : 'false');
    }
    if (metaBtn) {
        metaBtn.classList.toggle('lb-chrome-active', !lbChromeMetaVisible);
        metaBtn.textContent = lbChromeMetaVisible ? '◧' : '◨';
        metaBtn.setAttribute('title', mediaTr(lbChromeMetaVisible ? 'media.lb.hideInfo' : 'media.lb.showInfo'));
        metaBtn.setAttribute('aria-pressed', lbChromeMetaVisible ? 'true' : 'false');
    }
    var edgeBtn = g('lbMetaEdgeBtn');
    if (edgeBtn) {
        var edgeTri = edgeBtn.querySelector('.xray-lb-meta-edge-tri');
        if (edgeTri) edgeTri.textContent = lbChromeMetaVisible ? '▶' : '◀';
        edgeBtn.setAttribute('title', mediaTr(lbChromeMetaVisible ? 'media.lb.hideInfo' : 'media.lb.showInfo'));
        edgeBtn.setAttribute('aria-label', mediaTr(lbChromeMetaVisible ? 'media.lb.hideInfo' : 'media.lb.showInfo'));
        edgeBtn.setAttribute('aria-pressed', lbChromeMetaVisible ? 'false' : 'true');
    }
    if (restoreBtn) {
        restoreBtn.setAttribute('aria-hidden', lbChromeMaximized ? 'false' : 'true');
    }

    requestAnimationFrame(function () {
        lbSyncLightboxScrollShell();
        if (!lbChromeMaximized) {
            lbResetScrollHost();
            lbSyncLightboxScrollShell();
        } else if (options.refitMax) {
            requestAnimationFrame(function () {
                lbFitToScrollHost();
            });
        }
    });
}

function lbToggleMaximize() {
    if (!lbChromeMaximized) {
        lbChromeScaleBeforeMax = lbTransform.scale;
        lbChromeMetaVisibleBeforeMax = lbChromeMetaVisible;
        lbChromeMaximized = true;
        // Auto-hide the info column so the image can use the full width.
        lbChromeMetaVisible = false;
        lbSyncLightboxChrome({ refitMax: true });
    } else {
        lbChromeMaximized = false;
        lbChromeMetaVisible = lbChromeMetaVisibleBeforeMax;
        lbTransform.scale = lbChromeScaleBeforeMax;
        lbSyncLightboxChrome();
    }
}

function lbToggleMetaPanel() {
    lbChromeMetaVisible = !lbChromeMetaVisible;
    lbSyncLightboxChrome({ refitMax: lbChromeMaximized });
}

function lbScrollOuterDims() {
    var w = lbLayoutBaseW * lbTransform.scale;
    var h = lbLayoutBaseH * lbTransform.scale;
    w = Math.max(1, w);
    h = Math.max(1, h);
    var rad = (lbTransform.rotate || 0) * Math.PI / 180;
    var c = Math.abs(Math.cos(rad));
    var s = Math.abs(Math.sin(rad));
    return {
        bw: Math.max(1, Math.ceil(w * c + h * s)),
        bh: Math.max(1, Math.ceil(w * s + h * c))
    };
}

function lbCaptureLayoutBaseFromImg() {
    var img = g('xrayLbImg');
    if (!img || lbIsVideo || img.style.display === 'none') return;
    lbLayoutBaseW =
        Math.max(1, img.offsetWidth || img.clientWidth || 640);
    lbLayoutBaseH =
        Math.max(1, img.offsetHeight || img.clientHeight || 480);
}

function lbCaptureLayoutBaseFromVideo() {
    var v = g('xrayLbVideo');
    if (!v || v.style.display === 'none') return;
    lbLayoutBaseW = Math.max(1,
        v.clientWidth  || Math.min(960, v.videoWidth  || 640));
    lbLayoutBaseH = Math.max(1,
        v.clientHeight || Math.min(720, v.videoHeight || 480));
}

function lbSyncLightboxScrollShell() {
    var inner = g('xrayLbScrollInner');
    var wrap  = g('lbMediaWrap');
    var img   = g('xrayLbImg');
    var vid   = g('xrayLbVideo');
    if (!inner || !wrap) return;

    var t = lbTransform;
    var filt =
        (t.invert ? 'invert(1) ' : '') +
        'brightness(' + lbBrightness + '%) contrast(' + lbContrast + '%)';
    if (img && img.style.display !== 'none') img.style.filter = filt;
    if (vid && vid.style.display !== 'none') vid.style.filter = filt;

    if (!lbLayoutBaseW || !lbLayoutBaseH) return;

    wrap.style.width  = lbLayoutBaseW + 'px';
    wrap.style.height = lbLayoutBaseH + 'px';

    var d = lbScrollOuterDims();
    inner.style.width  = d.bw + 'px';
    inner.style.height = d.bh + 'px';

    wrap.style.transform =
        'scale(' + (t.scale * (t.flipH ? -1 : 1)) + ',' +
                   (t.scale * (t.flipV ? -1 : 1)) + ') ' +
        'rotate(' + t.rotate + 'deg)';
    lbUpdateScrollHostCursor();
}

function lbUpdateScrollHostCursor() {
    var host = g('xrayLbScrollHost');
    if (!host) return;
    if (lbScrollDragging) {
        host.style.cursor = 'grabbing';
        return;
    }
    var draw = lbTool !== 'none' && lbTool !== 'pan';
    if (draw) {
        host.style.cursor = '';
        return;
    }
    host.style.cursor =
        lbTransform.scale > 1.02 ? 'grab' : 'default';
}

function lbScrollShouldHandleDrag(e) {
    if (e.button !== 0) return false;
    if (lbTool !== 'none' && lbTool !== 'pan') {
        if (e.target && e.target.id === 'xrayLbCanvas') return false;
    }
    return true;
}

function lbScrollHostMove(e) {
    if (!lbScrollDragging) return;
    var host = g('xrayLbScrollHost');
    if (!host) return;
    host.scrollLeft -= e.clientX - lbScrollLast.x;
    host.scrollTop  -= e.clientY - lbScrollLast.y;
    lbScrollLast = { x: e.clientX, y: e.clientY };
}

function lbScrollHostUp() {
    if (!lbScrollDragging) return;
    lbScrollDragging = false;
    lbUpdateScrollHostCursor();
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX
// ════════════════════════════════════════════════════════════════
function openLightbox(idx) {
    var x = xrayFiltered[idx];
    if (!x) return;
    lbCurrentId = x.id;

    // ── Reset all transform + draw state ──────────────────
    lbTransform  = { scale:1, rotate:0, flipH:false, flipV:false, invert:false };
    lbBrightness = 100; lbContrast = 100;
    lbLayoutBaseW = 0;
    lbLayoutBaseH = 0;
    lbPolyPts = []; lbDrawHistory = []; lbCropRect = null;
    lbIsDrawing = false; lbScrollDragging = false;
    lbResetScrollHost();
    lbResetLightboxChrome();

    var bs = g('lbBrightSlider');   if (bs) bs.value = 100;
    var bv = g('lbBrightVal');      if (bv) bv.textContent = '100%';
    var cs = g('lbContrastSlider'); if (cs) cs.value = 100;
    var cv = g('lbContrastVal');    if (cv) cv.textContent = '100%';
    var cab = g('lbCropApplyBtn');  if (cab) cab.style.display = 'none';
    lbSetTool('none');

    // ── Detect video vs image ─────────────────────────────
    // Match extension on URL without bucket query/cache-busters
    var bare = (x.file_url || '').split('?')[0].split('#')[0];
    lbIsVideo = /\.(mp4|webm|mov|avi|mkv|ogv)$/i.test(bare);

    var streamUrl = xrayDisplayUrl(x);

    var img   = g('xrayLbImg');
    var video = g('xrayLbVideo');
    var vg    = g('lbVideoGroup');

    if (lbIsVideo) {
        if (img)   img.style.display   = 'none';
        if (video) {
            video.style.display = 'block';
            video.src = streamUrl;
            video.onloadedmetadata = function() {
                requestAnimationFrame(function() {
                    lbCaptureLayoutBaseFromVideo();
                    lbSyncLightboxScrollShell();
                });
            };
        }
        if (vg) vg.style.display = 'flex';
    } else {
        if (video) {
            video.style.display = 'none';
            if (!video.paused) video.pause();
            video.src = '';
            video.onloadedmetadata = null;
        }
        if (vg) vg.style.display = 'none';
        if (img) {
            img.crossOrigin = 'anonymous';
            img.style.display = 'block';
            img.onload = function() {
                lbInitCanvas();
            };
            img.src = streamUrl;
            if (img.complete && streamUrl) {
                lbInitCanvas();
            }
        }
    }

    sv('lbType',  x.xray_type || '');
    sv('lbDate',  x.taken_date || '');
    sv('lbNotes', x.notes      || '');

    // Reset dirty flag and re-wire input listeners each open
    _lbMetaDirty = false;
    ['lbType','lbDate','lbNotes'].forEach(function(id) {
        var el = g(id);
        if (!el) return;
        if (el._lbDirtyBound) return;
        el._lbDirtyBound = true;
        el.addEventListener('input', function() { _lbMetaDirty = true; });
        el.addEventListener('change', function() { _lbMetaDirty = true; });
    });

    openModal('xrayLightbox');
    var lbModal = g('xrayLightbox');
    if (lbModal && typeof applyI18nInRoot === 'function') applyI18nInRoot(lbModal);
    if (typeof lbSyncLightboxChrome === 'function') lbSyncLightboxChrome();
    if (typeof xrayAiOnLightboxOpen === 'function') xrayAiOnLightboxOpen(lbCurrentId);
}

function lbHasUnsavedChanges() {
    return _lbMetaDirty || lbNeedsImagePersist();
}

function _forceCloseLightbox() {
    _lbMetaDirty = false;
    if (typeof xrayAiOnLightboxClose === 'function') xrayAiOnLightboxClose();
    var video = g('xrayLbVideo');
    if (video && !video.paused) video.pause();
    closeModal('xrayLightbox');
    lbCurrentId = null;
    lbChromeMaximized = false;
    lbChromeMetaVisible = true;
    lbChromeMetaVisibleBeforeMax = true;
    lbChromeScaleBeforeMax = 1;
    var modal = g('xrayLightbox');
    if (modal) modal.classList.remove('xray-lb-maximized');
    var main = g('xrayLbMain');
    if (main) main.classList.remove('xray-lb-meta-hidden');
}

function closeLightbox() {
    // If the lightbox has unsaved image edits or metadata changes, prompt first
    if (lbCurrentId && lbHasUnsavedChanges()) {
        if (typeof showMediaUnsavedOverlay === 'function') {
            showMediaUnsavedOverlay(
                'xrayLightbox',
                function() { saveLbMeta(); },     // Save & Close (saveLbMeta calls closeLightbox after save)
                function() { _forceCloseLightbox(); }  // Discard & Close
            );
            return;
        }
    }
    _forceCloseLightbox();
}

function applyLbTransform() {
    lbSyncLightboxScrollShell();
}

function lbZoom(f) {
    lbTransform.scale *= f;
    if (lbTransform.scale < 0.12) lbTransform.scale = 0.12;
    if (lbTransform.scale > 14)  lbTransform.scale = 14;
    applyLbTransform();
}
function lbRotate(d) { lbTransform.rotate  = (lbTransform.rotate + d) % 360; applyLbTransform(); }
function lbFlip(a)   { if (a === 'h') lbTransform.flipH = !lbTransform.flipH; else lbTransform.flipV = !lbTransform.flipV; applyLbTransform(); }
function lbInvert()  { lbTransform.invert  = !lbTransform.invert; applyLbTransform(); }
function lbReset() {
    lbTransform  = { scale:1, rotate:0, flipH:false, flipV:false, invert:false };
    lbBrightness = 100; lbContrast = 100;
    var bs = g('lbBrightSlider');   if (bs) bs.value = 100;
    var bv = g('lbBrightVal');      if (bv) bv.textContent = '100%';
    var cs = g('lbContrastSlider'); if (cs) cs.value = 100;
    var cv = g('lbContrastVal');    if (cv) cv.textContent = '100%';
    lbResetScrollHost();
    applyLbTransform();
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — TOOL SWITCHING
// ════════════════════════════════════════════════════════════════
function lbSetTool(tool) {
    lbTool    = tool;
    lbPolyPts = [];
    var canvas = g('xrayLbCanvas');
    if (canvas) {
        var isDrawTool = (tool !== 'none' && tool !== 'pan');
        canvas.style.pointerEvents = isDrawTool ? 'all' : 'none';
        canvas.style.cursor        = isDrawTool ? 'crosshair' : 'default';
    }
    if (tool !== 'crop') {
        lbCropRect = null;
        var cab = g('lbCropApplyBtn');
        if (cab) cab.style.display = 'none';
    }
    lbUpdateToolBtns();
    lbUpdateScrollHostCursor();
}

function lbUpdateToolBtns() {
    ['pan','free','line','arrow','rect','ellipse','poly','crop'].forEach(function(t) {
        var b = g('lbTBtn-' + t);
        if (b) b.classList.toggle('lb-tool-active', lbTool === t);
    });
    var bAnnot = g('lbBtnAnnotText');
    if (bAnnot) bAnnot.classList.toggle('lb-meta-tool-active', lbTool === 'text');
}

function lbSetColor(val)       { lbDrawColor   = val; }
function lbSetStrokeWidth(val) { lbStrokeWidth = parseInt(val) || 4; }

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — BRIGHTNESS & CONTRAST
// ════════════════════════════════════════════════════════════════
function lbSetBrightness(val) {
    lbBrightness = parseInt(val) || 100;
    var el = g('lbBrightVal'); if (el) el.textContent = lbBrightness + '%';
    applyLbTransform();
}
function lbSetContrast(val) {
    lbContrast = parseInt(val) || 100;
    var el = g('lbContrastVal'); if (el) el.textContent = lbContrast + '%';
    applyLbTransform();
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — CANVAS INIT & HISTORY
// ════════════════════════════════════════════════════════════════
function lbInitCanvas() {
    var canvas = g('xrayLbCanvas');
    var img    = g('xrayLbImg');
    if (!canvas || !img || lbIsVideo) return;
    lbCaptureLayoutBaseFromImg();
    canvas.width  = img.offsetWidth  || 800;
    canvas.height = img.offsetHeight || 600;
    lbDrawHistory = [];
    lbSyncLightboxScrollShell();
    if (typeof xrayAiOnCanvasResize === 'function') xrayAiOnCanvasResize();
}

function lbSaveHistory() {
    var canvas = g('xrayLbCanvas');
    if (!canvas) return;
    lbDrawHistory.push(canvas.getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height));
    if (lbDrawHistory.length > 20) lbDrawHistory.shift();
}

function lbUndoDraw() {
    var canvas = g('xrayLbCanvas');
    if (!canvas) return;
    lbPolyPts = [];
    var ctx = canvas.getContext('2d');
    if (!lbDrawHistory.length) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    ctx.putImageData(lbDrawHistory.pop(), 0, 0);
}

function lbClearCanvas() {
    var canvas = g('xrayLbCanvas');
    if (!canvas) return;
    lbSaveHistory();
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    lbPolyPts = [];
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — CANVAS DRAWING
// ════════════════════════════════════════════════════════════════
function lbGetPos(e) {
    var canvas = g('xrayLbCanvas');
    var rect   = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width  / rect.width),
        y: (e.clientY - rect.top)  * (canvas.height / rect.height)
    };
}

function lbCtxStyle(ctx) {
    ctx.strokeStyle = lbDrawColor;
    ctx.fillStyle   = lbDrawColor;
    ctx.lineWidth   = lbStrokeWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
}

function lbDrawShape(ctx, s, e, tool) {
    var w = e.x - s.x, h = e.y - s.y;
    lbCtxStyle(ctx);
    ctx.beginPath();
    if (tool === 'line') {
        ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    } else if (tool === 'arrow') {
        lbDrawArrowShape(ctx, s.x, s.y, e.x, e.y);
    } else if (tool === 'rect') {
        ctx.strokeRect(s.x, s.y, w, h);
    } else if (tool === 'ellipse') {
        var rx = Math.abs(w) / 2 || 1, ry = Math.abs(h) / 2 || 1;
        ctx.ellipse(s.x + w / 2, s.y + h / 2, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
    } else if (tool === 'crop') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(s.x, s.y, w, h);
        ctx.setLineDash([]);
    }
}

function lbDrawArrowShape(ctx, x1, y1, x2, y2) {
    var hl  = Math.max(14, lbStrokeWidth * 3);
    var ang = Math.atan2(y2 - y1, x2 - x1);
    lbCtxStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hl * Math.cos(ang - Math.PI / 6), y2 - hl * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - hl * Math.cos(ang + Math.PI / 6), y2 - hl * Math.sin(ang + Math.PI / 6));
    ctx.closePath(); ctx.fill();
}

function lbRedrawPoly() {
    var canvas = g('xrayLbCanvas');
    var ctx    = canvas.getContext('2d');
    if (lbDrawHistory.length) ctx.putImageData(lbDrawHistory[lbDrawHistory.length - 1], 0, 0);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lbPolyPts.length) return;
    lbCtxStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(lbPolyPts[0].x, lbPolyPts[0].y);
    for (var i = 1; i < lbPolyPts.length; i++) ctx.lineTo(lbPolyPts[i].x, lbPolyPts[i].y);
    ctx.stroke();
    lbPolyPts.forEach(function(p) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    });
}

function lbPlaceTextAnnot(pos) {
    var canvas = g('xrayLbCanvas');
    if (!canvas) return;
    var inp = g('lbAnnotTextInput');
    var txt = inp ? (inp.value || '').trim() : '';
    if (!txt) txt = 'Text';

    var fontPx = parseInt(g('lbTextFontSize').value, 10) || 24;
    if (fontPx < 8) fontPx = 8;

    lbSaveHistory();
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.font = 'bold ' + fontPx +
        'px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth  = Math.max(3, Math.round(lbStrokeWidth * 0.75));
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle   = lbDrawColor;
    ctx.strokeText(txt, pos.x, pos.y);
    ctx.fillText(txt, pos.x, pos.y);
    ctx.restore();
}

function lbCanvasDown(e) {
    var pos = lbGetPos(e);
    if (lbTool === 'text') {
        lbPlaceTextAnnot(pos);
        return;
    }
    if (lbTool === 'poly') {
        if (!lbPolyPts.length) lbSaveHistory();
        lbPolyPts.push(pos);
        lbRedrawPoly();
        return;
    }
    lbSaveHistory();
    lbIsDrawing = true;
    lbDrawStart = pos;
    if (lbTool === 'free') {
        var ctx = g('xrayLbCanvas').getContext('2d');
        lbCtxStyle(ctx);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    }
}

function lbCanvasMove(e) {
    if (!lbIsDrawing) return;
    var pos    = lbGetPos(e);
    var canvas = g('xrayLbCanvas');
    var ctx    = canvas.getContext('2d');
    if (lbTool === 'free') {
        lbCtxStyle(ctx);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        return;
    }
    // Restore last saved snapshot then draw live preview
    if (lbDrawHistory.length) ctx.putImageData(lbDrawHistory[lbDrawHistory.length - 1], 0, 0);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
    lbDrawShape(ctx, lbDrawStart, pos, lbTool);
}

function lbCanvasUp(e) {
    if (!lbIsDrawing) return;
    lbIsDrawing = false;
    var pos    = lbGetPos(e);
    var canvas = g('xrayLbCanvas');
    var ctx    = canvas.getContext('2d');
    if (lbTool === 'crop') {
        lbCropRect = {
            x: Math.min(lbDrawStart.x, pos.x),
            y: Math.min(lbDrawStart.y, pos.y),
            w: Math.abs(pos.x - lbDrawStart.x),
            h: Math.abs(pos.y - lbDrawStart.y)
        };
        if (lbDrawHistory.length) ctx.putImageData(lbDrawHistory[lbDrawHistory.length - 1], 0, 0);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
        lbDrawShape(ctx, lbDrawStart, pos, 'crop');
        var btn = g('lbCropApplyBtn');
        if (btn && lbCropRect.w > 5 && lbCropRect.h > 5) btn.style.display = 'block';
        return;
    }
    if (lbTool !== 'free') {
        if (lbDrawHistory.length) ctx.putImageData(lbDrawHistory[lbDrawHistory.length - 1], 0, 0);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
        lbDrawShape(ctx, lbDrawStart, pos, lbTool);
    } else {
        ctx.closePath();
    }
}

function lbCanvasDblClick(e) {
    if (lbTool === 'poly' && lbPolyPts.length >= 2) {
        var canvas = g('xrayLbCanvas');
        var ctx    = canvas.getContext('2d');
        lbCtxStyle(ctx);
        ctx.beginPath();
        ctx.moveTo(lbPolyPts[0].x, lbPolyPts[0].y);
        lbPolyPts.forEach(function(p) { ctx.lineTo(p.x, p.y); });
        ctx.closePath(); ctx.stroke();
        lbPolyPts = [];
    }
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — CROP APPLY
// ════════════════════════════════════════════════════════════════
function lbCropApply() {
    if (!lbCropRect || lbCropRect.w < 5 || lbCropRect.h < 5) return;
    var canvas = g('xrayLbCanvas');
    var img    = g('xrayLbImg');
    if (!canvas || !img) return;
    var tmp   = document.createElement('canvas');
    tmp.width  = lbCropRect.w;
    tmp.height = lbCropRect.h;
    var tCtx  = tmp.getContext('2d');
    try {
        var sx = img.naturalWidth  / canvas.width;
        var sy = img.naturalHeight / canvas.height;
        tCtx.drawImage(img,
            lbCropRect.x * sx, lbCropRect.y * sy,
            lbCropRect.w * sx, lbCropRect.h * sy,
            0, 0, tmp.width, tmp.height);
        tCtx.drawImage(canvas,
            lbCropRect.x, lbCropRect.y, lbCropRect.w, lbCropRect.h,
            0, 0, tmp.width, tmp.height);
    } catch (err) {
        alert(mediaTr('media.alert.cropFail'));
        return;
    }
    img.crossOrigin = 'anonymous';
    img.onload = function() { lbInitCanvas(); };
    img.src    = tmp.toDataURL('image/jpeg', 0.95);
    lbCropRect = null;
    var cab = g('lbCropApplyBtn'); if (cab) cab.style.display = 'none';
    lbDrawHistory = [];
    lbSetTool('none');
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — PRINT
// ════════════════════════════════════════════════════════════════
function lbPrint() {
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
    var img    = g('xrayLbImg');
    var canvas = g('xrayLbCanvas');
    var video  = g('xrayLbVideo');
    var src    = '';

    if (lbIsVideo) {
        if (video && video.readyState >= 2) {
            var tmp2   = document.createElement('canvas');
            tmp2.width  = video.videoWidth  || 640;
            tmp2.height = video.videoHeight || 480;
            tmp2.getContext('2d').drawImage(video, 0, 0);
            src = tmp2.toDataURL('image/jpeg', 0.95);
        } else {
            alert(mediaTr('media.alert.noVideoFrame')); return;
        }
    } else {
        if (!img || !img.src) return;
        try {
            var merged   = document.createElement('canvas');
            merged.width  = canvas.width  || img.naturalWidth  || 800;
            merged.height = canvas.height || img.naturalHeight || 600;
            var mCtx = merged.getContext('2d');
            mCtx.filter =
                (lbTransform.invert ? 'invert(1) ' : '') +
                'brightness(' + lbBrightness + '%) contrast(' + lbContrast + '%)';
            mCtx.drawImage(img, 0, 0, merged.width, merged.height);
            mCtx.filter = 'none';
            mCtx.save();
            mCtx.scale(
                merged.width  / (canvas.width  || 1),
                merged.height / (canvas.height || 1)
            );
            mCtx.drawImage(canvas, 0, 0);
            mCtx.restore();
            src = merged.toDataURL('image/jpeg', 0.95);
        } catch (err) {
            src = img.src; // CORS fallback
        }
    }

    var w = window.open('', '_blank', 'width=920,height=720');
    if (!w) { alert(mediaTr('media.alert.popupBlocked')); return; }
    w.document.write(
        '<!DOCTYPE html><html><head>' +
        '<style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh;}' +
        'img{max-width:100%;max-height:100vh;}</style></head><body>' +
        '<script>' +
        (typeof printPopupAutoCloseInlineScript === 'function' ? printPopupAutoCloseInlineScript() : '') +
        '<\/script>' +
        '<img src="' + src + '" onload="try{window.print();}catch(e){if(typeof __ppClose===\'function\')__ppClose();}">' +
        '</body></html>'
    );
    w.document.close();
    if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(w);
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — VIDEO CONTROLS
// ════════════════════════════════════════════════════════════════
function lbVidStart() {
    var v = g('xrayLbVideo'); if (v) v.currentTime = 0;
}
function lbVidBack() {
    var v = g('xrayLbVideo'); if (v) v.currentTime = Math.max(0, v.currentTime - 10);
}
function lbVidPlayPause() {
    var v = g('xrayLbVideo'), btn = g('lbVidPlayBtn');
    if (!v) return;
    if (v.paused) { v.play();  if (btn) btn.textContent = '⏸'; }
    else          { v.pause(); if (btn) btn.textContent = '▶️'; }
}
function lbVidFwd() {
    var v = g('xrayLbVideo'); if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
}
function lbVidEnd() {
    var v = g('xrayLbVideo'); if (v && v.duration) v.currentTime = v.duration;
}
function lbVidStop() {
    var v = g('xrayLbVideo'), btn = g('lbVidPlayBtn');
    if (!v) return;
    v.pause(); v.currentTime = 0;
    if (btn) btn.textContent = '▶️';
}
function lbVidSeekTo(pct) {
    var v = g('xrayLbVideo');
    if (v && v.duration) v.currentTime = (pct / 100) * v.duration;
}

// ════════════════════════════════════════════════════════════════
// LIGHTBOX — MERGE VISUAL EDIT → BLOB / PERSIST HELPERS
// ════════════════════════════════════════════════════════════════
function lbOverlayHasInk() {
    var canvas = g('xrayLbCanvas');
    if (!canvas || !canvas.width || !canvas.height) return false;
    try {
        var d = canvas.getContext('2d').getImageData(
            0, 0, canvas.width, canvas.height
        ).data;
        var lim = canvas.width * canvas.height * 4;
        for (var i = 3; i < lim; i += 16) {
            if (d[i] > 10) return true;
        }
    } catch (err) {
        return false;
    }
    return false;
}

function lbOrientChanged() {
    var rot = ((lbTransform.rotate % 360) + 360) % 360;
    return rot !== 0 || !!lbTransform.flipH || !!lbTransform.flipV;
}

function lbNeedsImagePersist() {
    if (lbIsVideo) return false;
    var img = g('xrayLbImg');
    if (img && img.src && img.src.indexOf('data:image') === 0) return true;
    if (lbOrientChanged()) return true;
    if (lbBrightness !== 100 || lbContrast !== 100 || lbTransform.invert) {
        return true;
    }
    return lbOverlayHasInk();
}

// Bake rotate/flip into a new canvas, matching the on-screen CSS transform
// order (scale/flip first, then rotate). Returns src unchanged if no
// orientation change is active.
function lbBakeOrient(src) {
    if (!src || !lbOrientChanged()) return src;
    var rot  = ((lbTransform.rotate % 360) + 360) % 360;
    var fH   = !!lbTransform.flipH;
    var fV   = !!lbTransform.flipV;
    var sw   = src.width;
    var sh   = src.height;
    var swap = (rot === 90 || rot === 270);

    var out = document.createElement('canvas');
    out.width  = swap ? sh : sw;
    out.height = swap ? sw : sh;

    var ctx = out.getContext('2d');
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.scale(fH ? -1 : 1, fV ? -1 : 1);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
    return out;
}

// JPEG Blob from canvas — toBlob fallback (some browsers filter/taint ⇒ null blob)
function canvasToJpegBlob(canvas, quality, callback) {
    if (!canvas) {
        callback(null);
        return;
    }
    var q = (quality === undefined ? 0.92 : quality);
    canvas.toBlob(function(blob) {
        if (blob && blob.size > 0) {
            callback(blob);
            return;
        }
        try {
            var data = canvas.toDataURL('image/jpeg', q);
            if (!data || data.indexOf('data:image/jpeg') !== 0) {
                callback(null);
                return;
            }
            var parts = data.split(',');
            if (parts.length < 2) {
                callback(null);
                return;
            }
            var bstr = atob(parts[1]);
            var n    = bstr.length;
            var u8   = new Uint8Array(n);
            for (var i = 0; i < n; i++) {
                u8[i] = bstr.charCodeAt(i);
            }
            callback(new Blob([u8], { type: 'image/jpeg' }));
        } catch (e) {
            callback(null);
        }
    }, 'image/jpeg', q);
}

function lbBuildMergedImageBlobInner(callback) {
    var img    = g('xrayLbImg');
    var canvas = g('xrayLbCanvas');
    if (!img || !canvas || lbIsVideo ||
        !img.complete || img.naturalWidth === 0) {
        callback(null); return;
    }
    try {
        var nw = img.naturalWidth;
        var nh = img.naturalHeight;
        var cw = canvas.width  || 1;
        var ch = canvas.height || 1;

        var merged = document.createElement('canvas');
        merged.width  = nw;
        merged.height = nh;
        var mCtx = merged.getContext('2d');

        mCtx.filter =
            (lbTransform.invert ? 'invert(1) ' : '') +
            'brightness(' + lbBrightness + '%) contrast(' + lbContrast + '%)';
        mCtx.drawImage(img, 0, 0, nw, nh);
        mCtx.filter = 'none';
        mCtx.save();
        mCtx.scale(nw / cw, nh / ch);
        mCtx.drawImage(canvas, 0, 0);
        mCtx.restore();

        canvasToJpegBlob(lbBakeOrient(merged), 0.92, callback);
    } catch (err) {
        callback(null);
    }
}

// Fallback: merge using a fresh fetch of the stored object (handles tainted canvases).
function lbComposeMergeViaFetch(record, callback) {
    var bare = (xrayBareUrl(record) || '').split('#')[0];
    bare = bare.split('?')[0];
    if (!bare) {
        callback(null); return;
    }

    fetch(bare, { mode: 'cors', credentials: 'omit', cache: 'no-store' })
        .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.blob();
        })
        .then(function(blob) {
            var objUrl = URL.createObjectURL(blob);
            var im     = new Image();
            im.onload = function() {
                URL.revokeObjectURL(objUrl);
                try {
                    var canvasOv = g('xrayLbCanvas');
                    var nw = im.naturalWidth || im.width;
                    var nh = im.naturalHeight || im.height;
                    if (!nw || !nh || !canvasOv) throw new Error('merge');
                    var cw = canvasOv.width  || 1;
                    var ch = canvasOv.height || 1;

                    var merged = document.createElement('canvas');
                    merged.width  = nw;
                    merged.height = nh;
                    var mCtx = merged.getContext('2d');

                    mCtx.filter =
                        (lbTransform.invert ? 'invert(1) ' : '') +
                        'brightness(' + lbBrightness + '%) contrast(' + lbContrast + '%)';
                    mCtx.drawImage(im, 0, 0, nw, nh);
                    mCtx.filter = 'none';
                    mCtx.save();
                    mCtx.scale(nw / cw, nh / ch);
                    mCtx.drawImage(canvasOv, 0, 0);
                    mCtx.restore();

                    canvasToJpegBlob(lbBakeOrient(merged), 0.92, callback);
                } catch (e3) {
                    callback(null);
                }
            };
            im.onerror = function() {
                URL.revokeObjectURL(objUrl);
                callback(null);
            };
            im.crossOrigin = 'anonymous';
            im.src = objUrl;
        })
        .catch(function() {
            callback(null);
        });
}

function lbExportEditedJpegForSave(callback) {
    lbBuildMergedImageBlobInner(function(blob) {
        if (blob && blob.size > 0) {
            callback(blob);
            return;
        }
        var recRow = xrayAllRecords.find(function(x) {
            return x.id === lbCurrentId;
        });
        if (!recRow || lbIsVideo) {
            callback(null);
            return;
        }
        lbComposeMergeViaFetch(recRow, function(blob2) {
            callback((blob2 && blob2.size > 0) ? blob2 : null);
        });
    });
}

function saveLbMeta() {
    if (!lbCurrentId) return;

    var rec = xrayAllRecords.find(function(x) { return x.id === lbCurrentId; });

    function finishOk(msg) {
        _lbMetaDirty = false;   // clear before close so no re-prompt
        _forceCloseLightbox();
        loadXrayRecords().then(function() {
            alert(msg || mediaTr('media.alert.savedDefault'));
        });
    }

    function saveMetaOnly() {
        var payload = {
            xray_type:  g('lbType').value,
            taken_date: g('lbDate').value  || null,
            notes:      g('lbNotes').value || null
        };
        SB.from('xrays').update(payload).eq('id', lbCurrentId)
            .then(function(r) {
                if (r.error) { alert(mediaErr(r.error.message)); return; }
                finishOk(mediaTr('media.alert.xrayDetailsSaved'));
            });
    }

    if (lbIsVideo || !lbNeedsImagePersist()) {
        saveMetaOnly();
        return;
    }

    lbExportEditedJpegForSave(function(blob) {
        if (!blob) {
            alert(mediaTr('media.alert.exportEditFail'));
            saveMetaOnly();
            return;
        }

        if (!xrayPatientId) {
            alert(mediaTr('media.alert.patientContextMissingNotes'));
            saveMetaOnly();
            return;
        }

        var safeName = xrayPatientId + '/' +
            Date.now() + '_' +
            Math.random().toString(36).slice(2) + '.jpg';

        var oldPath = rec && rec.file_path;

        SB.storage.from(XRAY_BUCKET)
            .upload(safeName, blob, {
                cacheControl: '3600',
                upsert     : false,
                contentType: 'image/jpeg'
            })
            .then(function(up) {
                if (up.error) {
                    alert(mediaTrRepl('media.alert.uploadFailedMetaOnly', { MSG: up.error.message }));
                    saveMetaOnly();
                    return null;
                }
                var publicUrl = xrayGetPublicUrlForPath(safeName);

                if (!publicUrl) {
                    alert(mediaTrRepl('media.alert.publicUrlFail', { BUCKET: XRAY_BUCKET }));
                    saveMetaOnly();
                    return null;
                }

                var chain = Promise.resolve();
                if (oldPath && oldPath !== safeName) {
                    chain = SB.storage.from(XRAY_BUCKET)
                        .remove([oldPath])
                        .then(function() {}, function() {});
                }

                return chain.then(function() {
                    var payload = {
                        xray_type:  g('lbType').value,
                        taken_date: g('lbDate').value  || null,
                        notes:      g('lbNotes').value || null,
                        file_path:  safeName,
                        file_url:   publicUrl,
                        file_name:  (rec && rec.file_name)
                            ? 'edited-' + rec.file_name
                            : 'edited-xray.jpg',
                        file_size:  blob.size
                    };
                    return SB.from('xrays')
                        .update(payload)
                        .eq('id', lbCurrentId);
                });
            })
            .then(function(r) {
                if (!r) return;
                if (r.error) {
                    alert(mediaTrRepl('media.alert.dbUpdateFailXray', { MSG: r.error.message }));
                    return;
                }
                finishOk(mediaTr('media.alert.xraySavedFull'));
            });
    });
}

function deleteLbXray() {
    if (!lbCurrentId) return;
    if (!confirm(mediaTr('media.alert.confirmDeleteXray'))) return;

    var rec = xrayAllRecords.find(function(x) { return x.id === lbCurrentId; });
    var chain = Promise.resolve();

    if (rec && rec.file_path) {
        chain = SB.storage.from(XRAY_BUCKET)
            .remove([rec.file_path])
            .then(function(r) {
                if (r.error) console.warn('[X-Ray] Storage delete:', r.error.message);
            });
    }

    chain.then(function() {
        return SB.from('xrays').delete().eq('id', lbCurrentId);
    }).then(function(r) {
        if (r.error) { alert(mediaErr(r.error.message)); return; }
        closeLightbox();
        loadXrayRecords();
        if (typeof conPatientId !== 'undefined' && conPatientId &&
            typeof xrayPatientId !== 'undefined' && xrayPatientId &&
            String(conPatientId) === String(xrayPatientId) &&
            typeof loadConPatientTimeline === 'function') {
            loadConPatientTimeline(conPatientId);
        }
    });
}

function downloadLbXray() {
    var rec = xrayAllRecords.find(function(x) { return x.id === lbCurrentId; });
    if (!rec || !rec.file_url) return;
    downloadFile(xrayDisplayUrl(rec), 'xray-' + (rec.xray_type || 'image') + '.jpg');
}

// ════════════════════════════════════════════════════════════════
// UPLOAD FLOW
// Wire file input and confirm button after DOM is ready.
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
    loadXrayLocalPaths();
    seedXrayLocalPathsFromDesktop();

    var localFi = g('xrayLocalFolderInput');
    if (localFi) {
        localFi.addEventListener('change', function() {
            if (!localFi.files || !localFi.files.length) return;
            importXrayFilesFromLocalPicker(
                localFi.files,
                xrayPendingLocalImportKey || '_general'
            );
            localFi.value = '';
            xrayPendingLocalImportKey = null;
        });
    }

    // ── File upload ──────────────────────────────────────────
    var fi = g('xrayFileInput');
    if (fi) {
        fi.addEventListener('change', function() {
            if (!xrayPatientId) {
                alert(mediaTr('con.forms.alertSelectPatient'));
                fi.value = '';
                return;
            }
            if (!fi.files || !fi.files.length) return;
            xrayUploadQueue = Array.from(fi.files);
            xrayUploadQIdx  = 0;
            processNextUpload();
            fi.value = '';
        });
    }

    var confirmBtn = g('btnConfirmUpload');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', confirmUpload);
    }

    // ── Lightbox: drag-to-pan scroll area (scrollbars + grab) ─
    var lbHost = g('xrayLbScrollHost');
    if (lbHost) {
        lbHost.addEventListener('mousedown', function(e) {
            if (!lbScrollShouldHandleDrag(e)) return;
            lbScrollDragging = true;
            lbScrollLast = { x: e.clientX, y: e.clientY };
            lbHost.style.cursor = 'grabbing';
            e.preventDefault();
        });
    }
    document.addEventListener('mousemove', lbScrollHostMove);
    document.addEventListener('mouseup', lbScrollHostUp);

    // ── Lightbox: drawing canvas ──────────────────────────────
    var lbCvs = g('xrayLbCanvas');
    if (lbCvs) {
        lbCvs.addEventListener('mousedown',  lbCanvasDown);
        lbCvs.addEventListener('mousemove',  lbCanvasMove);
        lbCvs.addEventListener('mouseup',    lbCanvasUp);
        lbCvs.addEventListener('dblclick',   lbCanvasDblClick);
        lbCvs.addEventListener('mouseleave', function(e) { if (lbIsDrawing) lbCanvasUp(e); });
    }
});

function processNextUpload() {
    if (xrayUploadQIdx >= xrayUploadQueue.length) {
        closeModal('xrayUploadModal');
        loadXrayRecords();
        return;
    }
    showUploadModal(xrayUploadQueue[xrayUploadQIdx]);
}

function showUploadModal(file) {
    var wrap = g('uploadPreviewWrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    var reader = new FileReader();
    reader.onload = function(e) {
        if (file.type.startsWith('image/')) {
            wrap.innerHTML =
                '<img src="' + e.target.result + '" ' +
                'style="max-width:100%;max-height:200px;' +
                'object-fit:contain;border-radius:8px;' +
                'border:1px solid #eee;">';
        } else {
            wrap.innerHTML =
                '<div style="padding:20px;background:#1a1a2e;' +
                'color:#aaa;border-radius:8px;font-size:13px;">' +
                '📄 ' + esc(file.name) + '</div>';
        }
    };
    reader.readAsDataURL(file);

    sv('uploadType',  'Periapical');
    sv('uploadDate',  todayISO());
    sv('uploadNotes', '');

    var info = g('uploadMultiInfo');
    if (info) {
        var remaining = xrayUploadQueue.length - xrayUploadQIdx;
        info.textContent = remaining > 1
            ? mediaTrRepl('media.upload.fileOf', {
                N: String(xrayUploadQIdx + 1),
                TOTAL: String(xrayUploadQueue.length)
            })
            : '';
    }

    openModal('xrayUploadModal');
}

// ════════════════════════════════════════════════════════════════
// CONFIRM UPLOAD  — storage → public URL → DB insert
// ════════════════════════════════════════════════════════════════
function confirmUpload() {
    var file  = xrayUploadQueue[xrayUploadQIdx];
    var type  = g('uploadType').value || 'Other';
    var date  = g('uploadDate').value || todayISO();
    var notes = (g('uploadNotes').value || '').trim();
    closeModal('xrayUploadModal');
    uploadSingleXrayFile(file, type, date, notes, function() {
        xrayUploadQIdx++;
        processNextUpload();
    });
}

function uploadSingleXrayFile(file, type, date, notes, onDone) {
    if (!file || !xrayPatientId) return;
    showUploadProgress(true, mediaTr('media.upload.preparing'), 5);

    var ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
    var safeName = xrayPatientId + '/' +
                   Date.now() + '_' +
                   Math.random().toString(36).slice(2) + '.' + ext;

    var mimeMap = {
        'jpg' : 'image/jpeg', 'jpeg': 'image/jpeg',
        'png' : 'image/png',  'bmp' : 'image/bmp',
        'tiff': 'image/tiff', 'tif' : 'image/tiff',
        'webp': 'image/webp', 'dcm' : 'application/dicom'
    };
    var contentType = file.type || mimeMap[ext] || 'application/octet-stream';

    showUploadProgress(true, mediaTr('media.upload.uploadingStorage'), 20);

    SB.storage.from(XRAY_BUCKET)
        .upload(safeName, file, {
            cacheControl: '3600',
            upsert      : false,
            contentType : contentType
        })
    .then(function(r) {
        if (r.error) {
            showUploadProgress(false);
            var msg = r.error.message || mediaTr('media.err.unknown');

            if (msg.toLowerCase().includes('bucket not found')) {
                showXrayError(
                    mediaTr('media.err.bucketNotFoundTitle'),
                    mediaTrRepl('media.err.bucketNotFoundHtml', { BUCKET: XRAY_BUCKET })
                );
            } else if (/policy|unauthorized|not allowed/i.test(msg)) {
                showXrayError(
                    mediaTr('media.err.permissionTitle'),
                    mediaTrRepl('media.err.permissionHtml', { BUCKET: XRAY_BUCKET })
                );
            } else if (/duplicate|already exists/i.test(msg)) {
                safeName = xrayPatientId + '/' +
                           Date.now() + '_retry_' +
                           Math.random().toString(36).slice(2) + '.' + ext;
                return SB.storage.from(XRAY_BUCKET)
                    .upload(safeName, file, {
                        cacheControl: '3600',
                        upsert      : true,
                        contentType : contentType
                    });
            } else {
                showXrayError(
                    mediaTr('media.err.uploadFailedTitle'),
                    esc(mediaTrRepl('media.alert.error', { MSG: msg }))
                );
            }
            return null;
        }
        showUploadProgress(true, mediaTr('media.upload.gettingUrl'), 60);
        return { ok: true, path: safeName };
    })
    .then(function(res) {
        if (!res || !res.ok) return null;

        var publicUrl = xrayGetPublicUrlForPath(res.path);

        showUploadProgress(true, mediaTr('media.upload.savingRecord'), 80);

        return SB.from('xrays').insert([{
            patient_id  : xrayPatientId,
            patient_no  : (xrayPatientData && xrayPatientData.patient_no)  || null,
            patient_name: (xrayPatientData && xrayPatientData.full_name)   || null,
            file_path   : res.path,
            file_url    : publicUrl,
            file_name   : file.name,
            file_size   : file.size,
            xray_type   : type,
            taken_date  : date  || null,
            notes       : notes || null,
            uploaded_by : (typeof currentName !== 'undefined' ? currentName : null)
        }]);
    })
    .then(function(r) {
        if (!r) return;
        if (r.error) {
            showUploadProgress(false);
            showXrayError(
                mediaTr('media.err.dbTitle'),
                mediaTrRepl('media.err.dbHtml', { MSG: r.error.message })
            );
            return;
        }
        showUploadProgress(true, mediaTr('media.upload.done'), 100);
        setTimeout(function() {
            showUploadProgress(false);
            if (onDone) onDone();
        }, 700);
    })
    .catch(function(err) {
        showUploadProgress(false);
        showXrayError(
            mediaTr('media.err.unexpectedTitle'),
            esc(err.message || String(err))
        );
    });
}

// ════════════════════════════════════════════════════════════════
// UI HELPERS — progress bar & error banner
// ════════════════════════════════════════════════════════════════
function showUploadProgress(show, label, pct) {
    var bar = g('xrayUploadProgress');
    if (!bar) return;
    bar.style.display = show ? 'block' : 'none';
    if (!show) return;
    var fill  = g('xrayProgressFill');
    var lbl   = g('xrayProgressLabel');
    if (fill) fill.style.width    = (pct || 0) + '%';
    if (lbl)  lbl.textContent     = label || '';
}

function showXrayError(title, htmlMsg) {
    var old = g('xrayErrorBanner');
    if (old) old.remove();

    var div = document.createElement('div');
    div.id = 'xrayErrorBanner';
    div.style.cssText =
        'background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;' +
        'padding:14px 16px;font-size:13px;color:#7f1d1d;' +
        'margin-bottom:8px;line-height:1.7;';
    div.innerHTML =
        '<div style="display:flex;justify-content:space-between;' +
        'align-items:flex-start;">' +
            '<strong style="font-size:14px;">' + title + '</strong>' +
            '<button onclick="var b=document.getElementById(\'xrayErrorBanner\');' +
            'if(b)b.remove();" ' +
            'style="background:none;border:none;cursor:pointer;' +
            'font-size:18px;color:#7f1d1d;padding:0 0 0 12px;">×</button>' +
        '</div>' +
        '<div style="margin-top:6px;">' + htmlMsg + '</div>';

    var main = g('xrayMainContent');
    if (main) main.insertBefore(div, main.firstChild);
    else      document.body.appendChild(div);

    div.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ════════════════════════════════════════════════════════════════
// EXPORT  (selected or all)
// ════════════════════════════════════════════════════════════════
function exportSelectedXrays() {
    if (!xraySelected.size) {
        alert(mediaTr('media.alert.selectXrayExport'));
        return;
    }
    var toExport = xrayFiltered.filter(function(x) {
        return xraySelected.has(x.id);
    });
    toExport.forEach(function(x, i) {
        setTimeout(function() {
            downloadFile(xrayDisplayUrl(x),
                'xray-' + (x.xray_type || 'image') + '-' + i + '.jpg');
        }, i * 400);
    });
}

function exportAllXrays() {
    if (!xrayFiltered.length) { alert(mediaTr('media.alert.noXraysExport')); return; }
    if (!confirm(mediaTrRepl('media.alert.confirmDownloadXrays', { N: String(xrayFiltered.length) }))) return;
    xrayFiltered.forEach(function(x, i) {
        setTimeout(function() {
            downloadFile(xrayDisplayUrl(x),
                'xray-' + (x.xray_type || 'image') + '-' + i + '.jpg');
        }, i * 500);
    });
}

function downloadFile(url, filename) {
    if (!url) { alert(mediaTr('media.alert.noFileUrl')); return; }

    fetch(url)
        .then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.blob();
        })
        .then(function(blob) {
            var blobUrl = URL.createObjectURL(blob);
            var a       = document.createElement('a');
            a.href      = blobUrl;
            a.download  = filename || 'xray.jpg';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 10000);
        })
        .catch(function(err) {
            console.warn('[X-Ray] Download error:', err.message);
            alert(mediaTrRepl('media.alert.downloadFailed', { MSG: err.message }));
        });
}
// ════════════════════════════════════════════════════════════════
// SELECT ALL
// ════════════════════════════════════════════════════════════════
function toggleSelectAll(checked) {
    xrayFiltered.forEach(function(x) {
        if (checked) xraySelected.add(x.id);
        else         xraySelected.delete(x.id);
    });
    document.querySelectorAll('.xray-cb').forEach(function(cb) {
        cb.checked = checked;
    });
    updateSelectedCount();
}

function updateSelectedCount() {
    var el = g('xraySelectedCount');
    if (!el) return;
    el.textContent = xraySelected.size
        ? mediaTrRepl('media.selectedCount', { N: String(xraySelected.size) }) : '';
}

// ════════════════════════════════════════════════════════════════
// LOCAL DESKTOP LAUNCHER  (tools/Start X-Ray Launcher.bat on this PC)
// ════════════════════════════════════════════════════════════════
var XRAY_LAUNCHER_PORT = 17890;
var XRAY_LAUNCHER_BASE = 'http://127.0.0.1:' + XRAY_LAUNCHER_PORT;

function xrayLauncherBlockedByPage() {
    // Browser vendors allow loopback bridges like 127.0.0.1 from secure pages
    // with CORS/PNA preflight. Keep GitHub Pages able to reach the local launcher.
    return false;
}

/** Quick check: is tools/Start X-Ray Launcher.bat running on this PC? */
function pingXrayLauncher(cb) {
    if (xrayLauncherBlockedByPage()) {
        cb({ online: false, blocked: true });
        return;
    }
    var finished = false;
    var timer = setTimeout(function() {
        if (!finished) {
            finished = true;
            cb({ online: false });
        }
    }, 2000);
    fetch(XRAY_LAUNCHER_BASE + '/status', { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function(r) {
            if (finished) return null;
            clearTimeout(timer);
            if (!r.ok) {
                finished = true;
                cb({ online: false });
                return null;
            }
            return r.json().catch(function() { return {}; });
        })
        .then(function(body) {
            if (finished || body === null) return;
            finished = true;
            cb({
                online: !!(body && body.ok),
                carestream_exists: !!(body && body.carestream_exists),
                aidental_exists: !!(body && body.aidental_exists),
                nntnewtom_exists: !!(body && body.nntnewtom_exists)
            });
        })
        .catch(function() {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                cb({ online: false });
            }
        });
}

function tryLaunchDesktopAppViaLocalBridge(launcherKey, patient, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    opts = opts || {};
    if (xrayLauncherBlockedByPage()) {
        cb(false);
        return;
    }
    var patQ = '';
    var qParts = [];
    if (patient) appendXrayBridgePatientParams(qParts, patient, opts.folderPath || '');
    if (opts.appPath) {
        qParts.push('app_path=' + encodeURIComponent(opts.appPath));
    }
    var searchText = opts.searchText ||
        (patient && typeof xrayPatientSearchTextForLauncher === 'function'
            ? xrayPatientSearchTextForLauncher(patient, launcherKey)
            : '');
    if (searchText) {
        qParts.push('search_text=' + encodeURIComponent(searchText));
    }
    if (launcherKey === 'aidental') {
        qParts.push('aidental_mode=' + encodeURIComponent(opts.aidentalMode || 'auto'));
    }
    if (qParts.length) patQ = '?' + qParts.join('&');
    var url = XRAY_LAUNCHER_BASE + '/open/' +
        encodeURIComponent(launcherKey || 'carestream') + patQ;
    var finished = false;
    var bridgeTimeout = (launcherKey === 'aidental') ? 90000 : 2800;
    var timer = setTimeout(function() {
        if (!finished) {
            finished = true;
            cb(false, {});
        }
    }, bridgeTimeout);
    fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function(r) {
            if (finished) return null;
            clearTimeout(timer);
            return r.json().catch(function() { return {}; }).then(function(body) {
                return { httpOk: r.ok, body: body || {} };
            });
        })
        .then(function(res) {
            if (finished || res === null) return;
            finished = true;
            var body = res.body || {};
            var bridgeOk = !!(body.ok || body.aidental_running || res.httpOk);
            if (launcherKey === 'aidental') {
                bridgeOk = !!body.aidental_running;
            }
            cb(bridgeOk, body);
        })
        .catch(function() {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                cb(false, {});
            }
        });
}

// ════════════════════════════════════════════════════════════════
// EXTERNAL X-RAY SYSTEMS  (desktop app + local folder paths)
// ════════════════════════════════════════════════════════════════
var XRAY_SYSTEMS = {
    sirona: {
        nameKey: 'media.sys.sirona',
        infoKey: 'media.sys.sirona.info',
        url: 'sidexis4://',
        defaultDataPath: 'C:\\Image',
        defaultSubPattern: 'Xrays\\{patient_no}',
        defaultAppPath: 'C:\\Program Files\\Sirona Dental\\SIDEXIS\\Sidexis.exe'
    },
    vatech: {
        nameKey: 'media.sys.vatech',
        infoKey: 'media.sys.vatech.info',
        url: 'ezdenti://',
        defaultDataPath: 'C:\\Image',
        defaultSubPattern: 'Xrays\\{patient_no}',
        defaultAppPath: ''
    },
    planmeca: {
        nameKey: 'media.sys.planmeca',
        infoKey: 'media.sys.planmeca.info',
        url: 'romexis://',
        defaultDataPath: 'C:\\Image',
        defaultSubPattern: 'Xrays\\{patient_no}',
        defaultAppPath: ''
    },
    carestream: {
        nameKey: 'media.sys.carestream',
        infoKey: 'media.sys.carestream.info',
        url: '',
        launcherKey: 'carestream',
        desktopShortcutName: 'CS Imaging Software',
        desktopShortcutPath: 'C:\\Users\\Public\\Desktop\\CS Imaging Software.lnk',
        defaultDataPath: 'C:\\Image',
        defaultSubPattern: 'Xrays\\{patient_no}',
        defaultAppPath: 'C:\\Program Files (x86)\\Carestream\\Patient Browser\\Patient.exe',
        launchProtocol: false,
        openMsgKey: 'media.local.carestreamOpen',
        launchedMsgKey: 'media.local.carestreamLaunched',
        launcherNeededMsgKey: 'media.local.carestreamLauncherNeeded'
    },
    aidental: {
        nameKey: 'media.sys.aidental',
        infoKey: 'media.sys.aidental.info',
        url: '',
        launcherKey: 'aidental',
        desktopShortcutName: 'Ai-Dental-Client',
        desktopShortcutPath: 'C:\\Users\\Public\\Desktop\\Ai-Dental-Client.lnk',
        defaultDataPath: 'C:\\Image',
        defaultSubPattern: 'Xrays\\{patient_no}',
        defaultAppPath: 'C:\\Ai-Dental\\Ai-Dental-Client\\Ai-Dental.exe',
        launchProtocol: false,
        folderHintKey: 'media.local.aidentalUseFolder',
        openMsgKey: 'media.local.aidentalOpen',
        launchedMsgKey: 'media.local.aidentalLaunched',
        launcherNeededMsgKey: 'media.local.aidentalLauncherNeeded'
    },
    nntnewtom: {
        nameKey: 'media.sys.nntnewtom',
        infoKey: 'media.sys.nntnewtom.info',
        url: '',
        launcherKey: 'nntnewtom',
        desktopShortcutName: 'NNT / NEWTOM',
        desktopShortcutPath: 'C:\\Users\\Public\\Desktop\\NNT.lnk',
        defaultDataPath: 'C:\\Image',
        defaultSubPattern: 'Xrays\\{patient_no}',
        defaultAppPath: 'C:\\NNT\\NNT.exe',
        launchProtocol: false,
        openMsgKey: 'media.local.nntnewtomOpen',
        launchedMsgKey: 'media.local.nntnewtomLaunched',
        launcherNeededMsgKey: 'media.local.nntnewtomLauncherNeeded'
    },
    Trophy: {
        nameKey: 'media.sys.trophy',
        infoKey: 'media.sys.trophy.info',
        url: 'trophy://',
        defaultDataPath: 'C:\\Image',
        defaultSubPattern: 'Xrays\\{patient_no}',
        defaultAppPath: ''
    },
    _general: {
        nameKey: 'media.local.general',
        infoKey: 'media.local.generalInfo',
        url: '',
        defaultDataPath: 'C:\\Image',
        defaultSubPattern: 'Xrays\\{patient_no}',
        defaultAppPath: ''
    }
};

function xraySystemName(key) {
    var sys = XRAY_SYSTEMS[key];
    return sys ? mediaTr(sys.nameKey) : key;
}

function xraySystemInfo(key) {
    var sys = XRAY_SYSTEMS[key];
    return sys ? mediaTr(sys.infoKey) : '';
}

function loadXrayLocalPaths() {
    try {
        var raw = localStorage.getItem(XRAY_LOCAL_PATHS_KEY);
        xrayLocalPaths = raw ? JSON.parse(raw) : {};
    } catch (e) {
        xrayLocalPaths = {};
    }
}

function saveXrayLocalPaths() {
    try {
        localStorage.setItem(XRAY_LOCAL_PATHS_KEY, JSON.stringify(xrayLocalPaths || {}));
    } catch (e) {}
}

function getXrayLocalPathCfg(key) {
    var sys = XRAY_SYSTEMS[key];
    var stored = xrayLocalPaths[key] || {};
    var defSub = (sys && sys.defaultSubPattern) ? sys.defaultSubPattern : xrayDefaultSubPattern();
    return {
        dataPath: String(stored.dataPath || '').trim(),
        subPattern: String(stored.subPattern || defSub).trim() || defSub,
        appPath: String(stored.appPath || '').trim(),
        defaultDataPath: sys ? (sys.defaultDataPath || xrayClinicImageRoot()) : xrayClinicImageRoot(),
        defaultSubPattern: defSub,
        defaultAppPath: sys ? (sys.defaultAppPath || '') : ''
    };
}

/** Stored paths, or built-in defaults for this clinic PC (e.g. Carestream Patient.exe). */
function getEffectiveXrayLocalPathCfg(key) {
    var cfg = getXrayLocalPathCfg(key);
    if (!cfg.dataPath && cfg.defaultDataPath) cfg.dataPath = cfg.defaultDataPath;
    if (!cfg.appPath && cfg.defaultAppPath) cfg.appPath = cfg.defaultAppPath;
    return cfg;
}

/**
 * Pre-fill local paths: C:\\Image store + Carestream Patient.exe on this PC.
 */
function seedXrayLocalPathsFromDesktop() {
    loadXrayLocalPaths();
    var root = xrayClinicImageRoot();
    var sub = xrayDefaultSubPattern();
    var changed = false;

    function needsImageRoot(path) {
        if (!path) return true;
        return /Patient Browser|ProgramData|EzDent|Romexis|SIDEXIS|D:\\XRay/i.test(path);
    }

    Object.keys(XRAY_SYSTEMS).forEach(function(key) {
        var sys = XRAY_SYSTEMS[key];
        var cur = xrayLocalPaths[key] || {};
        var appDefault = sys.defaultAppPath || '';
        var patch = false;
        var next = {
            dataPath: cur.dataPath,
            subPattern: cur.subPattern || sub,
            appPath: cur.appPath || ''
        };
        if (needsImageRoot(next.dataPath)) {
            next.dataPath = root;
            patch = true;
        }
        if (!next.appPath && appDefault) {
            next.appPath = appDefault;
            patch = true;
        }
        if (!cur.subPattern) {
            next.subPattern = sub;
            patch = true;
        }
        if (patch) {
            xrayLocalPaths[key] = next;
            changed = true;
        }
    });
    if (changed) saveXrayLocalPaths();
}

function xrayLocalPathTokens(patient) {
    patient = patient || xrayPatientData || {};
    var no = String(patient.patient_no || '').trim();
    var cn = String(patient.chinese_name || '').trim();
    var en = String(patient.full_name || '').trim();
    var name = en || cn;
    return {
        patient_no: no,
        patient_no_clean: no.replace(/[^a-zA-Z0-9]/g, ''),
        patient_name: name,
        patient_name_clean: name.replace(/\s+/g, ''),
        chinese_name: cn
    };
}

/** Search string sent to the local launcher (varies by imaging software). */
function xrayPatientSearchTextForLauncher(patient, launcherKey) {
    if (!patient) return '';
    var no = String(patient.patient_no || '').trim();
    var cn = String(patient.chinese_name || '').trim();
    var en = String(patient.full_name || '').trim();
    if (launcherKey === 'aidental') {
        if (en) return en;
        if (cn) return cn;
        if (no) return no;
        return '';
    }
    return xrayPatientSearchClipboardText(patient);
}

/** Clipboard text for imaging software search: "Full Name (patient no.)". */
function xrayPatientSearchClipboardText(patient) {
    var tokens = xrayLocalPathTokens(patient);
    if (tokens.patient_name && tokens.patient_no) {
        return tokens.patient_name + ' (' + tokens.patient_no + ')';
    }
    if (tokens.patient_name) return tokens.patient_name;
    if (tokens.patient_no) return tokens.patient_no;
    return '';
}

function xrayPatientNeedsHydration(patient) {
    if (!patient || !patient.id) return false;
    return !String(patient.dob || '').trim() ||
        !String(patient.sex || '').trim() ||
        !String(patient.hkid || '').trim();
}

function xrayEnsurePatientForBridge(patient, cb) {
    if (!patient || !patient.id || typeof cb !== 'function') {
        if (cb) cb(patient);
        return;
    }
    if (!xrayPatientNeedsHydration(patient)) {
        cb(patient);
        return;
    }
    xrayHydratePatientRecord(patient.id, function(full) {
        cb(full ? Object.assign({}, patient, full) : patient);
    });
}

/** Multi-line summary copied for Ai-Dental new-patient entry. */
function xrayPatientBridgeClipboardText(patient) {
    patient = patient || {};
    var lines = [];
    var no = String(patient.patient_no || '').trim();
    var cn = String(patient.chinese_name || '').trim();
    var en = String(patient.full_name || '').trim();
    var dob = String(patient.dob || '').trim();
    var sex = String(patient.sex || '').trim();
    var hkid = String(patient.hkid || '').trim();
    var phone = String(patient.phone_number || patient.phone || patient.mobile_phone || '').trim();
    if (no) lines.push('Patient No: ' + no);
    if (cn) lines.push('Chinese Name: ' + cn);
    if (en) lines.push('Name: ' + en);
    if (dob) lines.push('DOB: ' + dob);
    if (sex) lines.push('Sex: ' + sex);
    if (hkid) lines.push('ID: ' + hkid);
    if (phone) lines.push('Phone: ' + phone);
    return lines.join('\n');
}

function xrayPatientBridgeSummaryLine(patient) {
    patient = patient || {};
    var parts = [];
    if (patient.patient_no) parts.push('#' + patient.patient_no);
    if (patient.chinese_name) parts.push(patient.chinese_name);
    if (patient.full_name) parts.push(patient.full_name);
    if (patient.dob) parts.push(patient.dob);
    if (patient.sex) parts.push(patient.sex);
    if (patient.hkid) parts.push(patient.hkid);
    return parts.join(' · ') || '—';
}

function xrayAiDentalLaunchMessageKey(bridgeBody) {
    if (!bridgeBody) return 'media.local.aidentalCreatePatientNeeded';
    if (bridgeBody.new_patient_prepared) return 'media.local.aidentalNewPatientPrepared';
    return 'media.local.aidentalCreatePatientNeeded';
}

function xrayBridgeDebugLabel(bridgeBody) {
    var debug = bridgeBody && bridgeBody.debug;
    if (!debug || !debug.length) return '—';
    return debug.join(' → ');
}

function xrayWoodpeckerPatientSummary(patient) {
    patient = patient || {};
    var parts = [];
    if (patient.full_name) parts.push(patient.full_name);
    if (patient.dob) parts.push(patient.dob);
    if (patient.sex) parts.push(patient.sex);
    if (patient.patient_no) parts.push('#' + patient.patient_no);
    return parts.join(' · ') || xrayPatientBridgeSummaryLine(patient);
}

function xrayBridgeFieldsFilledLabel(bridgeBody) {
    var filled = bridgeBody && bridgeBody.fields_filled;
    if (!filled || !filled.length) return '';
    var labels = {
        patient_no: 'Chart No.',
        patient_name: 'Name',
        chinese_name: 'Chinese name',
        dob: 'Birthday',
        sex: 'Gender',
        hkid: 'ID',
        phone: 'Phone'
    };
    return filled.map(function(k) { return labels[k] || k; }).join(', ');
}

function xrayBridgePatientPayload(patient, folderPath) {
    patient = patient || {};
    return {
        patient_id: patient.id || '',
        patient_no: patient.patient_no || '',
        patient_name: patient.full_name || '',
        chinese_name: patient.chinese_name || '',
        dob: patient.dob || '',
        sex: patient.sex || '',
        phone: patient.phone_number || patient.phone || '',
        mobile_phone: patient.mobile_phone || '',
        hkid: patient.hkid || '',
        email: patient.email || '',
        address: patient.address || '',
        medical_alerts: patient.medical_alerts || '',
        folder_path: folderPath || ''
    };
}

function appendXrayBridgePatientParams(qParts, patient, folderPath) {
    var payload = xrayBridgePatientPayload(patient, folderPath);
    Object.keys(payload).forEach(function(key) {
        var val = String(payload[key] == null ? '' : payload[key]).trim();
        if (val) qParts.push(key + '=' + encodeURIComponent(val));
    });
}

function applyXrayLocalPattern(pattern, patient) {
    var out = String(pattern || '{patient_no}');
    var tokens = xrayLocalPathTokens(patient);
    var k;
    for (k in tokens) {
        if (Object.prototype.hasOwnProperty.call(tokens, k)) {
            out = out.split('{' + k + '}').join(tokens[k]);
        }
    }
    return out.replace(/[\\/]+/g, '\\');
}

function buildLocalPatientFolderPath(key, patient) {
    return buildLocalPatientFolderPathWithCfg(
        key, patient, getEffectiveXrayLocalPathCfg(key)
    );
}

function buildLocalPatientFolderPathWithCfg(key, patient, cfg) {
    cfg = cfg || getEffectiveXrayLocalPathCfg(key);
    if (!cfg.dataPath) return '';
    var base = cfg.dataPath.replace(/[\\/]+$/, '');
    var sub = applyXrayLocalPattern(cfg.subPattern, patient);
    if (!sub) return base;
    return base + '\\' + sub;
}

/** Full path for current patient x-rays under C:\\Image\\Xrays\\{patient_no}. */
function buildClinicXrayFolderForPatient(patient) {
    patient = patient || xrayPatientData;
    if (!patient) return '';
    if (typeof clinicImagePatientDir === 'function') {
        return clinicImagePatientDir(patient.patient_no, 'xrays');
    }
    return buildLocalPatientFolderPath('_general', patient);
}

function copyTextToClipboard(text, done) {
    if (!text) {
        if (done) done(false);
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            if (done) done(true);
        }).catch(function() {
            if (done) done(false);
        });
        return;
    }
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (done) done(true);
    } catch (e2) {
        if (done) done(false);
    }
}

function copyXrayPatientFolderPath(key) {
    if (!xrayPatientData) {
        alert(mediaTr('con.forms.alertSelectPatient'));
        return;
    }
    var path = buildLocalPatientFolderPath(key, xrayPatientData);
    if (!path) {
        alert(mediaTr('media.local.noPathConfigured'));
        return;
    }
    copyTextToClipboard(path, function(ok) {
        alert(mediaTrRepl(ok ? 'media.local.pathCopied' : 'media.local.pathCopyFail', {
            PATH: path
        }));
    });
}

function isXrayImageFile(file) {
    if (!file || !file.name) return false;
    return XRAY_IMAGE_EXT_RE.test(file.name);
}

function xrayFileMatchesPatient(file, patient) {
    if (!file) return false;
    var rel = String(file.webkitRelativePath || file.name || '');
    var relLower = rel.toLowerCase();
    var tokens = xrayLocalPathTokens(patient);
    var hits = [];
    if (tokens.patient_no && tokens.patient_no.length >= 2) {
        hits.push(tokens.patient_no.toLowerCase());
    }
    if (tokens.patient_no_clean && tokens.patient_no_clean.length >= 2) {
        hits.push(tokens.patient_no_clean.toLowerCase());
    }
    if (tokens.patient_name_clean && tokens.patient_name_clean.length >= 3) {
        hits.push(tokens.patient_name_clean.toLowerCase());
    }
    var i;
    for (i = 0; i < hits.length; i++) {
        if (relLower.indexOf(hits[i]) >= 0) return true;
    }
    return false;
}

function pickXrayLocalFolderForImport(systemKey) {
    if (!xrayPatientId) {
        alert(mediaTr('con.forms.alertSelectPatient'));
        return;
    }
    xrayPendingLocalImportKey = systemKey || '_general';
    var inp = g('xrayLocalFolderInput');
    if (!inp) return;
    inp.value = '';
    inp.click();
}

function importXrayFilesFromLocalPicker(fileList, systemKey) {
    if (!fileList || !fileList.length || !xrayPatientId) return;
    var patient = xrayPatientData;
    var files = Array.from(fileList).filter(isXrayImageFile);
    if (patient) {
        files = files.filter(function(f) { return xrayFileMatchesPatient(f, patient); });
    }
    if (!files.length) {
        alert(mediaTr('media.local.noMatchingImages'));
        return;
    }
    if (!confirm(mediaTrRepl('media.local.confirmImport', { N: String(files.length) }))) return;

    xrayBulkLocalImport = true;
    xrayUploadQueue = files;
    xrayUploadQIdx = 0;
    var importNote = mediaTrRepl('media.local.importNote', {
        SYS: xraySystemName(systemKey) || mediaTr('media.local.general')
    });
    processNextLocalBulkUpload(importNote);
}

function processNextLocalBulkUpload(importNote) {
    if (xrayUploadQIdx >= xrayUploadQueue.length) {
        xrayBulkLocalImport = false;
        loadXrayRecords();
        return;
    }
    var file = xrayUploadQueue[xrayUploadQIdx];
    var pctLabel = mediaTrRepl('media.local.importing', {
        N: String(xrayUploadQIdx + 1),
        TOTAL: String(xrayUploadQueue.length)
    });
    uploadSingleXrayFile(file, 'Other', todayISO(), importNote, function() {
        xrayUploadQIdx++;
        processNextLocalBulkUpload(importNote);
    });
    showUploadProgress(true, pctLabel, Math.round((xrayUploadQIdx / xrayUploadQueue.length) * 100));
}

function openXrayLocalPathsModal() {
    loadXrayLocalPaths();
    var hint = g('xrayLocalRootHint');
    if (hint) {
        hint.textContent = mediaTrRepl('media.local.rootHint', { ROOT: xrayClinicImageRoot() });
    }
    renderXrayLocalPathsForm();
    openModal('xrayLocalPathsModal');
    var modal = g('xrayLocalPathsModal');
    if (modal && typeof applyI18nInRoot === 'function') applyI18nInRoot(modal);
}

function renderXrayLocalPathsForm() {
    var wrap = g('xrayLocalPathsForm');
    if (!wrap) return;
    wrap.innerHTML = '';
    Object.keys(XRAY_SYSTEMS).forEach(function(key) {
        var sys = XRAY_SYSTEMS[key];
        var cfg = getXrayLocalPathCfg(key);
        var block = document.createElement('div');
        block.className = 'xray-local-sys-block';
        block.innerHTML =
            '<h4 class="xray-local-sys-title">' + esc(mediaTr(sys.nameKey)) + '</h4>' +
            '<div class="fg">' +
                '<label>' + esc(mediaTr('media.local.dataFolder')) + '</label>' +
                '<input type="text" id="xrayLocalData-' + esc(key) + '" ' +
                'placeholder="' + esc(cfg.defaultDataPath || mediaTr('media.local.dataFolderPh')) + '" ' +
                'value="' + esc(cfg.dataPath) + '" ' +
                'style="width:100%;font-family:Consolas,monospace;font-size:12px;">' +
            '</div>' +
            '<div class="fg">' +
                '<label>' + esc(mediaTr('media.local.subPattern')) + '</label>' +
                '<input type="text" id="xrayLocalSub-' + esc(key) + '" ' +
                'value="' + esc(cfg.subPattern) + '" ' +
                'placeholder="{patient_no}" ' +
                'style="width:100%;font-family:Consolas,monospace;font-size:12px;">' +
            '</div>' +
            '<div class="fg">' +
                '<label>' + esc(mediaTr('media.local.appPath')) + '</label>' +
                '<input type="text" id="xrayLocalApp-' + esc(key) + '" ' +
                'placeholder="' + esc(cfg.defaultAppPath || mediaTr('media.local.appPathPh')) + '" ' +
                'value="' + esc(cfg.appPath) + '" ' +
                'style="width:100%;font-family:Consolas,monospace;font-size:12px;">' +
            '</div>' +
            '<div class="xray-local-sys-actions">' +
                '<button type="button" class="btn-sm xray-local-copy" data-key="' + esc(key) + '" ' +
                'style="background:var(--gray);">' + esc(mediaTr('media.local.copyFolder')) + '</button>' +
                '<button type="button" class="btn-sm xray-local-import" data-key="' + esc(key) + '" ' +
                'style="background:var(--primary);">' + esc(mediaTr('media.local.importFolder')) + '</button>' +
            '</div>';
        wrap.appendChild(block);
        block.querySelector('.xray-local-copy').addEventListener('click', function() {
            saveXrayLocalPathsFromForm();
            copyXrayPatientFolderPath(key);
        });
        block.querySelector('.xray-local-import').addEventListener('click', function() {
            saveXrayLocalPathsFromForm();
            pickXrayLocalFolderForImport(key);
        });
    });
}

function saveXrayLocalPathsFromForm() {
    Object.keys(XRAY_SYSTEMS).forEach(function(key) {
        var dataEl = g('xrayLocalData-' + key);
        var subEl  = g('xrayLocalSub-' + key);
        var appEl  = g('xrayLocalApp-' + key);
        if (!dataEl && !subEl && !appEl) return;
        xrayLocalPaths[key] = {
            dataPath: dataEl ? dataEl.value.trim() : '',
            subPattern: subEl ? (subEl.value.trim() || '{patient_no}') : '{patient_no}',
            appPath: appEl ? appEl.value.trim() : ''
        };
    });
    saveXrayLocalPaths();
}

function saveXrayLocalPathsModal() {
    saveXrayLocalPathsFromForm();
    closeModal('xrayLocalPathsModal');
    alert(mediaTr('media.local.saved'));
}

function openDesktopXrayApp(key) {
    var sys = XRAY_SYSTEMS[key];
    if (!sys) return;

    if (!xrayPatientId || !xrayPatientData) {
        var fallback = xrayResolveCurrentPatient();
        if (fallback && fallback.id) {
            syncXrayPatient(fallback.id, fallback);
        }
    }
    if (!xrayPatientId || !xrayPatientData) {
        alert(mediaTr('con.forms.alertSelectPatient'));
        return;
    }

    var patient = xrayPatientData;
    if (!String(patient.patient_no || '').trim() && !String(patient.chinese_name || '').trim() &&
        !String(patient.full_name || '').trim()) {
        var activeFallback = xrayResolveCurrentPatient();
        if (activeFallback && activeFallback.id &&
            String(activeFallback.id) === String(patient.id)) {
            patient = Object.assign({}, patient, activeFallback);
            syncXrayPatient(patient.id, patient);
        }
    }

    xrayEnsurePatientForBridge(patient, function(hydrated) {
        patient = hydrated;
        syncXrayPatient(patient.id, patient);
        openDesktopXrayAppWithPatient(key, sys, patient);
    });
}

function openDesktopXrayAppWithPatient(key, sys, patient) {
    sys = sys || XRAY_SYSTEMS[key];
    if (!sys || !patient) return;

    var cfg = getEffectiveXrayLocalPathCfg(key);
    var folderPath = buildLocalPatientFolderPathWithCfg(key, patient, cfg);
    var appPath = cfg.appPath || sys.defaultAppPath || '';
    var shortcutName = sys.desktopShortcutName || xraySystemName(key);
    var openKey = sys.openMsgKey || 'media.local.carestreamOpen';
    var launchedKey = sys.launchedMsgKey || 'media.local.carestreamLaunched';
    var neededKey = sys.launcherNeededMsgKey || 'media.local.carestreamLauncherNeeded';
    var folderHint = sys.folderHintKey
        ? mediaTr(sys.folderHintKey)
        : ((key === 'carestream')
            ? mediaTr('media.local.carestreamUsePatientBrowser')
            : mediaTr('media.local.desktopUsePatientSearch'));
    var launcherKey = sys.launcherKey || key;
    var searchText = (launcherKey === 'aidental')
        ? (xrayPatientSearchTextForLauncher(patient, launcherKey) ||
            xrayPatientSearchClipboardText(patient) || '—')
        : (xrayPatientSearchClipboardText(patient) || '—');
    var patientSummary = (launcherKey === 'aidental')
        ? xrayWoodpeckerPatientSummary(patient)
        : searchText;
    var clipboardText = (launcherKey === 'aidental')
        ? (xrayPatientBridgeClipboardText(patient) || searchText)
        : searchText;

    pingXrayLauncher(function(status) {
        status = status || { online: false };
        var launcherLine;
        if (status.blocked) {
            launcherLine = mediaTr('media.local.launcherHttpsBlocked');
        } else if (status.online) {
            launcherLine = mediaTr('media.local.launcherReady');
        } else {
            launcherLine = mediaTrRepl('media.local.launcherNotRunning', {
                BAT: 'tools\\Start X-Ray Launcher.bat'
            });
        }

        var msg;
        if (launcherKey === 'aidental') {
            msg = mediaTrRepl('media.local.aidentalFillOpen', {
                PATIENT: patientSummary
            });
        } else {
            msg = mediaTrRepl(openKey, {
                SHORTCUT: shortcutName,
                EXE: appPath,
                PATIENT: patientSummary,
                FOLDER: folderPath || folderHint
            });
        }
        msg += '\n\n' + launcherLine;
        if (!confirm(msg)) return;

        copyTextToClipboard(clipboardText);

        if (status.blocked || !status.online) {
            var neededMsgKey = (launcherKey === 'aidental')
                ? 'media.local.aidentalLauncherNeeded'
                : neededKey;
            alert(mediaTrRepl(neededMsgKey, {
                SHORTCUT: shortcutName,
                EXE: appPath,
                PATIENT: patientSummary,
                BAT: 'tools\\Start X-Ray Launcher.bat'
            }));
            return;
        }

        tryLaunchDesktopAppViaLocalBridge(launcherKey, patient, {
            appPath: appPath,
            folderPath: folderPath,
            searchText: xrayPatientSearchTextForLauncher(patient, launcherKey),
            aidentalMode: 'fill'
        }, function(attached, bridgeBody) {
            bridgeBody = bridgeBody || {};
            if (launcherKey === 'aidental') {
                if (!bridgeBody.aidental_running) {
                    alert(mediaTrRepl('media.local.aidentalNotRunning', {
                        PATIENT: patientSummary,
                        BAT: 'tools\\Start X-Ray Launcher.bat'
                    }));
                    return;
                }
                alert(mediaTrRepl(xrayAiDentalLaunchMessageKey(bridgeBody), {
                    PATIENT: patientSummary,
                    SUMMARY: patientSummary,
                    FIELDS: xrayBridgeFieldsFilledLabel(bridgeBody),
                    DEBUG: xrayBridgeDebugLabel(bridgeBody)
                }));
                return;
            }
            if (attached) {
                alert(mediaTrRepl(launchedKey, {
                    SHORTCUT: shortcutName,
                    PATIENT: bridgeBody.search_text || searchText
                }));
                return;
            }
            alert(mediaTrRepl(neededKey, {
                SHORTCUT: shortcutName,
                EXE: appPath,
                PATIENT: patientSummary,
                BAT: 'tools\\Start X-Ray Launcher.bat'
            }));
        });
    });
}

function openCarestreamImaging() {
    openDesktopXrayApp('carestream');
}

function openAiDentalClient() {
    openDesktopXrayApp('aidental');
}

function openNntNewtom() {
    openDesktopXrayApp('nntnewtom');
}

function openXraySystem(key) {
    var sys = XRAY_SYSTEMS[key];
    if (sys && sys.launcherKey) {
        openDesktopXrayApp(key);
        return;
    }
    if (!sys || !sys.url) return;
    var folderPath = xrayPatientData ? buildLocalPatientFolderPath(key, xrayPatientData) : '';
    var msg = mediaTrRepl('media.alert.openXraySystem', {
        NAME: xraySystemName(key),
        INFO: xraySystemInfo(key),
        URL: sys.url
    });
    if (folderPath) {
        msg += '\n\n' + mediaTr('media.local.folderPath') + ':\n' + folderPath;
    }
    if (!confirm(msg)) return;

    if (folderPath) {
        copyTextToClipboard(folderPath);
    }

    if (sys.launchProtocol === false) {
        return;
    }

    var patient = xrayPatientData;
    var url = sys.url +
        (patient
            ? '?patient=' + encodeURIComponent(patient.patient_no || '') +
              '&name='    + encodeURIComponent(patient.full_name  || '')
            : '');
    try {
        window.location.href = url;
    } catch (eProto) {}
}

// ════════════════════════════════════════════════════════════════
// DIY CUSTOM LINKS  (stored in localStorage)
// ════════════════════════════════════════════════════════════════
function loadDiyLinks() {
    var stored = localStorage.getItem('xray_diy_links');
    diyLinks = stored ? JSON.parse(stored) : [];
    updateDiyBadge();
}

function saveDiyLinksToStorage() {
    localStorage.setItem('xray_diy_links', JSON.stringify(diyLinks));
    updateDiyBadge();
}

function updateDiyBadge() {
    var badge = g('diyBadge');
    if (!badge) return;
    badge.style.display = diyLinks.length ? 'inline' : 'none';
}

function openDiySystemModal() {
    loadDiyLinks();
    renderDiyLinks();
    openModal('diySystemModal');
    var diyModal = g('diySystemModal');
    if (diyModal && typeof applyI18nInRoot === 'function') applyI18nInRoot(diyModal);
}

function renderDiyLinks() {
    var wrap = g('diyLinksList');
    if (!wrap) return;

    if (!diyLinks.length) {
        wrap.innerHTML =
            '<p style="color:#aaa;font-size:13px;' +
            'text-align:center;padding:12px 0;">' +
            esc(mediaTr('media.diy.noLinks')) + '</p>';
        return;
    }

    wrap.innerHTML = '';
    diyLinks.forEach(function(lnk, idx) {
        var div = document.createElement('div');
        div.style.cssText =
            'background:#f9faff;border:1px solid #dde8f5;' +
            'border-radius:8px;padding:12px 14px;' +
            'margin-bottom:8px;display:flex;' +
            'align-items:center;gap:10px;';
        div.innerHTML =
            '<span style="font-size:22px;">' + esc(lnk.icon || '🔗') + '</span>' +
            '<div style="flex:1;">' +
                '<div style="font-weight:700;font-size:14px;">' + esc(lnk.name) + '</div>' +
                '<div style="font-size:11px;color:#888;word-break:break-all;">' +
                    esc(lnk.url) + '</div>' +
            '</div>' +
            '<button class="diy-open-btn btn-sm" ' +
            'style="background:var(--primary);" data-idx="' + idx + '">' +
            esc(mediaTr('media.diy.openBtn')) + '</button>' +
            '<button class="diy-del-btn btn-sm"  ' +
            'style="background:var(--danger);"  data-idx="' + idx + '">✕</button>';

        wrap.appendChild(div);

        div.querySelector('.diy-open-btn')
            .addEventListener('click', function() { openDiyLink(idx); });
        div.querySelector('.diy-del-btn')
            .addEventListener('click', function() {
                diyLinks.splice(idx, 1);
                saveDiyLinksToStorage();
                renderDiyLinks();
            });
    });
}

function openDiyLink(idx) {
    var lnk     = diyLinks[idx];
    var patient = xrayPatientData || {};
    if (!lnk) return;

    var url = lnk.url
        .replace(/\{patient_no\}/g,   encodeURIComponent(patient.patient_no  || ''))
        .replace(/\{patient_name\}/g, encodeURIComponent(patient.full_name   || ''))
        .replace(/\{patient_dob\}/g,  encodeURIComponent(patient.dob         || ''))
        .replace(/\{date\}/g,         encodeURIComponent(todayISO()));

    if (confirm(mediaTrRepl('media.alert.confirmOpenLink', { NAME: lnk.name, URL: url }))) {
        window.open(url, '_blank');
    }
}

function saveDiyLink() {
    var name = (g('diyName').value || '').trim();
    var url  = (g('diyUrl').value  || '').trim();
    var icon = (g('diyIcon').value || '🔗').trim();

    if (!name) { alert(mediaTr('media.alert.enterSystemName')); return; }
    if (!url)  { alert(mediaTr('media.alert.enterUrl')); return; }

    diyLinks.push({ name: name, url: url, icon: icon });
    saveDiyLinksToStorage();
    renderDiyLinks();

    sv('diyName', '');
    sv('diyUrl',  '');
    sv('diyIcon', '');
}

function refreshXrayUiForLangChange() {
    if (typeof updateSelectedCount === 'function') updateSelectedCount();
    if (!xrayPatientId || !xrayFiltered.length) return;
    var slide = g('xraySlideView');
    if (slide && slide.style.display !== 'none' && typeof renderSlideAt === 'function') {
        renderSlideAt(xrayCurrentIdx);
    } else if (xrayView === 'grid' && typeof renderXrayGrid === 'function') {
        renderXrayGrid();
    }
}

document.addEventListener('app-lang-change', function () {
    refreshXrayTypeSelects();
    refreshXrayBannerI18n();
    var uploadModal = g('xrayUploadModal');
    var lbModal = g('xrayLightbox');
    var diyModal = g('diySystemModal');
    var localModal = g('xrayLocalPathsModal');
    if (typeof applyI18nInRoot === 'function') {
        if (uploadModal && uploadModal.style.display === 'block') applyI18nInRoot(uploadModal);
        if (lbModal && lbModal.style.display === 'block') {
            applyI18nInRoot(lbModal);
            if (typeof lbSyncLightboxChrome === 'function') lbSyncLightboxChrome();
        }
        if (diyModal && diyModal.style.display === 'block') {
            applyI18nInRoot(diyModal);
            if (typeof renderDiyLinks === 'function') renderDiyLinks();
        }
        if (localModal && localModal.style.display === 'block') {
            applyI18nInRoot(localModal);
            if (typeof renderXrayLocalPathsForm === 'function') renderXrayLocalPathsForm();
        }
    }
    if (xrayPatientId) {
        if (xrayAllRecords.length && typeof populateYearFilter === 'function') {
            populateYearFilter();
        }
        if (diyLinks.length && typeof renderDiyLinks === 'function') renderDiyLinks();
        if (typeof refreshXrayUiForLangChange === 'function') refreshXrayUiForLangChange();
        if (typeof applyI18nInRoot === 'function') {
            var xPaneEarly = g('con-xrays');
            if (xPaneEarly) applyI18nInRoot(xPaneEarly);
            var xBanner = g('conXrayBanner');
            if (xBanner) applyI18nInRoot(xBanner);
        }
    }
    var sec = g('consultationSection');
    if (!sec || sec.style.display === 'none') return;
    if (xrayPatientId && typeof loadXrayRecords === 'function') loadXrayRecords();
});

document.addEventListener('app-active-patient-change', function(ev) {
    var detail = ev && ev.detail ? ev.detail : {};
    if (detail.patient && detail.patient.id) {
        xraySyncFromActivePatientPayload(detail.patient, detail.source || '');
    }
});

document.addEventListener('DOMContentLoaded', function () {
    refreshXrayTypeSelects();
    if (typeof activePatientSlots !== 'undefined' && activePatientSlots[0] &&
        activePatientSlots[0].id) {
        xraySyncFromActivePatientPayload(activePatientSlots[0], 'active-slot-boot');
    }
});
