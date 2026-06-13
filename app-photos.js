/* =========================================================
   app-photos.js  –  Photos & Documents Module
   Joyful Smile Clinic Manager
   Mirrors the X-Ray tab UI pattern exactly.
   ========================================================= */

/* ── Module State ─────────────────────────────────────── */
var photoPatientId   = null;
var photoPatientData = null;
var photoAllRecords  = [];
var photoFiltered    = [];
var photoSelected    = new Set();
var photoCurrentIdx  = 0;
var photoView        = 'grid';
var photoUploadQueue = [];
var photoUploadQIdx  = 0;
var photoFilterCat   = '';
var photoFilterYear  = '';
var photoFilterQuery = '';

var photoLbCurrentId = null;

var PHOTO_BUCKET = 'photos';

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

var PHOTO_CATEGORY_PAIRS = [
    ['Intraoral', 'media.cat.intraoral'],
    ['Extraoral', 'media.cat.extraoral'],
    ['Before/After', 'media.cat.beforeAfter'],
    ['Consent Form', 'media.cat.consentForm'],
    ['Lab Report', 'media.cat.labReport'],
    ['Other', 'media.categoryOther']
];

function photoCategoryLabel(cat) {
    var s = String(cat || '').trim();
    if (!s) return mediaTr('media.categoryOther');
    var i;
    for (i = 0; i < PHOTO_CATEGORY_PAIRS.length; i++) {
        if (PHOTO_CATEGORY_PAIRS[i][0] === s) return mediaTr(PHOTO_CATEGORY_PAIRS[i][1]);
    }
    if (/^other$/i.test(s)) return mediaTr('media.categoryOther');
    return s;
}

function refreshPhotoCategorySelects() {
    function fill(selId, includeAll) {
        var sel = g(selId);
        if (!sel) return;
        var prev = sel.value;
        var html = includeAll
            ? '<option value="">' + esc(mediaTr('media.allCategories')) + '</option>'
            : '';
        PHOTO_CATEGORY_PAIRS.forEach(function(pair) {
            html += '<option value="' + esc(pair[0]) + '">' + esc(mediaTr(pair[1])) + '</option>';
        });
        sel.innerHTML = html;
        if (prev) sel.value = prev;
    }
    fill('photoFilterCat', true);
    fill('photoUploadCat', false);
    fill('photoLbCat', false);
}

function refreshPhotoBannerI18n() {
    var p = photoPatientData;
    if (!p) return;
    var dobEl = g('conPhotoBannerDob');
    if (dobEl) dobEl.textContent = p.dob ? formatDobAge(p.dob) : '—';
    var alertEl = g('conPhotoBannerAlert');
    if (alertEl) {
        alertEl.textContent = p.medical_alerts || mediaTr('con.banner.none');
        alertEl.style.color = p.medical_alerts ? 'var(--danger)' : '#999';
    }
}

function photoGetPublicUrlForPath(storagePath) {
  var ur = SB.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath);
  if (ur && ur.data && ur.data.publicUrl) return ur.data.publicUrl;
  if (ur && typeof ur.publicUrl === 'string') return ur.publicUrl;
  return '';
}

/* ── Photo lightbox (parity with X-ray lightbox tools) ── */
var phLbTransform = {
  scale: 1, rotate: 0, flipH: false, flipV: false, invert: false
};
var phLbBrightness  = 100;
var phLbContrast    = 100;
var phLbTool        = 'none';
var phLbDrawColor   = '#ff0000';
var phLbStrokeWidth = 4;
var phLbIsDrawing   = false;
var phLbDrawStart   = { x: 0, y: 0 };
var phLbPolyPts     = [];
var phLbDrawHistory = [];
var phLbCropRect    = null;
var phLbIsVideo     = false;
var phLbLayoutBaseW = 0;
var phLbLayoutBaseH = 0;
var phLbScrollDragging = false;
var phLbScrollLast     = { x: 0, y: 0 };

const PHOTO_CATEGORIES = [
  'Intraoral', 'Extraoral', 'Before/After',
  'Consent Form', 'Lab Report', 'Other'
];

/* =========================================================
   SECTION 1 – SYNC / INIT (called by app-consultation.js)
   ========================================================= */

function syncPhotoPatient(pid, pdata) {
  if (pid && pid !== photoPatientId) {
    selectPhotoPatient(pdata || { id: pid });
  }
}

function selectPhotoPatient(p) {
  photoPatientId   = p.id;
  photoPatientData = p;

  /* If pdata was incomplete, fetch full record */
  if (!p.full_name) {
    SB.from('patients').select('*').eq('id', p.id).single()
      .then(function(r) {
        if (r.data) {
          photoPatientData = r.data;
          _afterPhotoPatientSelected();
        }
      });
    return;
  }
  _afterPhotoPatientSelected();
}

function _afterPhotoPatientSelected() {
  var p = photoPatientData;

  /* Show banner */
  var banner = g('conPhotoBanner');
  if (banner) banner.style.display = 'flex';

  var nameEl = g('conPhotoBannerName');
  if (nameEl) nameEl.textContent = p.full_name || '—';

  var noEl = g('conPhotoBannerNo');
  if (noEl) noEl.textContent = p.patient_no || '—';

  var dobEl = g('conPhotoBannerDob');
  if (dobEl) dobEl.textContent = p.dob ? formatDobAge(p.dob) : '—';

  var alertEl = g('conPhotoBannerAlert');
  if (alertEl) {
    alertEl.textContent = p.medical_alerts || mediaTr('con.banner.none');
    alertEl.style.color = p.medical_alerts ? 'var(--danger)' : '#999';
  }

  /* Show main content */
  var main = g('photoMainContent');
  if (main) main.style.display = 'block';

  /* Reset filters */
  photoFilterCat   = '';
  photoFilterYear  = '';
  photoFilterQuery = '';
  var fCat  = g('photoFilterCat');
  var fYear = g('photoFilterYear');
  var fSrch = g('photoFilterSearch');
  if (fCat)  fCat.value  = '';
  if (fYear) fYear.value = '';
  if (fSrch) fSrch.value = '';

  photoSelected.clear();
  photoCurrentIdx = 0;

  loadPhotoRecords();
}

/* =========================================================
   SECTION 2 – PATIENT SEARCH (standalone within photos tab)
   ========================================================= */

function doConPatientSearchPhoto() {
  runPatientSearchDropdown({
    inputId: 'conPsInputPhoto',
    dropId: 'conPsDropPhoto',
    clinicFilterId: 'conPsClinicFilterPhoto',
    onSelect: selectPhotoPatient
  });
}

/* =========================================================
   SECTION 3 – LOAD RECORDS
   ========================================================= */

function loadPhotoRecords() {
  if (!photoPatientId) {
    return Promise.resolve();
  }

  return SB.from('photos')
    .select('*')
    .eq('patient_id', photoPatientId)
    .order('taken_date', { ascending: false })
    .order('created_at', { ascending: false })
  .then(function(r) {
    if (r.error) {
      console.error('[Photos] load error:', r.error);
      photoAllRecords = [];
    } else {
      photoAllRecords = r.data || [];
    }
    populatePhotoCatFilter();
    populatePhotoYearFilter();
    filterPhotos();
  });
}

function photoBareUrl(record) {
  return record && record.public_url ? record.public_url : '';
}

function photoDisplayUrl(record) {
  var raw = photoBareUrl(record);
  if (!raw || raw.indexOf('data:') === 0) return raw || '';
  var token = encodeURIComponent([
    record.file_path || '',
    record.file_size != null ? String(record.file_size) : '',
    record.updated_at || record.created_at || '',
    record.id != null ? String(record.id) : ''
  ].join('|'));
  return raw.indexOf('?') >= 0 ? raw + '&_ph=' + token : raw + '?_ph=' + token;
}

