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

// Image transform state — slide view
var slideTransform = {
    scale: 1, rotate: 0, flipH: false, flipV: false, invert: false
};

// Image transform state — lightbox
var lbTransform = {
    scale: 1, rotate: 0, flipH: false, flipV: false, invert: false
};

var lbCurrentId  = null;    // id of record open in lightbox
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
                        '⚠️ Storage bucket missing',
                        'The bucket <strong>"' + XRAY_BUCKET + '"</strong> does not ' +
                        'exist in your Supabase project.<br><br>' +
                        '1. Open <strong>Supabase → Storage</strong><br>' +
                        '2. Click <strong>New Bucket</strong><br>' +
                        '3. Name it exactly: <code>' + XRAY_BUCKET + '</code><br>' +
                        '4. Enable <strong>Public</strong> access<br>' +
                        '5. Reload and try again.'
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
    var q  = (g('conPsInputXray').value || '').trim();
    var dd = g('conPsDropXray');
    if (!q) { dd.style.display = 'none'; return; }

    var xq = SB.from('patients')
        .select('id,patient_no,full_name,dob,phone_number,medical_alerts,' +
            PATIENT_CLINIC_TAG_FIELD)
        .or(
            'full_name.ilike.%'   + q + '%,' +
            'patient_no.ilike.%'  + q + '%,' +
            'phone_number.ilike.%' + q + '%'
        )
        .limit(8);
    xq = typeof applyPatientQueryClinicTag === 'function'
        ? applyPatientQueryClinicTag(xq, 'conPsClinicFilterXray')
        : xq;
    xq.then(function(r) {
        dd.innerHTML = '';
        if (r.error || !r.data || !r.data.length) {
            dd.innerHTML =
                '<div class="ps-item" style="color:#aaa;">No patients found</div>';
            dd.style.display = 'block';
            return;
        }
        r.data.forEach(function(p) {
            var item = document.createElement('div');
            item.className = 'ps-item';
            item.innerHTML =
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">#' +
                esc(p.patient_no || '-') + ' &nbsp;|&nbsp; ' +
                esc(p.phone_number || 'No phone') + '</small>';
            item.addEventListener('click', function() {
                dd.style.display = 'none';
                g('conPsInputXray').value =
                    p.full_name + ' (#' + (p.patient_no || '') + ')';
                selectXrayPatient(p);
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
    });
}

// ════════════════════════════════════════════════════════════════
// SYNC FUNCTION — called from consultation module
// ════════════════════════════════════════════════════════════════
function syncXrayPatient(patientId, patientData) {
    // This is called when a patient is selected in ANY consultation tab
    // It pre-populates the X-ray tab so it's ready when clicked
    xrayPatientId   = patientId;
    xrayPatientData = patientData;
    
    // Populate the search input
    var searchInput = g('conPsInputXray');
    if (searchInput && patientData) {
        searchInput.value = patientData.full_name + 
            ' (#' + (patientData.patient_no || '') + ')';
    }
    
    // Close dropdown if open
    var dd = g('conPsDropXray');
    if (dd) dd.style.display = 'none';
    
    // Populate banner
    var banner = g('conXrayBanner');
    if (banner) banner.style.display = 'flex';
    
    if (patientData) {
        var nameEl = g('conXrayBannerName');
        if (nameEl) nameEl.textContent = patientData.full_name;
        
        var noEl = g('conXrayBannerNo');
        if (noEl) noEl.textContent = patientData.patient_no || '-';
        
        var dobEl = g('conXrayBannerDob');
        if (dobEl && patientData.dob) {
            dobEl.textContent = formatDobAge(patientData.dob);
        }
        
        var alertEl = g('conXrayBannerAlert');
        if (alertEl) {
            alertEl.textContent = patientData.medical_alerts || 'None';
            alertEl.style.color = patientData.medical_alerts ? 'var(--danger)' : '#999';
        }
    }
    
    // Reveal main content
    var main = g('xrayMainContent');
    if (main) main.style.display = 'block';
    
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
        alertEl.textContent = p.medical_alerts || 'None';
        alertEl.style.color = p.medical_alerts ? 'var(--danger)' : '#999';
    }

    // Reveal the main X-ray content area
    var main = g('xrayMainContent');
    if (main) main.style.display = 'block';

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
    if (!xrayPatientId) return;
    loadXrayRecords();
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
    sel.innerHTML = '<option value="">All Years</option>';
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
        var dateStr   = x.taken_date ? fmtDateLong(x.taken_date) : 'No date';
        var imgSrc    = xrayDisplayUrl(x);

        var noPreviewSVG =
            'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">' +
                '<rect fill="#1a1a2e"/>' +
                '<text x="50%" y="50%" fill="#666" text-anchor="middle" ' +
                'dy=".3em" font-size="14">No Preview</text></svg>'
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
                    : '<div class="xray-no-img">🔬<br><small>No Preview</small></div>') +
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
                        '🔍 View' +
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
           'border-radius:10px;">' + esc(type || 'Other') + '</span>';
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
                '<p>No X-Rays</p></div></div>';
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
    if (ctr) ctr.textContent = (idx + 1) + ' / ' + xrayFiltered.length;

    var typeEl = g('xraySlideType');
    if (typeEl) typeEl.textContent = x.xray_type || 'Other';

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

    sv('lbType',  x.xray_type  || 'Other');
    sv('lbDate',  x.taken_date || '');
    sv('lbNotes', x.notes      || '');

    openModal('xrayLightbox');
}

function closeLightbox() {
    var video = g('xrayLbVideo');
    if (video && !video.paused) video.pause();
    closeModal('xrayLightbox');
    lbCurrentId = null;
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
        alert('Crop failed — image may be cross-origin. Download and re-upload to enable cropping.');
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
            alert('No video frame available.'); return;
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
    if (!w) { alert('Pop-up blocked — please allow pop-ups for this page.'); return; }
    w.document.write(
        '<!DOCTYPE html><html><head>' +
        '<style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh;}' +
        'img{max-width:100%;max-height:100vh;}</style></head><body>' +
        '<img src="' + src + '" onload="window.print();">' +
        '</body></html>'
    );
    w.document.close();
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

function lbNeedsImagePersist() {
    if (lbIsVideo) return false;
    var img = g('xrayLbImg');
    if (img && img.src && img.src.indexOf('data:image') === 0) return true;
    if (lbBrightness !== 100 || lbContrast !== 100 || lbTransform.invert) {
        return true;
    }
    return lbOverlayHasInk();
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

        canvasToJpegBlob(merged, 0.92, callback);
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

                    canvasToJpegBlob(merged, 0.92, callback);
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
        closeLightbox();
        loadXrayRecords().then(function() {
            alert(msg || '✅ Saved.');
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
                if (r.error) { alert('Error: ' + r.error.message); return; }
                finishOk('✅ X-ray details saved.');
            });
    }

    if (lbIsVideo || !lbNeedsImagePersist()) {
        saveMetaOnly();
        return;
    }

    lbExportEditedJpegForSave(function(blob) {
        if (!blob) {
            alert(
                'Could not export the edited image (often CORS with hot-linked ' +
                'files). Metadata will still be saved.'
            );
            saveMetaOnly();
            return;
        }

        if (!xrayPatientId) {
            alert('Patient context missing — cannot upload image. Saving notes only.');
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
                    alert('Upload failed: ' + up.error.message + '\nSaving metadata only.');
                    saveMetaOnly();
                    return null;
                }
                var publicUrl = xrayGetPublicUrlForPath(safeName);

                if (!publicUrl) {
                    alert(
                        'Upload OK but could not compute public URL. ' +
                        'Check Storage bucket "' + XRAY_BUCKET + '" is public.'
                    );
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
                    alert(
                        'Database update failed: ' + r.error.message + '\n\n' +
                        'If you use Row Level Security, allow UPDATE on file_path, ' +
                        'file_url, file_size, file_name for your role.'
                    );
                    return;
                }
                finishOk('✅ X-ray saved (image + details updated).');
            });
    });
}

function deleteLbXray() {
    if (!lbCurrentId) return;
    if (!confirm('Delete this X-ray? This cannot be undone.')) return;

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
        if (r.error) { alert('Error: ' + r.error.message); return; }
        closeLightbox();
        loadXrayRecords();
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
    // ── File upload ──────────────────────────────────────────
    var fi = g('xrayFileInput');
    if (fi) {
        fi.addEventListener('change', function() {
            if (!xrayPatientId) {
                alert('Please select a patient first.');
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
            ? 'File ' + (xrayUploadQIdx + 1) + ' of ' + xrayUploadQueue.length
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
    showUploadProgress(true, 'Preparing upload…', 5);

    // Build a collision-resistant storage path
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

    showUploadProgress(true, 'Uploading to storage…', 20);

    // ── Step 1 : Upload to Supabase Storage ─────────────────
    SB.storage.from(XRAY_BUCKET)
        .upload(safeName, file, {
            cacheControl: '3600',
            upsert      : false,
            contentType : contentType
        })
    .then(function(r) {
        if (r.error) {
            showUploadProgress(false);
            var msg = r.error.message || 'Unknown error';

            if (msg.toLowerCase().includes('bucket not found')) {
                showXrayError(
                    '❌ Bucket not found',
                    'The storage bucket <strong>"' + XRAY_BUCKET + '"</strong> ' +
                    'does not exist.<br><br>' +
                    '1. Supabase → Storage → <strong>New Bucket</strong><br>' +
                    '2. Name it exactly: <code>' + XRAY_BUCKET + '</code><br>' +
                    '3. Enable <strong>Public</strong> access → Create<br>' +
                    '4. Reload this page.'
                );
            } else if (/policy|unauthorized|not allowed/i.test(msg)) {
                showXrayError(
                    '❌ Permission denied',
                    'A storage policy is blocking the upload.<br><br>' +
                    'Run in <strong>Supabase SQL Editor</strong>:<br>' +
                    '<code>CREATE POLICY "xrays_upload" ON storage.objects ' +
                    'FOR INSERT TO authenticated ' +
                    'WITH CHECK (bucket_id = \'' + XRAY_BUCKET + '\');</code>'
                );
            } else if (/duplicate|already exists/i.test(msg)) {
                // Retry with upsert and a fresh name
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
                showXrayError('❌ Upload failed', 'Error: ' + msg);
            }
            return null;
        }
        showUploadProgress(true, 'Getting file URL…', 60);
        return { ok: true, path: safeName };
    })

    // ── Step 2 : Get public URL ──────────────────────────────
    .then(function(res) {
        if (!res || !res.ok) return null;

        var publicUrl = xrayGetPublicUrlForPath(res.path);

        showUploadProgress(true, 'Saving record…', 80);

        // ── Step 3 : Insert DB record ────────────────────────
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

    // ── Step 4 : Handle DB result ────────────────────────────
    .then(function(r) {
        if (!r) return;
        if (r.error) {
            showUploadProgress(false);
            showXrayError(
                '❌ Database error',
                'File uploaded but record save failed:<br>' + r.error.message +
                '<br><br>Make sure the <code>xrays</code> table exists.'
            );
            return;
        }
        showUploadProgress(true, '✅ Done!', 100);
        setTimeout(function() {
            showUploadProgress(false);
            xrayUploadQIdx++;
            processNextUpload();
        }, 700);
    })
    .catch(function(err) {
        showUploadProgress(false);
        showXrayError('❌ Unexpected error', err.message || String(err));
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
        alert('Select at least one X-ray to export.');
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
    if (!xrayFiltered.length) { alert('No X-rays to export.'); return; }
    if (!confirm('Download all ' + xrayFiltered.length + ' X-ray(s)?')) return;
    xrayFiltered.forEach(function(x, i) {
        setTimeout(function() {
            downloadFile(xrayDisplayUrl(x),
                'xray-' + (x.xray_type || 'image') + '-' + i + '.jpg');
        }, i * 500);
    });
}

function downloadFile(url, filename) {
    if (!url) { alert('No file URL available.'); return; }

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
            alert('Download failed: ' + err.message);
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
    el.textContent = xraySelected.size ? xraySelected.size + ' selected' : '';
}

// ════════════════════════════════════════════════════════════════
// EXTERNAL X-RAY SYSTEMS  (built-in protocol launchers)
// ════════════════════════════════════════════════════════════════
var XRAY_SYSTEMS = {
    sirona:      { name: 'Sidexis 4 (Sirona/Dentsply)',  url: 'sidexis4://', info: 'Launches Sidexis 4 desktop application' },
    vatech:      { name: 'EzDent-i (Vatech)',            url: 'ezdenti://',  info: 'Launches EzDent-i application'          },
    planmeca:    { name: 'Romexis (Planmeca)',           url: 'romexis://',  info: 'Launches Romexis software'              },
    carestream:  { name: 'CS Imaging (Carestream)',      url: 'csimaging://',info: 'Launches CS Imaging software'           },
    Trophy:      { name: 'Trophy Imaging / Kodak',       url: 'trophy://',   info: 'Launches Trophy/Kodak imaging system'  }
};

function openXraySystem(key) {
    var sys = XRAY_SYSTEMS[key];
    if (!sys) return;
    var msg =
        '🔗 Opening ' + sys.name + '\n\n' +
        sys.info + '\n\n' +
        'Protocol: ' + sys.url + '\n\n' +
        'Make sure the software is installed on this computer.\n' +
        'The system will attempt to launch the application now.';
    if (!confirm(msg)) return;

    var patient = xrayPatientData;
    var url = sys.url +
        (patient
            ? '?patient=' + encodeURIComponent(patient.patient_no || '') +
              '&name='    + encodeURIComponent(patient.full_name  || '')
            : '');
    window.location.href = url;
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
}

function renderDiyLinks() {
    var wrap = g('diyLinksList');
    if (!wrap) return;

    if (!diyLinks.length) {
        wrap.innerHTML =
            '<p style="color:#aaa;font-size:13px;' +
            'text-align:center;padding:12px 0;">' +
            'No custom links yet.</p>';
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
            'style="background:var(--primary);" data-idx="' + idx + '">Open</button>' +
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

    if (confirm('Open "' + lnk.name + '"?\n' + url)) {
        window.open(url, '_blank');
    }
}

function saveDiyLink() {
    var name = (g('diyName').value || '').trim();
    var url  = (g('diyUrl').value  || '').trim();
    var icon = (g('diyIcon').value || '🔗').trim();

    if (!name) { alert('Please enter a system name.'); return; }
    if (!url)  { alert('Please enter a URL.');         return; }

    diyLinks.push({ name: name, url: url, icon: icon });
    saveDiyLinksToStorage();
    renderDiyLinks();

    sv('diyName', '');
    sv('diyUrl',  '');
    sv('diyIcon', '');
}