function populatePhotoCatFilter() {
    refreshPhotoCategorySelects();
}

function populatePhotoYearFilter() {
  var sel = g('photoFilterYear');
  if (!sel) return;
  var years = new Set();
  photoAllRecords.forEach(function(x) {
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

/* =========================================================
   SECTION 4 – FILTER
   ========================================================= */

function filterPhotos() {
  var cat   = (g('photoFilterCat')    ? g('photoFilterCat').value    : '').toLowerCase();
  var year  = (g('photoFilterYear')   ? g('photoFilterYear').value   : '');
  var query = (g('photoFilterSearch') ? g('photoFilterSearch').value : '').toLowerCase();

  photoFiltered = photoAllRecords.filter(function(x) {
    if (cat  && (x.category || '').toLowerCase() !== cat) return false;
    if (year && (!x.taken_date || !x.taken_date.startsWith(year))) return false;
    if (query && !(
          (x.caption || '').toLowerCase().includes(query) ||
          (x.notes   || '').toLowerCase().includes(query)
        )) return false;
    return true;
  });

  photoSelected.clear();
  updatePhotoSelectedCount();

  var sa = g('photoSelectAll');
  if (sa) sa.checked = false;

  if (photoView === 'grid') renderPhotoGrid();
  else                      renderPhotoSlide();
}

/* =========================================================
   SECTION 5 – VIEW TOGGLE
   ========================================================= */

function setPhotoView(view) {
  photoView = view;
  var btnG = g('btnPhotoGridView');
  var btnS = g('btnPhotoSlideView');
  if (btnG) btnG.classList.toggle('active', view === 'grid');
  if (btnS) btnS.classList.toggle('active', view === 'slide');

  var gv = g('photoGridView');
  var sv = g('photoSlideView');
  if (gv) gv.style.display = view === 'grid'  ? '' : 'none';
  if (sv) sv.style.display = view === 'slide' ? '' : 'none';

  if (view === 'slide') renderPhotoSlide();
  else                  renderPhotoGrid();
}

/* =========================================================
   SECTION 6 – GRID RENDER
   ========================================================= */

function renderPhotoGrid() {
  var grid  = g('photoGridView');
  var empty = g('photoEmptyState');
  if (!grid) return;

  /* Remove existing cards, keep empty-state sentinel */
  Array.from(grid.children).forEach(function(c) {
    if (c !== empty) grid.removeChild(c);
  });

  if (!photoFiltered.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  var isNurse = (typeof currentRole !== 'undefined' && currentRole === 'nurse');

  photoFiltered.forEach(function(x, idx) {
    var card = document.createElement('div');
    card.className  = 'xray-card';
    card.dataset.id = x.id;

    var isPdf    = x.file_path && x.file_path.toLowerCase().endsWith('.pdf');
    var catBadge = getPhotoCatBadge(x.category);
    var dateStr  = x.taken_date ? fmtDateLong(x.taken_date) : mediaTr('media.noDate');
    var imgSrc   = photoDisplayUrl(x);

    var noPreviewSVG =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">' +
        '<rect fill="#1a1a2e"/>' +
        '<text x="50%" y="50%" fill="#666" text-anchor="middle" ' +
        'dy=".3em" font-size="14">' + esc(mediaTr('media.noPreview')) + '</text></svg>'
      );

    var thumbHtml = isPdf
      ? '<div class="xray-no-img" style="background:#fef3c7;">📄<br><small>PDF</small></div>'
      : (imgSrc
          ? '<img src="' + esc(imgSrc) + '" alt="Photo" ' +
            'onerror="this.src=\'' + noPreviewSVG + '\'">'
          : '<div class="xray-no-img">📷<br><small>' + esc(mediaTr('media.noPreview')) + '</small></div>');

    card.innerHTML =
      (!isNurse
        ? '<div class="xray-card-check">' +
          '<input type="checkbox" class="photo-cb" data-id="' + x.id + '"' +
          (photoSelected.has(x.id) ? ' checked' : '') + '>' +
          '</div>'
        : '') +
      '<div class="xray-card-img" data-idx="' + idx + '">' +
        thumbHtml +
      '</div>' +
      '<div class="xray-card-body">' +
        '<div class="xray-card-top">' +
          catBadge +
          '<span class="xray-card-date">' + dateStr + '</span>' +
        '</div>' +
        (x.caption
          ? '<div class="xray-card-notes">' + esc(x.caption) + '</div>'
          : '') +
        '<div class="xray-card-actions">' +
          '<button class="xray-cb-open" data-idx="' + idx + '">' +
            esc(mediaTr('media.btn.view')) +
          '</button>' +
          (!isPdf
            ? '<button class="xray-cb-dl" ' +
              'data-url="'  + esc(imgSrc) + '" ' +
              'data-name="photo-' + esc(x.category || 'image') + '.jpg">' +
                '💾' +
              '</button>'
            : '<a href="' + esc(imgSrc) + '" target="_blank" ' +
              'class="xray-cb-dl" style="text-decoration:none;">📄</a>') +
        '</div>' +
      '</div>';

    grid.appendChild(card);

    /* Checkbox */
    var cb = card.querySelector('.photo-cb');
    if (cb) {
      cb.addEventListener('change', function() {
        if (this.checked) photoSelected.add(x.id);
        else              photoSelected.delete(x.id);
        updatePhotoSelectedCount();
      });
    }

    /* Open lightbox */
    card.querySelector('.xray-card-img')
        .addEventListener('click', function() { openPhotoLightbox(idx); });
    card.querySelector('.xray-cb-open')
        .addEventListener('click', function() { openPhotoLightbox(idx); });

    /* Download */
    var dlBtn = card.querySelector('.xray-cb-dl');
    if (dlBtn && dlBtn.tagName === 'BUTTON') {
      dlBtn.addEventListener('click', function() {
        photoDownloadFile(this.dataset.url, this.dataset.name);
      });
    }
  });
}

function getPhotoCatBadge(cat) {
  var palette = {
    'Intraoral'   : '#dbeafe:#1d4ed8',
    'Extraoral'   : '#dcfce7:#166534',
    'Before/After': '#fef9c3:#713f12',
    'Consent Form': '#fce7f3:#9d174d',
    'Lab Report'  : '#ede9fe:#5b21b6',
    'Other'       : '#f3f4f6:#374151'
  };
  var c = (palette[cat] || palette['Other']).split(':');
  return '<span style="background:' + c[0] + ';color:' + c[1] + ';' +
         'font-size:10px;font-weight:700;padding:2px 8px;' +
         'border-radius:10px;">' + esc(photoCategoryLabel(cat)) + '</span>';
}

/* =========================================================
   SECTION 7 – SLIDE VIEW
   ========================================================= */

function renderPhotoSlide() {
  if (!photoFiltered.length) {
    var viewer = g('photoSlideViewer');
    if (viewer) {
      viewer.innerHTML =
        '<div class="xray-empty" style="height:100%;' +
        'display:flex;align-items:center;justify-content:center;">' +
        '<div style="text-align:center;color:#666;">' +
        '<div style="font-size:48px;">📷</div>' +
        '<p>' + esc(mediaTr('media.noPhotos')) + '</p></div></div>';
    }
    var fs = g('photoFilmstrip');
    if (fs) fs.innerHTML = '';
    return;
  }
  if (photoCurrentIdx >= photoFiltered.length) photoCurrentIdx = 0;
  renderPhotoSlideAt(photoCurrentIdx);
  renderPhotoFilmstrip();
}

function renderPhotoSlideAt(idx) {
  photoCurrentIdx = idx;

  var x      = photoFiltered[idx];
  var isPdf  = x.file_path && x.file_path.toLowerCase().endsWith('.pdf');
  var viewer = g('photoSlideViewer');

  if (viewer) {
    if (isPdf) {
      viewer.innerHTML =
        '<a href="' + esc(x.public_url || '') + '" target="_blank" ' +
        'style="display:flex;flex-direction:column;align-items:center;' +
        'justify-content:center;color:#fbbf24;text-decoration:none;' +
        'height:100%;font-size:1rem;">' +
        '<div style="font-size:4rem;margin-bottom:.6rem;">📄</div>' +
        '<div>Click to open PDF</div></a>';
    } else {
      /* Keep the img tag so tools still work */
      var existImg = g('photoSlideImg');
      if (!existImg) {
        viewer.innerHTML =
          '<img id="photoSlideImg" src="" alt="Photo" ' +
          'style="max-width:100%;max-height:100%;object-fit:contain;">' +
          viewer.querySelector('.xray-slide-tools')
            ? '' : _buildPhotoSlideTools();
      }
      var imgEl = g('photoSlideImg');
      if (imgEl) imgEl.src = photoDisplayUrl(x);
    }
  }

  var ctr = g('photoSlideCounter');
  if (ctr) {
    ctr.textContent = mediaTrRepl('media.slide.counterFmt', {
      CURRENT: String(idx + 1),
      TOTAL: String(photoFiltered.length)
    });
  }

  var catEl = g('photoSlideCat');
  if (catEl) catEl.textContent = photoCategoryLabel(x.category);

  var dateEl = g('photoSlideDate');
  if (dateEl) dateEl.textContent = x.taken_date ? fmtDateLong(x.taken_date) : '—';

  var capEl = g('photoSlideCaption');
  if (capEl) capEl.textContent = x.caption || '—';

  /* Highlight filmstrip */
  document.querySelectorAll('.photo-fs-thumb').forEach(function(t, i) {
    t.classList.toggle('active', i === idx);
  });
}

function _buildPhotoSlideTools() {
  return '<div class="xray-slide-tools">' +
    '<button onclick="photoSlideDownload()" title="' + esc(mediaTr('media.lb.download')) + '">💾</button>' +
    '</div>';
}

function renderPhotoFilmstrip() {
  var fs = g('photoFilmstrip');
  if (!fs) return;
  fs.innerHTML = '';
  photoFiltered.forEach(function(x, i) {
    var isPdf = x.file_path && x.file_path.toLowerCase().endsWith('.pdf');
    var div   = document.createElement('div');
    div.className = 'xray-fs-thumb' + (i === photoCurrentIdx ? ' active' : '');
    var thumbU = photoDisplayUrl(x);
    div.innerHTML = isPdf
      ? '<div class="xray-fs-no-img">📄</div>'
      : (thumbU
          ? '<img src="' + esc(thumbU) + '" alt="thumb">'
          : '<div class="xray-fs-no-img">📷</div>');
    div.addEventListener('click', function() { renderPhotoSlideAt(i); });
    fs.appendChild(div);
  });
}

function photoSlideNav(dir) {
  if (!photoFiltered.length) return;
  var next = photoCurrentIdx + dir;
  if (next < 0)                     next = photoFiltered.length - 1;
  if (next >= photoFiltered.length) next = 0;
  renderPhotoSlideAt(next);
}

function photoSlideDownload() {
  var x = photoFiltered[photoCurrentIdx];
  if (!x) return;
  photoDownloadFile(photoDisplayUrl(x),
    'photo-' + (x.category || 'image') + '-' + photoCurrentIdx + '.jpg');
}


/* =========================================================
   SECTION 8 – LIGHTBOX  (parity with X-ray lightbox tooling)
   ========================================================= */

function photoLbResetScrollHost() {
  var host = g('photoLbScrollHost');
  if (host) {
    host.scrollTop  = 0;
    host.scrollLeft = 0;
  }
}

function photoLbScrollOuterDims() {
  var w = phLbLayoutBaseW * phLbTransform.scale;
  var h = phLbLayoutBaseH * phLbTransform.scale;
  w = Math.max(1, w);
  h = Math.max(1, h);
  var rad = (phLbTransform.rotate || 0) * Math.PI / 180;
  var c = Math.abs(Math.cos(rad));
  var s = Math.abs(Math.sin(rad));
  return {
    bw: Math.max(1, Math.ceil(w * c + h * s)),
    bh: Math.max(1, Math.ceil(w * s + h * c))
  };
}

function photoLbCaptureLayoutBaseFromImg() {
  var img = g('photoLbImg');
  if (!img || phLbIsVideo || img.style.display === 'none') return;
  phLbLayoutBaseW =
    Math.max(1, img.offsetWidth || img.clientWidth || 640);
  phLbLayoutBaseH =
    Math.max(1, img.offsetHeight || img.clientHeight || 480);
}

function photoLbCaptureLayoutBaseFromVideo() {
  var v = g('photoLbVideo');
  if (!v || v.style.display === 'none') return;
  phLbLayoutBaseW = Math.max(1,
    v.clientWidth  || Math.min(960, v.videoWidth  || 640));
  phLbLayoutBaseH = Math.max(1,
    v.clientHeight || Math.min(720, v.videoHeight || 480));
}

function photoLbSyncLightboxScrollShell() {
  var inner = g('photoLbScrollInner');
  var wrap  = g('photoLbMediaWrap');
  var img   = g('photoLbImg');
  var vid   = g('photoLbVideo');
  if (!inner || !wrap) return;

  var t = phLbTransform;
  var filt =
    (t.invert ? 'invert(1) ' : '') +
    'brightness(' + phLbBrightness + '%) contrast(' + phLbContrast + '%)';
  if (img && img.style.display !== 'none') img.style.filter = filt;
  if (vid && vid.style.display !== 'none') vid.style.filter = filt;

  if (!phLbLayoutBaseW || !phLbLayoutBaseH) return;

  wrap.style.width  = phLbLayoutBaseW + 'px';
  wrap.style.height = phLbLayoutBaseH + 'px';

  var d = photoLbScrollOuterDims();
  inner.style.width  = d.bw + 'px';
  inner.style.height = d.bh + 'px';

  wrap.style.transform =
    'scale(' + (t.scale * (t.flipH ? -1 : 1)) + ',' +
               (t.scale * (t.flipV ? -1 : 1)) + ') ' +
    'rotate(' + t.rotate + 'deg)';
  photoLbUpdateScrollHostCursor();
}

function photoLbUpdateScrollHostCursor() {
  var host = g('photoLbScrollHost');
  if (!host) return;
  if (phLbScrollDragging) {
    host.style.cursor = 'grabbing';
    return;
  }
  var draw = phLbTool !== 'none' && phLbTool !== 'pan';
  if (draw) {
    host.style.cursor = '';
    return;
  }
  host.style.cursor =
    phLbTransform.scale > 1.02 ? 'grab' : 'default';
}

function photoLbScrollShouldHandleDrag(e) {
  if (e.button !== 0) return false;
  if (phLbTool !== 'none' && phLbTool !== 'pan') {
    if (e.target && e.target.id === 'photoLbCanvas') return false;
  }
  return true;
}

function photoLbScrollHostMove(e) {
  if (!phLbScrollDragging) return;
  var host = g('photoLbScrollHost');
  if (!host) return;
  host.scrollLeft -= e.clientX - phLbScrollLast.x;
  host.scrollTop  -= e.clientY - phLbScrollLast.y;
  phLbScrollLast = { x: e.clientX, y: e.clientY };
}

function photoLbScrollHostUp() {
  if (!phLbScrollDragging) return;
  phLbScrollDragging = false;
  photoLbUpdateScrollHostCursor();
}

function openPhotoLightbox(idx) {
  var x = photoFiltered[idx];
  if (!x) return;
  photoLbCurrentId = x.id;

  var isPdf = x.file_path && x.file_path.toLowerCase().endsWith('.pdf');

  phLbTransform  =
    { scale: 1, rotate: 0, flipH: false, flipV: false, invert: false };
  phLbBrightness = 100;
  phLbContrast   = 100;
  phLbLayoutBaseW = 0;
  phLbLayoutBaseH = 0;
  phLbPolyPts = [];
  phLbDrawHistory = [];
  phLbCropRect = null;
  phLbIsDrawing = false;
  phLbScrollDragging = false;
  photoLbResetScrollHost();

  var bs = g('photoLbBrightSlider');
  if (bs) bs.value = 100;
  var bv = g('photoLbBrightVal');
  if (bv) bv.textContent = '100%';
  var cs = g('photoLbContrastSlider');
  if (cs) cs.value = 100;
  var cv = g('photoLbContrastVal');
  if (cv) cv.textContent = '100%';
  var cab = g('photoLbCropApplyBtn');
  if (cab) cab.style.display = 'none';
  photoLbSetTool('none');

  var raster   = g('photoLbRasterStrip');
  var scrollH  = g('photoLbScrollHost');
  var annotRow = g('photoLbAnnotMetaRow');

  if (isPdf) {
    phLbIsVideo = false;
    if (raster) raster.style.display = 'none';
    if (scrollH) scrollH.style.display = 'none';
    if (annotRow) annotRow.style.display = 'none';

    var lbPdf = g('photoLbPdf');
    var lbPdfLink = g('photoLbPdfLink');
    var lbImg = g('photoLbImg');
    var video = g('photoLbVideo');
    var vg = g('photoLbVideoGroup');
    if (lbPdf) lbPdf.style.display = 'flex';
    if (lbPdfLink) lbPdfLink.href = x.public_url || '#';
    if (lbImg) lbImg.style.display = 'none';
    if (video) {
      video.style.display = 'none';
      if (!video.paused) video.pause();
      video.src = '';
      video.onloadedmetadata = null;
    }
    if (vg) vg.style.display = 'none';

    sv('photoLbCat',     x.category   || 'Other');
    sv('photoLbDate',    x.taken_date || '');
    sv('photoLbCaption', x.caption    || '');
    sv('photoLbDr',      x.dr         || '');
    sv('photoLbClinic',  x.clinic     || '');

    var isNurse = (typeof currentRole !== 'undefined' && currentRole === 'nurse');
    var editRow = g('photoLbEditRow');
    if (editRow) editRow.style.display = isNurse ? 'none' : 'flex';

    openModal('photoLightbox');
    var plbModal = g('photoLightbox');
    if (plbModal && typeof applyI18nInRoot === 'function') applyI18nInRoot(plbModal);
    return;
  }

  if (raster) raster.style.display = 'flex';
  if (scrollH) scrollH.style.display = '';
  if (annotRow) annotRow.style.display = '';
  var lbPdf2 = g('photoLbPdf');
  if (lbPdf2) lbPdf2.style.display = 'none';

  var bare = (photoBareUrl(x) || '').split('?')[0].split('#')[0];
  phLbIsVideo = /\.(mp4|webm|mov|avi|mkv|ogv)$/i.test(bare);
  var streamUrl = photoDisplayUrl(x);

  var img   = g('photoLbImg');
  var video = g('photoLbVideo');
  var vg    = g('photoLbVideoGroup');

  if (phLbIsVideo) {
    if (img) img.style.display = 'none';
    if (video) {
      video.style.display = 'block';
      video.src = streamUrl;
      video.onloadedmetadata = function() {
        requestAnimationFrame(function() {
          photoLbCaptureLayoutBaseFromVideo();
          photoLbSyncLightboxScrollShell();
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
        photoLbInitCanvas();
      };
      img.src = streamUrl;
      if (img.complete && streamUrl) {
        photoLbInitCanvas();
      }
    }
  }

  sv('photoLbCat',     x.category   || 'Other');
  sv('photoLbDate',    x.taken_date || '');
  sv('photoLbCaption', x.caption    || '');
  sv('photoLbDr',      x.dr         || '');
  sv('photoLbClinic',  x.clinic     || '');

  var isNurse2 = (typeof currentRole !== 'undefined' && currentRole === 'nurse');
  var editRow2 = g('photoLbEditRow');
  if (editRow2) editRow2.style.display = isNurse2 ? 'none' : 'flex';

  openModal('photoLightbox');
  var plbModal2 = g('photoLightbox');
  if (plbModal2 && typeof applyI18nInRoot === 'function') applyI18nInRoot(plbModal2);
}

function closePhotoLightbox() {
  var video = g('photoLbVideo');
  if (video && !video.paused) video.pause();
  closeModal('photoLightbox');
  photoLbCurrentId = null;
}

function photoLbApplyTransform() {
  photoLbSyncLightboxScrollShell();
}

function photoLbZoom(f) {
  phLbTransform.scale *= f;
  if (phLbTransform.scale < 0.12) phLbTransform.scale = 0.12;
  if (phLbTransform.scale > 14)  phLbTransform.scale = 14;
  photoLbApplyTransform();
}

function photoLbRotate(d) {
  phLbTransform.rotate = (phLbTransform.rotate + d) % 360;
  photoLbApplyTransform();
}

function photoLbFlip(a) {
  if (a === 'h') phLbTransform.flipH = !phLbTransform.flipH;
  else           phLbTransform.flipV = !phLbTransform.flipV;
  photoLbApplyTransform();
}

function photoLbInvert() {
  phLbTransform.invert = !phLbTransform.invert;
  photoLbApplyTransform();
}

function photoLbReset() {
  phLbTransform =
    { scale: 1, rotate: 0, flipH: false, flipV: false, invert: false };
  phLbBrightness = 100;
  phLbContrast = 100;
  var bs2 = g('photoLbBrightSlider');
  if (bs2) bs2.value = 100;
  var bv2 = g('photoLbBrightVal');
  if (bv2) bv2.textContent = '100%';
  var cs2 = g('photoLbContrastSlider');
  if (cs2) cs2.value = 100;
  var cv2 = g('photoLbContrastVal');
  if (cv2) cv2.textContent = '100%';
  photoLbResetScrollHost();
  photoLbApplyTransform();
}

function photoLbSetTool(tool) {
  phLbTool = tool;
  phLbPolyPts = [];
  var canvas = g('photoLbCanvas');
  if (canvas) {
    var isDrawTool = (tool !== 'none' && tool !== 'pan');
    canvas.style.pointerEvents = isDrawTool ? 'all' : 'none';
    canvas.style.cursor        = isDrawTool ? 'crosshair' : 'default';
  }
  if (tool !== 'crop') {
    phLbCropRect = null;
    var cab2 = g('photoLbCropApplyBtn');
    if (cab2) cab2.style.display = 'none';
  }
  photoLbUpdateToolBtns();
  photoLbUpdateScrollHostCursor();
}

function photoLbUpdateToolBtns() {
  ['pan', 'free', 'line', 'arrow', 'rect', 'ellipse', 'poly', 'crop'].forEach(
    function(t) {
      var b = g('photoLbTBtn-' + t);
      if (b) b.classList.toggle('lb-tool-active', phLbTool === t);
    });
  var bAnnot = g('photoLbBtnAnnotText');
  if (bAnnot) {
    bAnnot.classList.toggle('lb-meta-tool-active', phLbTool === 'text');
  }
}

function photoLbSetColor(val)       { phLbDrawColor   = val; }
function photoLbSetStrokeWidth(val) { phLbStrokeWidth = parseInt(val, 10) || 4; }

function photoLbSetBrightness(val) {
  phLbBrightness = parseInt(val, 10) || 100;
  var el = g('photoLbBrightVal');
  if (el) el.textContent = phLbBrightness + '%';
  photoLbApplyTransform();
}

function photoLbSetContrast(val) {
  phLbContrast = parseInt(val, 10) || 100;
  var el = g('photoLbContrastVal');
  if (el) el.textContent = phLbContrast + '%';
  photoLbApplyTransform();
}

function photoLbInitCanvas() {
  var canvas = g('photoLbCanvas');
  var img    = g('photoLbImg');
  if (!canvas || !img || phLbIsVideo) return;
  photoLbCaptureLayoutBaseFromImg();
  canvas.width  = img.offsetWidth  || 800;
  canvas.height = img.offsetHeight || 600;
  phLbDrawHistory = [];
  photoLbSyncLightboxScrollShell();
}

function photoLbSaveHistory() {
  var canvas = g('photoLbCanvas');
  if (!canvas) return;
  phLbDrawHistory.push(
    canvas.getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height)
  );
  if (phLbDrawHistory.length > 20) phLbDrawHistory.shift();
}

function photoLbUndoDraw() {
  var canvas = g('photoLbCanvas');
  if (!canvas) return;
  phLbPolyPts = [];
  var ctx = canvas.getContext('2d');
  if (!phLbDrawHistory.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  ctx.putImageData(phLbDrawHistory.pop(), 0, 0);
}

function photoLbClearCanvas() {
  var canvas = g('photoLbCanvas');
  if (!canvas) return;
  photoLbSaveHistory();
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  phLbPolyPts = [];
}

function photoLbGetPos(e) {
  var canvas = g('photoLbCanvas');
  var rect   = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width  / rect.width),
    y: (e.clientY - rect.top)  * (canvas.height / rect.height)
  };
}

function photoLbCtxStyle(ctx) {
  ctx.strokeStyle = phLbDrawColor;
  ctx.fillStyle   = phLbDrawColor;
  ctx.lineWidth   = phLbStrokeWidth;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
}

function photoLbDrawShape(ctx, s, e, tool) {
  var w = e.x - s.x;
  var h = e.y - s.y;
  photoLbCtxStyle(ctx);
  ctx.beginPath();
  if (tool === 'line') {
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
  } else if (tool === 'arrow') {
    photoLbDrawArrowShape(ctx, s.x, s.y, e.x, e.y);
  } else if (tool === 'rect') {
    ctx.strokeRect(s.x, s.y, w, h);
  } else if (tool === 'ellipse') {
    var rx = Math.abs(w) / 2 || 1;
    var ry = Math.abs(h) / 2 || 1;
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

function photoLbDrawArrowShape(ctx, x1, y1, x2, y2) {
  var hl  = Math.max(14, phLbStrokeWidth * 3);
  var ang = Math.atan2(y2 - y1, x2 - x1);
  photoLbCtxStyle(ctx);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hl * Math.cos(ang - Math.PI / 6), y2 - hl * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(x2 - hl * Math.cos(ang + Math.PI / 6), y2 - hl * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function photoLbRedrawPoly() {
  var canvas = g('photoLbCanvas');
  var ctx    = canvas.getContext('2d');
  if (phLbDrawHistory.length) {
    ctx.putImageData(phLbDrawHistory[phLbDrawHistory.length - 1], 0, 0);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (!phLbPolyPts.length) return;
  photoLbCtxStyle(ctx);
  ctx.beginPath();
  ctx.moveTo(phLbPolyPts[0].x, phLbPolyPts[0].y);
  for (var i = 1; i < phLbPolyPts.length; i++) {
    ctx.lineTo(phLbPolyPts[i].x, phLbPolyPts[i].y);
  }
  ctx.stroke();
  phLbPolyPts.forEach(function(p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function photoLbPlaceTextAnnot(pos) {
  var canvas = g('photoLbCanvas');
  if (!canvas) return;
  var inp = g('photoLbAnnotTextInput');
  var txt = inp ? (inp.value || '').trim() : '';
  if (!txt) txt = 'Text';

  var szEl = g('photoLbTextFontSize');
  var fontPx = szEl ? (parseInt(szEl.value, 10) || 24) : 24;
  if (fontPx < 8) fontPx = 8;

  photoLbSaveHistory();
  var ctx = canvas.getContext('2d');
  ctx.save();
  ctx.font = 'bold ' + fontPx +
    'px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth  = Math.max(3, Math.round(phLbStrokeWidth * 0.75));
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle   = phLbDrawColor;
  ctx.strokeText(txt, pos.x, pos.y);
  ctx.fillText(txt, pos.x, pos.y);
  ctx.restore();
}

function photoLbCanvasDown(e) {
  var pos = photoLbGetPos(e);
  if (phLbTool === 'text') {
    photoLbPlaceTextAnnot(pos);
    return;
  }
  if (phLbTool === 'poly') {
    if (!phLbPolyPts.length) photoLbSaveHistory();
    phLbPolyPts.push(pos);
    photoLbRedrawPoly();
    return;
  }
  photoLbSaveHistory();
  phLbIsDrawing = true;
  phLbDrawStart = pos;
  if (phLbTool === 'free') {
    var ctx = g('photoLbCanvas').getContext('2d');
    photoLbCtxStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }
}

function photoLbCanvasMove(e) {
  if (!phLbIsDrawing) return;
  var pos    = photoLbGetPos(e);
  var canvas = g('photoLbCanvas');
  var ctx    = canvas.getContext('2d');
  if (phLbTool === 'free') {
    photoLbCtxStyle(ctx);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    return;
  }
  if (phLbDrawHistory.length) {
    ctx.putImageData(phLbDrawHistory[phLbDrawHistory.length - 1], 0, 0);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  photoLbDrawShape(ctx, phLbDrawStart, pos, phLbTool);
}

function photoLbCanvasUp(e) {
  if (!phLbIsDrawing) return;
  phLbIsDrawing = false;
  var pos    = photoLbGetPos(e);
  var canvas = g('photoLbCanvas');
  var ctx    = canvas.getContext('2d');
  if (phLbTool === 'crop') {
    phLbCropRect = {
      x: Math.min(phLbDrawStart.x, pos.x),
      y: Math.min(phLbDrawStart.y, pos.y),
      w: Math.abs(pos.x - phLbDrawStart.x),
      h: Math.abs(pos.y - phLbDrawStart.y)
    };
    if (phLbDrawHistory.length) {
      ctx.putImageData(phLbDrawHistory[phLbDrawHistory.length - 1], 0, 0);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    photoLbDrawShape(ctx, phLbDrawStart, pos, 'crop');
    var btn = g('photoLbCropApplyBtn');
    if (btn && phLbCropRect.w > 5 && phLbCropRect.h > 5) {
      btn.style.display = 'block';
    }
    return;
  }
  if (phLbTool !== 'free') {
    if (phLbDrawHistory.length) {
      ctx.putImageData(phLbDrawHistory[phLbDrawHistory.length - 1], 0, 0);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    photoLbDrawShape(ctx, phLbDrawStart, pos, phLbTool);
  } else {
    ctx.closePath();
  }
}

function photoLbCanvasDblClick(e) {
  if (phLbTool === 'poly' && phLbPolyPts.length >= 2) {
    var canvas = g('photoLbCanvas');
    var ctx    = canvas.getContext('2d');
    photoLbCtxStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(phLbPolyPts[0].x, phLbPolyPts[0].y);
    phLbPolyPts.forEach(function(p) { ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.stroke();
    phLbPolyPts = [];
  }
}

function photoLbCropApply() {
  if (!phLbCropRect || phLbCropRect.w < 5 || phLbCropRect.h < 5) return;
  var canvas = g('photoLbCanvas');
  var img    = g('photoLbImg');
  if (!canvas || !img) return;
  var tmp   = document.createElement('canvas');
  tmp.width  = phLbCropRect.w;
  tmp.height = phLbCropRect.h;
  var tCtx  = tmp.getContext('2d');
  try {
    var sx = img.naturalWidth  / canvas.width;
    var sy = img.naturalHeight / canvas.height;
    tCtx.drawImage(img,
      phLbCropRect.x * sx, phLbCropRect.y * sy,
      phLbCropRect.w * sx, phLbCropRect.h * sy,
      0, 0, tmp.width, tmp.height);
    tCtx.drawImage(canvas,
      phLbCropRect.x, phLbCropRect.y, phLbCropRect.w, phLbCropRect.h,
      0, 0, tmp.width, tmp.height);
  } catch (err) {
    alert(mediaTr('media.alert.cropFail'));
    return;
  }
  img.crossOrigin = 'anonymous';
  img.onload = function() { photoLbInitCanvas(); };
  img.src    = tmp.toDataURL('image/jpeg', 0.95);
  phLbCropRect = null;
  var cab3 = g('photoLbCropApplyBtn');
  if (cab3) cab3.style.display = 'none';
  phLbDrawHistory = [];
  photoLbSetTool('none');
}

function photoLbPrint() {
  if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
  var img    = g('photoLbImg');
  var canvas = g('photoLbCanvas');
  var video  = g('photoLbVideo');
  var src    = '';

  if (phLbIsVideo) {
    if (video && video.readyState >= 2) {
      var tmp2 = document.createElement('canvas');
      tmp2.width  = video.videoWidth  || 640;
      tmp2.height = video.videoHeight || 480;
      tmp2.getContext('2d').drawImage(video, 0, 0);
      src = tmp2.toDataURL('image/jpeg', 0.95);
    } else {
      alert(mediaTr('media.alert.noVideoFrame'));
      return;
    }
  } else {
    if (!img || !img.src) return;
    try {
      var merged   = document.createElement('canvas');
      merged.width  = canvas.width  || img.naturalWidth  || 800;
      merged.height = canvas.height || img.naturalHeight || 600;
      var mCtx = merged.getContext('2d');
      mCtx.filter =
        (phLbTransform.invert ? 'invert(1) ' : '') +
        'brightness(' + phLbBrightness + '%) contrast(' + phLbContrast + '%)';
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
      src = img.src;
    }
  }

  var w = window.open('', '_blank', 'width=920,height=720');
  if (!w) {
    alert(mediaTr('media.alert.popupBlocked'));
    return;
  }
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

function photoLbVidStart() {
  var v = g('photoLbVideo');
  if (v) v.currentTime = 0;
}

function photoLbVidBack() {
  var v = g('photoLbVideo');
  if (v) v.currentTime = Math.max(0, v.currentTime - 10);
}

function photoLbVidPlayPause() {
  var v = g('photoLbVideo');
  var btn = g('photoLbVidPlayBtn');
  if (!v) return;
  if (v.paused) {
    v.play();
    if (btn) btn.textContent = '⏸';
  } else {
    v.pause();
    if (btn) btn.textContent = '▶️';
  }
}

function photoLbVidFwd() {
  var v = g('photoLbVideo');
  if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
}

function photoLbVidEnd() {
  var v = g('photoLbVideo');
  if (v && v.duration) v.currentTime = v.duration;
}

function photoLbVidStop() {
  var v = g('photoLbVideo');
  var btn = g('photoLbVidPlayBtn');
  if (!v) return;
  v.pause();
  v.currentTime = 0;
  if (btn) btn.textContent = '▶️';
}

function photoLbVidSeekTo(pct) {
  var v = g('photoLbVideo');
  if (v && v.duration) {
    v.currentTime = (parseFloat(pct) / 100) * v.duration;
  }
}

function photoLbOverlayHasInk() {
  var canvas = g('photoLbCanvas');
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

function photoLbNeedsImagePersist() {
  if (phLbIsVideo) return false;
  var img = g('photoLbImg');
  if (img && img.src && img.src.indexOf('data:image') === 0) return true;
  if (phLbBrightness !== 100 || phLbContrast !== 100 || phLbTransform.invert) {
    return true;
  }
  return photoLbOverlayHasInk();
}

function photoLbBuildMergedImageBlobInner(callback) {
  var img    = g('photoLbImg');
  var canvas = g('photoLbCanvas');
  if (!img || !canvas || phLbIsVideo ||
      !img.complete || img.naturalWidth === 0) {
    callback(null);
    return;
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
      (phLbTransform.invert ? 'invert(1) ' : '') +
      'brightness(' + phLbBrightness + '%) contrast(' + phLbContrast + '%)';
    mCtx.drawImage(img, 0, 0, nw, nh);
    mCtx.filter = 'none';
    mCtx.save();
    mCtx.scale(nw / cw, nh / ch);
    mCtx.drawImage(canvas, 0, 0);
    mCtx.restore();

    if (typeof canvasToJpegBlob === 'function') {
      canvasToJpegBlob(merged, 0.92, callback);
    } else {
      merged.toBlob(callback, 'image/jpeg', 0.92);
    }
  } catch (err) {
    callback(null);
  }
}

function photoLbComposeMergeViaFetch(record, callback) {
  var bare = (photoBareUrl(record) || '').split('#')[0];
  bare = bare.split('?')[0];
  if (!bare) {
    callback(null);
    return;
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
          var canvasOv = g('photoLbCanvas');
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
            (phLbTransform.invert ? 'invert(1) ' : '') +
            'brightness(' + phLbBrightness + '%) contrast(' + phLbContrast + '%)';
          mCtx.drawImage(im, 0, 0, nw, nh);
          mCtx.filter = 'none';
          mCtx.save();
          mCtx.scale(nw / cw, nh / ch);
          mCtx.drawImage(canvasOv, 0, 0);
          mCtx.restore();

          if (typeof canvasToJpegBlob === 'function') {
            canvasToJpegBlob(merged, 0.92, callback);
          } else {
            merged.toBlob(callback, 'image/jpeg', 0.92);
          }
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

function photoLbExportEditedJpegForSave(callback) {
  photoLbBuildMergedImageBlobInner(function(blob) {
    if (blob && blob.size > 0) {
      callback(blob);
      return;
    }
    var recRow = photoAllRecords.find(function(x) {
      return x.id === photoLbCurrentId;
    });
    if (!recRow || phLbIsVideo) {
      callback(null);
      return;
    }
    photoLbComposeMergeViaFetch(recRow, function(blob2) {
      callback((blob2 && blob2.size > 0) ? blob2 : null);
    });
  });
}

function savePhotoLbMeta() {
  if (!photoLbCurrentId) return;

  var rec = photoAllRecords.find(function(x) {
    return x.id === photoLbCurrentId;
  });

  function finishOk(msg) {
    closePhotoLightbox();
    loadPhotoRecords().then(function() {
      alert(msg || mediaTr('media.alert.savedDefault'));
    });
  }

  function metaPayload() {
    return {
      category   : g('photoLbCat') ? g('photoLbCat').value : null,
      taken_date : g('photoLbDate') ? g('photoLbDate').value || null : null,
      caption    : g('photoLbCaption') ? g('photoLbCaption').value.trim() : null,
      dr         : g('photoLbDr') ? g('photoLbDr').value.trim() : null,
      clinic     : g('photoLbClinic') ? g('photoLbClinic').value.trim() : null
    };
  }

  function saveMetaOnly() {
    SB.from('photos').update(metaPayload()).eq('id', photoLbCurrentId)
      .then(function(r) {
        if (r.error) { alert(mediaErr(r.error.message)); return; }
        finishOk(mediaTr('media.alert.photoDetailsSaved'));
      });
  }

  var isPdf = !!(rec &&
    rec.file_path && rec.file_path.toLowerCase().endsWith('.pdf'));

  if (isPdf || phLbIsVideo || !photoLbNeedsImagePersist()) {
    saveMetaOnly();
    return;
  }

  photoLbExportEditedJpegForSave(function(blob) {
    if (!blob) {
      alert(mediaTr('media.alert.exportEditFail'));
      saveMetaOnly();
      return;
    }

    if (!photoPatientId) {
      alert(mediaTr('media.alert.patientContextMissingDetails'));
      saveMetaOnly();
      return;
    }

    var safeName = photoPatientId + '/' +
      Date.now() + '_' +
      Math.random().toString(36).slice(2) + '.jpg';

    var oldPath = rec && rec.file_path;

    SB.storage.from(PHOTO_BUCKET)
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
        var publicUrl = photoGetPublicUrlForPath(safeName);

        if (!publicUrl) {
          alert(mediaTrRepl('media.alert.publicUrlFail', { BUCKET: PHOTO_BUCKET }));
          saveMetaOnly();
          return null;
        }

        var chain = Promise.resolve();
        if (oldPath && oldPath !== safeName) {
          chain = SB.storage.from(PHOTO_BUCKET)
            .remove([oldPath])
            .then(function() {}, function() {});
        }

        return chain.then(function() {
          var payload = metaPayload();
          payload.file_path = safeName;
          payload.public_url = publicUrl;
          return SB.from('photos').update(payload).eq('id', photoLbCurrentId);
        });
      })
      .then(function(r) {
        if (!r) return;
        if (r.error) {
          alert(mediaTrRepl('media.alert.dbUpdateFailPhoto', { MSG: r.error.message }));
          return;
        }
        finishOk(mediaTr('media.alert.photoSavedFull'));
      });
  });
}

function deletePhotoLb() {
  if (!photoLbCurrentId) return;
  if (!confirm(mediaTr('media.alert.confirmDeletePhoto'))) return;

  var rec = photoAllRecords.find(function(x) { return x.id === photoLbCurrentId; });
  var chain = Promise.resolve();

  if (rec && rec.file_path) {
    chain = SB.storage.from(PHOTO_BUCKET)
      .remove([rec.file_path])
      .then(function(r) {
        if (r.error) console.warn('[Photos] Storage delete:', r.error.message);
      });
  }

  chain.then(function() {
    return SB.from('photos').delete().eq('id', photoLbCurrentId);
  }).then(function(r) {
    if (r.error) { alert(mediaErr(r.error.message)); return; }
    closePhotoLightbox();
    loadPhotoRecords();
  });
}

function downloadPhotoLb() {
  var rec = photoAllRecords.find(function(x) {
    return x.id === photoLbCurrentId;
  });
  if (!rec || !rec.public_url) return;
  photoDownloadFile(
    photoDisplayUrl(rec),
    'photo-' + (rec.category || 'image') + '.jpg');
}

/* =========================================================
   SECTION 9 – UPLOAD FLOW  (mirrors xray upload exactly)
   ========================================================= */

document.addEventListener('DOMContentLoaded', function() {
  var fi = g('photoFileInput');
  if (fi) {
    fi.addEventListener('change', function() {
      if (!photoPatientId) {
        alert(mediaTr('con.forms.alertSelectPatient'));
        fi.value = '';
        return;
      }
      if (!fi.files || !fi.files.length) return;
      photoUploadQueue = Array.from(fi.files);
      photoUploadQIdx  = 0;
      processNextPhotoUpload();
      fi.value = '';
    });
  }

  var confirmBtn = g('btnConfirmPhotoUpload');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', confirmPhotoUpload);
  }

  /* Photo lightbox — pan scroll shell + ink canvas */
  var plbHost = g('photoLbScrollHost');
  if (plbHost) {
    plbHost.addEventListener('mousedown', function(e) {
      if (!photoLbScrollShouldHandleDrag(e)) return;
      phLbScrollDragging = true;
      phLbScrollLast = { x: e.clientX, y: e.clientY };
      plbHost.style.cursor = 'grabbing';
      e.preventDefault();
    });
  }
  document.addEventListener('mousemove', photoLbScrollHostMove);
  document.addEventListener('mouseup', photoLbScrollHostUp);

  var plbCvs = g('photoLbCanvas');
  if (plbCvs) {
    plbCvs.addEventListener('mousedown', photoLbCanvasDown);
    plbCvs.addEventListener('mousemove', photoLbCanvasMove);
    plbCvs.addEventListener('mouseup', photoLbCanvasUp);
    plbCvs.addEventListener('dblclick', photoLbCanvasDblClick);
    plbCvs.addEventListener('mouseleave', function(e) {
      if (phLbIsDrawing) photoLbCanvasUp(e);
    });
  }
});

function processNextPhotoUpload() {
  if (photoUploadQIdx >= photoUploadQueue.length) {
    closeModal('photoUploadModal');
    loadPhotoRecords();
    return;
  }
  showPhotoUploadModal(photoUploadQueue[photoUploadQIdx]);
}

function showPhotoUploadModal(file) {
  var wrap = g('photoUploadPreviewWrap');
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

  /* Reset form fields */
  sv('photoUploadCat',   'Intraoral');
  sv('photoUploadDate',  todayISO());
  sv('photoUploadDr',    '');
  sv('photoUploadClinic','');
  sv('photoUploadCaption','');

  var info = g('photoUploadMultiInfo');
  if (info) {
    var remaining = photoUploadQueue.length - photoUploadQIdx;
    info.textContent = remaining > 1
      ? mediaTrRepl('media.upload.fileOf', {
          N: String(photoUploadQIdx + 1),
          TOTAL: String(photoUploadQueue.length)
        })
      : '';
  }

  openModal('photoUploadModal');
}

function confirmPhotoUpload() {
  var file    = photoUploadQueue[photoUploadQIdx];
  var cat     = g('photoUploadCat')    ? g('photoUploadCat').value              : 'Other';
  var date    = g('photoUploadDate')   ? g('photoUploadDate').value             : todayISO();
  var dr      = g('photoUploadDr')     ? g('photoUploadDr').value.trim()        : '';
  var clinic  = g('photoUploadClinic') ? g('photoUploadClinic').value.trim()    : '';
  var caption = g('photoUploadCaption')? g('photoUploadCaption').value.trim()   : '';

  closeModal('photoUploadModal');
  showPhotoUploadProgress(true, mediaTr('media.upload.preparing'), 5);

  var ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
  var safeName = photoPatientId + '/' +
                 Date.now() + '_' +
                 Math.random().toString(36).slice(2) + '.' + ext;

  var mimeMap = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'png': 'image/png',  'webp': 'image/webp',
    'heic':'image/heic', 'pdf' : 'application/pdf'
  };
  var contentType = file.type || mimeMap[ext] || 'application/octet-stream';

  showPhotoUploadProgress(true, mediaTr('media.upload.uploadingStorage'), 20);

  /* ── Step 1: Upload to Storage ── */
  SB.storage.from(PHOTO_BUCKET)
    .upload(safeName, file, {
      cacheControl: '3600',
      upsert      : false,
      contentType : contentType
    })
  .then(function(r) {
    if (r.error) {
      showPhotoUploadProgress(false);
      alert(mediaTrRepl('media.alert.uploadFailed', { MSG: r.error.message }));
      return null;
    }
    showPhotoUploadProgress(true, mediaTr('media.upload.gettingUrl'), 60);
    return { ok: true, path: safeName };
  })

  /* ── Step 2: Get public URL ── */
  .then(function(res) {
    if (!res || !res.ok) return null;

    var urlRes    = SB.storage.from(PHOTO_BUCKET).getPublicUrl(res.path);
    var publicUrl = (urlRes.data && urlRes.data.publicUrl)
                    ? urlRes.data.publicUrl : null;

    showPhotoUploadProgress(true, mediaTr('media.upload.savingRecord'), 80);

    /* ── Step 3: Insert DB record ── */
    return SB.from('photos').insert([{
      patient_id : photoPatientId,
      file_path  : res.path,
      public_url : publicUrl,
      category   : cat,
      caption    : caption || null,
      taken_date : date    || null,
      dr         : dr      || null,
      clinic     : clinic  || null,
      uploaded_by: (typeof currentName !== 'undefined' ? currentName : null)
    }]);
  })

  /* ── Step 4: Handle result ── */
  .then(function(r) {
    if (!r) return;
    if (r.error) {
      showPhotoUploadProgress(false);
      alert(mediaTrRepl('media.alert.dbError', { MSG: r.error.message }));
      return;
    }
    showPhotoUploadProgress(true, mediaTr('media.upload.done'), 100);
    setTimeout(function() {
      showPhotoUploadProgress(false);
      photoUploadQIdx++;
      processNextPhotoUpload();
    }, 700);
  })
  .catch(function(err) {
    showPhotoUploadProgress(false);
    alert(mediaTrRepl('media.alert.unexpected', { MSG: (err.message || String(err)) }));
  });
}

function showPhotoUploadProgress(show, label, pct) {
  var bar = g('photoUploadProgress');
  if (!bar) return;
  bar.style.display = show ? 'block' : 'none';
  if (!show) return;
  var fill = g('photoProgressFill');
  var lbl  = g('photoProgressLabel');
  if (fill) fill.style.width = (pct || 0) + '%';
  if (lbl)  lbl.textContent  = label || '';
}

/* =========================================================
   SECTION 10 – EXPORT / DOWNLOAD
   ========================================================= */

function exportSelectedPhotos() {
  if (!photoSelected.size) {
    alert(mediaTr('media.alert.selectPhotoExport'));
    return;
  }
  var toExport = photoFiltered.filter(function(x) {
    return photoSelected.has(x.id);
  });
  toExport.forEach(function(x, i) {
    setTimeout(function() {
      photoDownloadFile(x.public_url,
        'photo-' + (x.category || 'image') + '-' + i + '.jpg');
    }, i * 400);
  });
}

function exportAllPhotos() {
  if (!photoFiltered.length) { alert(mediaTr('media.alert.noPhotosExport')); return; }
  if (!confirm(mediaTrRepl('media.alert.confirmDownloadPhotos', { N: String(photoFiltered.length) }))) return;
  photoFiltered.forEach(function(x, i) {
    setTimeout(function() {
      photoDownloadFile(x.public_url,
        'photo-' + (x.category || 'image') + '-' + i + '.jpg');
    }, i * 500);
  });
}

function photoDownloadFile(url, filename) {
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
      a.download  = filename || 'photo.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 10000);
    })
    .catch(function(err) {
      alert(mediaTrRepl('media.alert.downloadFailed', { MSG: err.message }));
    });
}

/* =========================================================
   SECTION 11 – SELECT ALL / COUNT
   ========================================================= */

function togglePhotoSelectAll(checked) {
  photoFiltered.forEach(function(x) {
    if (checked) photoSelected.add(x.id);
    else         photoSelected.delete(x.id);
  });
  document.querySelectorAll('.photo-cb').forEach(function(cb) {
    cb.checked = checked;
  });
  updatePhotoSelectedCount();
}

function updatePhotoSelectedCount() {
  var el = g('photoSelectedCount');
  if (!el) return;
  el.textContent = photoSelected.size
    ? mediaTrRepl('media.selectedCount', { N: String(photoSelected.size) }) : '';
}

/* =========================================================
   SECTION 12 – BULK DELETE
   ========================================================= */

function bulkDeletePhotos() {
  if (!photoSelected.size) {
    alert(mediaTr('media.alert.selectPhotoDelete'));
    return;
  }
  if (!confirm(mediaTrRepl('media.alert.confirmBulkDeletePhotos', { N: String(photoSelected.size) })))
    return;

  var ids      = Array.from(photoSelected);
  var toDelete = photoAllRecords.filter(function(r) {
    return ids.indexOf(r.id) > -1;
  });
  var paths    = toDelete.map(function(r) { return r.file_path; }).filter(Boolean);

  var chain = Promise.resolve();
  if (paths.length) {
    chain = SB.storage.from(PHOTO_BUCKET).remove(paths)
      .then(function(r) {
        if (r.error) console.warn('[Photos] Bulk storage delete:', r.error.message);
      });
  }

  chain.then(function() {
    return SB.from('photos').delete().in('id', ids);
  }).then(function(r) {
    if (r.error) { alert(mediaTrRepl('media.alert.bulkDeleteFailed', { MSG: r.error.message })); return; }
    photoSelected.clear();
    loadPhotoRecords();
  });
}

/* =========================================================
   SECTION 13 – REFRESH
   ========================================================= */

function refreshPhotos() {
  if (!photoPatientId) return;
  loadPhotoRecords();
}

/* =========================================================
   SECTION 14 – HELPERS
   ========================================================= */

/* todayISO() — use global from app.js (PC local calendar date, not UTC) */

function refreshPhotoUiForLangChange() {
  if (typeof updatePhotoSelectedCount === 'function') updatePhotoSelectedCount();
  if (!photoPatientId || !photoFiltered.length) return;
  var slide = g('photoSlideView');
  if (slide && slide.style.display !== 'none' && typeof renderPhotoSlideAt === 'function') {
    renderPhotoSlideAt(photoCurrentIdx);
  } else if (photoView === 'grid' && typeof renderPhotoGrid === 'function') {
    renderPhotoGrid();
  }
}

document.addEventListener('app-lang-change', function () {
  refreshPhotoCategorySelects();
  refreshPhotoBannerI18n();
  var uploadModal = g('photoUploadModal');
  var lbModal = g('photoLightbox');
  if (typeof applyI18nInRoot === 'function') {
    if (uploadModal && uploadModal.style.display === 'block') applyI18nInRoot(uploadModal);
    if (lbModal && lbModal.style.display === 'block') applyI18nInRoot(lbModal);
  }
  if (photoPatientId) {
    if (photoAllRecords.length && typeof populatePhotoYearFilter === 'function') {
      populatePhotoYearFilter();
    }
    if (typeof refreshPhotoUiForLangChange === 'function') refreshPhotoUiForLangChange();
    if (typeof applyI18nInRoot === 'function') {
      var pPaneEarly = g('con-photos');
      if (pPaneEarly) applyI18nInRoot(pPaneEarly);
      var pBanner = g('conPhotoBanner');
      if (pBanner) applyI18nInRoot(pBanner);
    }
  }
  var sec = g('consultationSection');
  if (!sec || sec.style.display === 'none') return;
  if (photoPatientId && typeof loadPhotoRecords === 'function') loadPhotoRecords();
});

document.addEventListener('DOMContentLoaded', function () {
  refreshPhotoCategorySelects();
});
