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
var photoKindFilter  = 'photos';

var photoLbCurrentId  = null;
var _photoLbMetaDirty = false;  // true when metadata fields edited without saving

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

/** Non-blocking toast; falls back to the browser dialog if the media hub module is unavailable. */
function mediaNotify(msg, kind) {
    if (typeof conMediaNotify === 'function') conMediaNotify(msg, kind);
    else window.alert(msg);
}

var PHOTO_CATEGORY_PAIRS = [
    ['Intraoral', 'media.cat.intraoral'],
    ['Extraoral', 'media.cat.extraoral'],
    ['Before', 'media.cat.before'],
    ['After', 'media.cat.after'],
    ['Progress', 'media.cat.progress'],
    ['Before/After', 'media.cat.beforeAfter'],
    ['Consent Form', 'media.cat.consentForm'],
    ['Lab Report', 'media.cat.labReport'],
    ['Scanned Document', 'media.cat.scanDoc'],
    ['Other', 'media.categoryOther']
];

function photoTimepointOf(rec) {
    var c = String((rec && rec.category) || rec || '').trim().toLowerCase();
    if (c === 'before') return 'before';
    if (c === 'after') return 'after';
    if (c === 'progress') return 'progress';
    return '';
}

function photoIsDocRec(x) {
    var p = String((x && x.file_path) || (x && x.public_url) || '').toLowerCase();
    if (/\.pdf(\?|$)/.test(p)) return true;
    var c = String((x && x.category) || '');
    return c === 'Consent Form' || c === 'Lab Report' || c === 'Scanned Document';
}

function photoVisitKey(rec) {
    return String((rec && rec.taken_date) || '').slice(0, 10);
}

function photoVisitGroups(list) {
    var map = {};
    var order = [];
    (list || []).forEach(function(x) {
        var k = photoVisitKey(x);
        if (!map[k]) { map[k] = []; order.push(k); }
        map[k].push(x);
    });
    order.sort(function(a, b) {
        if (!a) return 1;
        if (!b) return -1;
        return a > b ? -1 : a < b ? 1 : 0;
    });
    return order.map(function(k) { return { date: k, rows: map[k] }; });
}

function setPhotoKind(kind) {
    photoKindFilter = (kind === 'docs' || kind === 'all') ? kind : 'photos';
    var map = { all: 'btnPhotoKindAll', photos: 'btnPhotoKindPhotos', docs: 'btnPhotoKindDocs' };
    Object.keys(map).forEach(function(k) {
        var b = g(map[k]);
        if (b) b.classList.toggle('active', k === photoKindFilter);
    });
    filterPhotos();
}

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
        if (includeAll && typeof conMediaTr === 'function') {
            html += '<option value="__consent_lab">' + esc(conMediaTr('cm.hub.consent')) + '</option>';
        }
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
var photoLbChromeMaximized = false;
var photoLbChromeMetaVisible = true;
var photoLbChromeScaleBeforeMax = 1;

const PHOTO_CATEGORIES = [
  'Intraoral', 'Extraoral', 'Before', 'After', 'Progress', 'Before/After',
  'Consent Form', 'Lab Report', 'Scanned Document', 'Other'
];

/* =========================================================
   SECTION 1 – SYNC / INIT (called by app-consultation.js)
   ========================================================= */

function syncPhotoPatient(pid, pdata) {
  if (pid && pid !== photoPatientId) {
    selectPhotoPatient(pdata || { id: pid });
  }
}

function photoResolveCurrentPatient() {
  if (photoPatientId && photoPatientData) return photoPatientData;
  if (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id) {
    return conPatientData;
  }
  if (typeof activePatientSlots !== 'undefined' && activePatientSlots[0] &&
      activePatientSlots[0].id) {
    return activePatientSlots[0];
  }
  if (typeof _patientDetailsPatient !== 'undefined' && _patientDetailsPatient &&
      _patientDetailsPatient.id) {
    return _patientDetailsPatient;
  }
  return null;
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

/* Patient is chosen once in the Consultation header; this tab follows it (no separate search box). */

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
    if (typeof photoOrthoHydrateFromRecords === 'function') photoOrthoHydrateFromRecords();
    populatePhotoCatFilter();
    populatePhotoYearFilter();
    filterPhotos();
    if (typeof conMediaConsumePendingOpen === 'function') conMediaConsumePendingOpen();
    if (typeof conMediaScheduleSummary === 'function') conMediaScheduleSummary(true);
    if (typeof conMediaCompareSync === 'function') conMediaCompareSync();
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
  var consentLabOnly = cat === '__consent_lab';

  photoFiltered = photoAllRecords.filter(function(x) {
    if (typeof photoIsOrthoSidecar === 'function' && photoIsOrthoSidecar(x)) return false;
    if (photoKindFilter === 'docs' && !photoIsDocRec(x)) return false;
    if (photoKindFilter === 'photos' && photoIsDocRec(x)) return false;
    if (consentLabOnly) {
      if (typeof conMediaIsConsentLabCat !== 'function' || !conMediaIsConsentLabCat(x.category)) return false;
    } else if (cat && (x.category || '').toLowerCase() !== cat) return false;
    if (year && (!x.taken_date || !x.taken_date.startsWith(year))) return false;
    if (query) {
      if (typeof conMediaPhotoMatchesQuery === 'function') {
        if (!conMediaPhotoMatchesQuery(x, query)) return false;
      } else if (!(
          (x.caption || '').toLowerCase().includes(query) ||
          (x.notes   || '').toLowerCase().includes(query)
        )) return false;
    }
    return true;
  });

  photoSelected.clear();
  updatePhotoSelectedCount();

  var sa = g('photoSelectAll');
  if (sa) sa.checked = false;

  if (photoView === 'grid') renderPhotoGrid();
  else                      renderPhotoSlide();
  if (typeof photoOrthoRenderIfOpen === 'function') photoOrthoRenderIfOpen();
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
  var visitGroups = photoVisitGroups(photoFiltered);

  visitGroups.forEach(function(group) {
    var head = document.createElement('div');
    head.className = 'photo-visit-head';
    head.dataset.visit = group.date || '';
    var visitLabel = group.date
      ? (typeof fmtDateLong === 'function' ? fmtDateLong(group.date) : group.date)
      : mediaTr('media.noDate');
    head.innerHTML = '<strong>' + esc(visitLabel) + '</strong><span>' +
      esc(mediaTrRepl('media.visit.count', { N: String(group.rows.length) })) + '</span>';
    grid.appendChild(head);

  group.rows.forEach(function(x) {
    var idx = photoFiltered.indexOf(x);
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
        (typeof conMediaPhotoBadgesHtml === 'function' ? conMediaPhotoBadgesHtml(x) : '') +
        (x.caption
          ? '<div class="xray-card-notes">' + esc(x.caption) + '</div>'
          : '') +
        '<div class="xray-card-actions">' +
          '<button class="xray-cb-open" data-idx="' + idx + '">' +
            esc(mediaTr('media.btn.view')) +
          '</button>' +
          (!isPdf && typeof conMediaCompareToggle === 'function'
            ? '<button class="xray-cb-cmp" type="button" title="' + esc(conMediaTr('cm.cmp.toggleTitle')) + '">⇄</button>'
            : '') +
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

    if (!isPdf) {
      card.draggable = true;
      card.addEventListener('dragstart', function(e) {
        if (e.target.closest('input, button, a')) {
          e.preventDefault();
          return;
        }
        photoOrthoDrag = { id: String(x.id) };
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', String(x.id));
          e.dataTransfer.effectAllowed = 'copy';
        }
      });
    }

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

    var cmpBtn = card.querySelector('.xray-cb-cmp');
    if (cmpBtn) {
      cmpBtn.addEventListener('click', function() { conMediaCompareToggle(x.id); });
    }
  });
  });
  if (typeof conMediaCompareSync === 'function') conMediaCompareSync();
}

function getPhotoCatBadge(cat) {
  var palette = {
    'Intraoral'   : '#dbeafe:#1d4ed8',
    'Extraoral'   : '#dcfce7:#166534',
    'Before'      : '#ffedd5:#9a3412',
    'After'       : '#dcfce7:#166534',
    'Progress'    : '#e0e7ff:#3730a3',
    'Before/After': '#fef9c3:#713f12',
    'Consent Form': '#fce7f3:#9d174d',
    'Lab Report'  : '#ede9fe:#5b21b6',
    'Scanned Document': '#cffafe:#155e75',
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

function photoLbResetLightboxChrome() {
  photoLbChromeMaximized = false;
  photoLbChromeMetaVisible = true;
  photoLbChromeScaleBeforeMax = 1;
  photoLbSyncLightboxChrome();
}

function photoLbFitToScrollHost() {
  if (!phLbLayoutBaseW || !phLbLayoutBaseH) return;
  var host = g('photoLbScrollHost');
  if (!host || host.style.display === 'none') return;

  var pad = 20;
  var vpW = Math.max(1, host.clientWidth - pad * 2);
  var vpH = Math.max(1, host.clientHeight - pad * 2);

  var prevScale = phLbTransform.scale;
  phLbTransform.scale = 1;
  var d = photoLbScrollOuterDims();
  phLbTransform.scale = prevScale;

  if (!d.bw || !d.bh) return;
  var fit = Math.min(vpW / d.bw, vpH / d.bh);
  if (!isFinite(fit) || fit <= 0) return;

  phLbTransform.scale = Math.max(0.12, Math.min(14, fit));
  photoLbResetScrollHost();
  photoLbSyncLightboxScrollShell();
}

function photoLbSyncLightboxChrome(options) {
  options = options || {};
  var modal = g('photoLightbox');
  var main = g('photoLbMain');
  var maxBtn = g('photoLbToggleMaxBtn');
  var metaBtn = g('photoLbToggleMetaBtn');
  var restoreBtn = g('photoLbRestoreMaxBtn');

  if (modal) {
    modal.classList.toggle('xray-lb-maximized', photoLbChromeMaximized);
  }
  if (document.body) {
    document.body.classList.toggle('xray-lb-maximized', photoLbChromeMaximized);
  }
  if (main) {
    main.classList.toggle('xray-lb-meta-hidden', !photoLbChromeMetaVisible);
  }
  if (maxBtn) {
    maxBtn.classList.toggle('lb-chrome-active', photoLbChromeMaximized);
    maxBtn.textContent = photoLbChromeMaximized ? '⤢' : '⛶';
    maxBtn.setAttribute('title', mediaTr(photoLbChromeMaximized ? 'media.lb.restore' : 'media.lb.maximize'));
    maxBtn.setAttribute('aria-pressed', photoLbChromeMaximized ? 'true' : 'false');
  }
  if (metaBtn) {
    metaBtn.classList.toggle('lb-chrome-active', !photoLbChromeMetaVisible);
    metaBtn.textContent = photoLbChromeMetaVisible ? '◧' : '◨';
    metaBtn.setAttribute('title', mediaTr(photoLbChromeMetaVisible ? 'media.lb.hideInfo' : 'media.lb.showInfo'));
    metaBtn.setAttribute('aria-pressed', photoLbChromeMetaVisible ? 'true' : 'false');
  }
  var edgeBtn = g('photoLbMetaEdgeBtn');
  if (edgeBtn) {
    var edgeTri = edgeBtn.querySelector('.xray-lb-meta-edge-tri');
    if (edgeTri) edgeTri.textContent = photoLbChromeMetaVisible ? '▶' : '◀';
    edgeBtn.setAttribute('title', mediaTr(photoLbChromeMetaVisible ? 'media.lb.hideInfo' : 'media.lb.showInfo'));
    edgeBtn.setAttribute('aria-label', mediaTr(photoLbChromeMetaVisible ? 'media.lb.hideInfo' : 'media.lb.showInfo'));
    edgeBtn.setAttribute('aria-pressed', photoLbChromeMetaVisible ? 'false' : 'true');
  }
  if (restoreBtn) {
    restoreBtn.setAttribute('aria-hidden', photoLbChromeMaximized ? 'false' : 'true');
  }

  requestAnimationFrame(function () {
    photoLbSyncLightboxScrollShell();
    if (!photoLbChromeMaximized) {
      photoLbResetScrollHost();
      photoLbSyncLightboxScrollShell();
    } else if (options.refitMax) {
      requestAnimationFrame(function () {
        photoLbFitToScrollHost();
      });
    }
  });
}

function photoLbToggleMaximize() {
  if (!photoLbChromeMaximized) {
    photoLbChromeScaleBeforeMax = phLbTransform.scale;
    photoLbChromeMaximized = true;
    photoLbSyncLightboxChrome({ refitMax: true });
  } else {
    photoLbChromeMaximized = false;
    phLbTransform.scale = photoLbChromeScaleBeforeMax;
    photoLbSyncLightboxChrome();
  }
}

function photoLbToggleMetaPanel() {
  photoLbChromeMetaVisible = !photoLbChromeMetaVisible;
  photoLbSyncLightboxChrome({ refitMax: photoLbChromeMaximized });
}

if (!window.__photoLbMaxResizeBound) {
  window.__photoLbMaxResizeBound = true;
  window.addEventListener('resize', function () {
    var modal = g('photoLightbox');
    if (!photoLbChromeMaximized || !modal || modal.style.display !== 'block') return;
    photoLbFitToScrollHost();
  });
}

/* Auto-fit the photo whenever the lightbox panel changes size
   (manual drag-resize via the corner grip, or maximize/restore). */
function photoLbInitBoxResizeObserver() {
  if (window.__photoLbBoxRO || typeof ResizeObserver === 'undefined') return;
  var box = document.querySelector('#photoLightbox .xray-lightbox-box');
  if (!box) return;
  window.__photoLbBoxRO = new ResizeObserver(function () {
    var modal = g('photoLightbox');
    if (!modal || modal.style.display !== 'block') return;
    if (!photoLbChromeMaximized && !box.style.width && !box.style.height) return;
    if (window.__photoLbBoxROraf) cancelAnimationFrame(window.__photoLbBoxROraf);
    window.__photoLbBoxROraf = requestAnimationFrame(function () {
      photoLbFitToScrollHost();
    });
  });
  window.__photoLbBoxRO.observe(box);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', photoLbInitBoxResizeObserver);
} else {
  photoLbInitBoxResizeObserver();
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
  photoLbResetLightboxChrome();

  var bs = g('photoLbBrightSlider');
  if (bs) bs.value = 100;
  var bv = g('photoLbBrightVal');
  if (bv) bv.textContent = '100%';
  var cs = g('photoLbContrastSlider');
  if (cs) cs.value = 100;
  var cv = g('photoLbContrastVal');
  if (cv) cv.textContent = '100%';
  var cab = g('photoLbCropApplyBtn');
  if (cab) photoLbShowCropApply(false);
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
    photoLbFillContext(x);

    _photoLbMetaDirty = false;
    _photoLbWireDirtyListeners();

    var isNurse = (typeof currentRole !== 'undefined' && currentRole === 'nurse');
    var editRow = g('photoLbEditRow');
    if (editRow) editRow.style.display = isNurse ? 'none' : 'flex';

    openModal('photoLightbox');
    var plbModal = g('photoLightbox');
    if (plbModal && typeof applyI18nInRoot === 'function') applyI18nInRoot(plbModal);
    if (typeof photoLbSyncLightboxChrome === 'function') photoLbSyncLightboxChrome();
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
  photoLbFillContext(x);

  _photoLbMetaDirty = false;
  _photoLbWireDirtyListeners();

  var isNurse2 = (typeof currentRole !== 'undefined' && currentRole === 'nurse');
  var editRow2 = g('photoLbEditRow');
  if (editRow2) editRow2.style.display = isNurse2 ? 'none' : 'flex';

  openModal('photoLightbox');
  var plbModal2 = g('photoLightbox');
  if (plbModal2 && typeof applyI18nInRoot === 'function') applyI18nInRoot(plbModal2);
  if (typeof photoLbSyncLightboxChrome === 'function') photoLbSyncLightboxChrome();
}

function photoLbFillContext(rec) {
    if (typeof conMediaPhotoCtxFill === 'function') conMediaPhotoCtxFill('photoLb', rec, false);
    if (typeof conMediaPhotoLbSyncExtras === 'function') conMediaPhotoLbSyncExtras(rec);
}

function _photoLbWireDirtyListeners() {
    ['photoLbCat','photoLbDate','photoLbCaption','photoLbDr','photoLbClinic',
     'photoLbTooth','photoLbTags','photoLbAppt'].forEach(function(id) {
        var el = g(id);
        if (!el || el._photoLbDirtyBound) return;
        el._photoLbDirtyBound = true;
        el.addEventListener('input',  function() { _photoLbMetaDirty = true; });
        el.addEventListener('change', function() { _photoLbMetaDirty = true; });
    });
}

function photoLbHasUnsavedChanges() {
    return _photoLbMetaDirty || photoLbNeedsImagePersist();
}

function _forceClosePhotoLightbox() {
    _photoLbMetaDirty = false;
    var video = g('photoLbVideo');
    if (video && !video.paused) video.pause();
    closeModal('photoLightbox');
    photoLbCurrentId = null;
    photoLbChromeMaximized = false;
    photoLbChromeMetaVisible = true;
    photoLbChromeScaleBeforeMax = 1;
    var modal = g('photoLightbox');
    if (modal) modal.classList.remove('xray-lb-maximized');
    if (document.body) document.body.classList.remove('xray-lb-maximized');
    var main = g('photoLbMain');
    if (main) main.classList.remove('xray-lb-meta-hidden');
}

function closePhotoLightbox() {
    if (photoLbCurrentId && photoLbHasUnsavedChanges()) {
        if (typeof showMediaUnsavedOverlay === 'function') {
            showMediaUnsavedOverlay(
                'photoLightbox',
                function() { savePhotoLbMeta(); },
                function() { _forceClosePhotoLightbox(); }
            );
            return;
        }
    }
    _forceClosePhotoLightbox();
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
    if (cab2) photoLbShowCropApply(false);
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
      photoLbShowCropApply(true);
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

function photoLbShowCropApply(show) {
  var btn = g('photoLbCropApplyBtn');
  var viewer = g('photoLbViewerDiv');
  if (btn) btn.style.display = show ? 'block' : 'none';
  if (viewer) viewer.classList.toggle('xray-lb-crop-pending', !!show);
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
    mediaNotify(mediaTr('media.alert.cropFail'));
    return;
  }
  img.crossOrigin = 'anonymous';
  img.onload = function() { photoLbInitCanvas(); };
  img.src    = tmp.toDataURL('image/jpeg', 0.95);
  phLbCropRect = null;
  photoLbShowCropApply(false);
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
      mediaNotify(mediaTr('media.alert.noVideoFrame'));
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
    mediaNotify(mediaTr('media.alert.popupBlocked'));
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

function photoLbOrientChanged() {
  var rot = ((phLbTransform.rotate % 360) + 360) % 360;
  return rot !== 0 || !!phLbTransform.flipH || !!phLbTransform.flipV;
}

function photoLbNeedsImagePersist() {
  if (phLbIsVideo) return false;
  var img = g('photoLbImg');
  if (img && img.src && img.src.indexOf('data:image') === 0) return true;
  if (photoLbOrientChanged()) return true;
  if (phLbBrightness !== 100 || phLbContrast !== 100 || phLbTransform.invert) {
    return true;
  }
  return photoLbOverlayHasInk();
}

// Bake rotate/flip into a new canvas, matching the on-screen CSS transform
// order (scale/flip first, then rotate). Returns src unchanged if no
// orientation change is active.
function photoLbBakeOrient(src) {
  if (!src || !photoLbOrientChanged()) return src;
  var rot  = ((phLbTransform.rotate % 360) + 360) % 360;
  var fH   = !!phLbTransform.flipH;
  var fV   = !!phLbTransform.flipV;
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

    var outCanvas = photoLbBakeOrient(merged);
    if (typeof canvasToJpegBlob === 'function') {
      canvasToJpegBlob(outCanvas, 0.92, callback);
    } else {
      outCanvas.toBlob(callback, 'image/jpeg', 0.92);
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

          var outCanvas = photoLbBakeOrient(merged);
          if (typeof canvasToJpegBlob === 'function') {
            canvasToJpegBlob(outCanvas, 0.92, callback);
          } else {
            outCanvas.toBlob(callback, 'image/jpeg', 0.92);
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
    _photoLbMetaDirty = false;   // clear before close so no re-prompt
    _forceClosePhotoLightbox();
    loadPhotoRecords().then(function() {
      mediaNotify(msg || mediaTr('media.alert.savedDefault'));
    });
  }

  function metaPayload() {
    var body = {
      category   : g('photoLbCat') ? g('photoLbCat').value : null,
      taken_date : g('photoLbDate') ? g('photoLbDate').value || null : null,
      caption    : g('photoLbCaption') ? g('photoLbCaption').value.trim() : null,
      dr         : g('photoLbDr') ? g('photoLbDr').value.trim() : null,
      clinic     : g('photoLbClinic') ? g('photoLbClinic').value.trim() : null
    };
    if (typeof conMediaPhotoCtxRead === 'function') Object.assign(body, conMediaPhotoCtxRead('photoLb'));
    return body;
  }

  function writePhoto(makeOp, body) {
    return (typeof conMediaWrite === 'function')
      ? conMediaWrite('photos', makeOp, body)
      : Promise.resolve(makeOp(body));
  }

  var lbId = photoLbCurrentId;

  function saveMetaOnly() {
    writePhoto(function(body) {
      return SB.from('photos').update(body).eq('id', lbId).select('id');
    }, metaPayload()).then(function(r) {
        if (r.error) { mediaNotify(mediaErr(r.error.message), 'error'); return; }
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
      mediaNotify(mediaTr('media.alert.exportEditFail'));
      saveMetaOnly();
      return;
    }

    if (!photoPatientId) {
      mediaNotify(mediaTr('media.alert.patientContextMissingDetails'));
      saveMetaOnly();
      return;
    }

    var safeName = photoPatientId + '/' +
      Date.now() + '_' +
      Math.random().toString(36).slice(2) + '.jpg';

    var oldPath = rec && rec.file_path;
    var replaceEl = g('photoLbReplaceOrig');
    var replaceOriginal = !!(replaceEl && replaceEl.checked) || !rec;

    var probe = (typeof conMediaProbeCtx === 'function') ? conMediaProbeCtx() : Promise.resolve();
    probe.then(function() {
      return SB.storage.from(PHOTO_BUCKET)
        .upload(safeName, blob, {
          cacheControl: '3600',
          upsert     : false,
          contentType: 'image/jpeg'
        });
    })
      .then(function(up) {
        if (up.error) {
          mediaNotify(mediaTrRepl('media.alert.uploadFailedMetaOnly', { MSG: up.error.message }), 'error');
          saveMetaOnly();
          return null;
        }
        var publicUrl = photoGetPublicUrlForPath(safeName);

        if (!publicUrl) {
          mediaNotify(mediaTrRepl('media.alert.publicUrlFail', { BUCKET: PHOTO_BUCKET }), 'error');
          SB.storage.from(PHOTO_BUCKET).remove([safeName]).then(function() {}, function() {});
          saveMetaOnly();
          return null;
        }

        var payload = metaPayload();
        payload.file_path = safeName;
        payload.public_url = publicUrl;

        if (replaceOriginal) {
          return writePhoto(function(body) {
            return SB.from('photos').update(body).eq('id', lbId).select('id');
          }, payload).then(function(r) {
            if (r && !r.error && oldPath && oldPath !== safeName) {
              SB.storage.from(PHOTO_BUCKET).remove([oldPath]).then(function() {}, function() {});
            }
            if (r && r.error) {
              SB.storage.from(PHOTO_BUCKET).remove([safeName]).then(function() {}, function() {});
            }
            return { res: r, copy: false };
          });
        }

        /* Non-destructive: keep the original and store the edit as a new linked record. */
        var ctxOn = typeof conMediaCtxOk === 'function' && conMediaCtxOk('photos');
        var copy = Object.assign({}, payload, {
          patient_id : photoPatientId,
          uploaded_by: (typeof currentName !== 'undefined' ? currentName : null)
        });
        if (ctxOn) {
          copy.parent_photo_id = lbId;
        } else if (!/\(edited\)\s*$/i.test(String(copy.caption || ''))) {
          copy.caption = (String(copy.caption || '').trim() + ' (edited)').trim();
        }
        return writePhoto(function(body) {
          return SB.from('photos').insert([body]).select('id');
        }, copy).then(function(r) {
          if (r && r.error) {
            SB.storage.from(PHOTO_BUCKET).remove([safeName]).then(function() {}, function() {});
          }
          return { res: r, copy: true };
        });
      })
      .then(function(out) {
        if (!out) return;
        var r = out.res;
        if (!r || r.error) {
          mediaNotify(mediaTrRepl('media.alert.dbUpdateFailPhoto', { MSG: (r && r.error && r.error.message) || '' }), 'error');
          return;
        }
        finishOk(out.copy
          ? (typeof conMediaTr === 'function' ? conMediaTr('cm.photo.savedCopy') : mediaTr('media.alert.photoSavedFull'))
          : mediaTr('media.alert.photoSavedFull'));
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
    if (r.error) { mediaNotify(mediaErr(r.error.message)); return; }
    closePhotoLightbox();
    loadPhotoRecords();
    if (typeof conPatientId !== 'undefined' && conPatientId &&
        typeof photoPatientId !== 'undefined' && photoPatientId &&
        String(conPatientId) === String(photoPatientId) &&
        typeof loadConPatientTimeline === 'function') {
      loadConPatientTimeline(conPatientId);
    }
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
      if (!fi.files || !fi.files.length) return;
      var picked = Array.from(fi.files);
      fi.value = '';
      if (typeof photoHandleFiles === 'function') {
        photoHandleFiles(picked);
        return;
      }
      if (!photoPatientId) {
        mediaNotify(mediaTr('con.forms.alertSelectPatient'), 'error');
        return;
      }
      photoUploadQueue = picked;
      photoUploadQIdx  = 0;
      processNextPhotoUpload();
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
    if (typeof conSchedulePatientTimelineRefresh === 'function' && photoPatientId) {
      conSchedulePatientTimelineRefresh(photoPatientId);
    }
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
  if (typeof conMediaPhotoCtxFill === 'function') conMediaPhotoCtxFill('photoUpload', null, true);

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
  var ctx     = (typeof conMediaPhotoCtxRead === 'function') ? conMediaPhotoCtxRead('photoUpload') : {};

  closeModal('photoUploadModal');
  showPhotoUploadProgress(true, mediaTr('media.upload.preparing'), 5);

  photoUploadOne(file, {
    category  : cat,
    taken_date: date,
    dr        : dr,
    clinic    : clinic,
    caption   : caption,
    ctx       : ctx
  }, function(label, pct) { showPhotoUploadProgress(true, label, pct); })
  .then(function(res) {
    if (!res || !res.ok) {
      showPhotoUploadProgress(false);
      if (res && res.msg) mediaNotify(res.msg, 'error');
      return;
    }
    showPhotoUploadProgress(true, mediaTr('media.upload.done'), 100);
    setTimeout(function() {
      showPhotoUploadProgress(false);
      photoUploadQIdx++;
      processNextPhotoUpload();
    }, 700);
  });
}

/**
 * Upload one file to storage and insert its `photos` row.
 * Resolves { ok, id, path, msg }; removes the stored file again if the row cannot be written.
 */
function photoUploadOne(file, meta, onProgress) {
  meta = meta || {};
  var progress = (typeof onProgress === 'function') ? onProgress : function() {};
  var pid = meta.patientId || photoPatientId;
  if (!pid) {
    return Promise.resolve({ ok: false, msg: mediaTr('con.forms.alertSelectPatient') });
  }
  var ext  = (String(file.name || '').split('.').pop() || 'jpg').toLowerCase();
  var path = pid + '/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + ext;

  var mimeMap = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'png': 'image/png',  'webp': 'image/webp',
    'heic':'image/heic', 'pdf' : 'application/pdf'
  };
  var contentType = file.type || mimeMap[ext] || 'application/octet-stream';

  progress(mediaTr('media.upload.uploadingStorage'), 20);

  return Promise.resolve(SB.storage.from(PHOTO_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert      : false,
    contentType : contentType
  })).then(function(up) {
    if (up && up.error) {
      return { ok: false, msg: mediaTrRepl('media.alert.uploadFailed', { MSG: up.error.message }) };
    }
    progress(mediaTr('media.upload.gettingUrl'), 60);
    var publicUrl = photoGetPublicUrlForPath(path) || null;
    progress(mediaTr('media.upload.savingRecord'), 80);

    var row = {
      patient_id : pid,
      file_path  : path,
      public_url : publicUrl,
      category   : meta.category || 'Other',
      caption    : meta.caption || null,
      taken_date : meta.taken_date || null,
      dr         : meta.dr || null,
      clinic     : meta.clinic || null,
      uploaded_by: (typeof currentName !== 'undefined' ? currentName : null)
    };
    if (meta.ctx) Object.assign(row, meta.ctx);

    var write = (typeof conMediaWrite === 'function')
      ? conMediaWrite('photos', function(body) { return SB.from('photos').insert([body]).select('id'); }, row)
      : Promise.resolve(SB.from('photos').insert([row]).select('id'));

    return write.then(function(r) {
      if (!r || r.error) {
        SB.storage.from(PHOTO_BUCKET).remove([path]).then(function() {}, function() {});
        return { ok: false, msg: mediaTrRepl('media.alert.dbError', { MSG: (r && r.error && r.error.message) || '' }) };
      }
      var id = r.data && r.data[0] ? r.data[0].id : null;
      return { ok: true, id: id, path: path };
    });
  }).catch(function(err) {
    return { ok: false, msg: mediaTrRepl('media.alert.unexpected', { MSG: (err && err.message) || String(err) }) };
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
    mediaNotify(mediaTr('media.alert.selectPhotoExport'));
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
  if (!photoFiltered.length) { mediaNotify(mediaTr('media.alert.noPhotosExport')); return; }
  if (!confirm(mediaTrRepl('media.alert.confirmDownloadPhotos', { N: String(photoFiltered.length) }))) return;
  photoFiltered.forEach(function(x, i) {
    setTimeout(function() {
      photoDownloadFile(x.public_url,
        'photo-' + (x.category || 'image') + '-' + i + '.jpg');
    }, i * 500);
  });
}

function photoDownloadFile(url, filename) {
  if (!url) { mediaNotify(mediaTr('media.alert.noFileUrl')); return; }
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
      mediaNotify(mediaTrRepl('media.alert.downloadFailed', { MSG: err.message }));
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
    mediaNotify(mediaTr('media.alert.selectPhotoDelete'));
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
    if (r.error) { mediaNotify(mediaTrRepl('media.alert.bulkDeleteFailed', { MSG: r.error.message })); return; }
    photoSelected.clear();
    loadPhotoRecords();
  });
}

/* =========================================================
   SECTION 13 – REFRESH
   ========================================================= */

function refreshPhotos() {
  if (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id &&
      String(conPatientData.id) !== String(photoPatientId || '')) {
    selectPhotoPatient(conPatientData);
    return;
  }
  if (!photoPatientId) {
    var current = photoResolveCurrentPatient();
    if (current && current.id) {
      selectPhotoPatient(current);
      return;
    }
    return;
  }
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
  if (typeof photoOrthoRenderIfOpen === 'function') photoOrthoRenderIfOpen();
}

document.addEventListener('app-lang-change', function () {
  refreshPhotoCategorySelects();
  refreshPhotoBannerI18n();
  var uploadModal = g('photoUploadModal');
  var lbModal = g('photoLightbox');
  if (typeof applyI18nInRoot === 'function') {
    if (uploadModal && uploadModal.style.display === 'block') applyI18nInRoot(uploadModal);
    if (lbModal && lbModal.style.display === 'block') {
      applyI18nInRoot(lbModal);
      if (typeof photoLbSyncLightboxChrome === 'function') photoLbSyncLightboxChrome();
    }
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

/* =========================================================
   Orthodontic before / after mount
   Nine standard views, two boards side by side.
   Pins live in localStorage per patient, same idea as the
   full-mouth mount. Slideshow steps one view at a time.
   ========================================================= */

var PHOTO_ORTHO_SLOTS = [
  ['profile', 'media.ortho.profile'],
  ['face', 'media.ortho.face'],
  ['smile', 'media.ortho.smile'],
  ['upper', 'media.ortho.upper'],
  ['extra', 'media.ortho.extra'],
  ['lower', 'media.ortho.lower'],
  ['buccalR', 'media.ortho.buccalR'],
  ['intra', 'media.ortho.intra'],
  ['buccalL', 'media.ortho.buccalL']
];

var photoOrthoDrag = null;
var photoOrthoPickTarget = null;
var photoOrthoSlideIdx = 0;
var photoOrthoSlideSkipEmpty = true;
var photoOrthoSlideMode = 'pair';
var photoOrthoSlideMixPct = 50;
var photoOrthoBound = false;
var photoOrthoPushTimer = null;
var PHOTO_ORTHO_SIDECAR = 'jsm-ortho-mount-v1:';

function photoIsOrthoSidecar(x) {
  return String((x && x.caption) || '').indexOf(PHOTO_ORTHO_SIDECAR) === 0;
}

function photoOrthoKey() {
  return 'jsm_ortho_mount_v1:' + String(photoPatientId || '');
}

function photoOrthoLoad() {
  var empty = { before: {}, after: {} };
  try {
    var raw = localStorage.getItem(photoOrthoKey());
    if (!raw) return empty;
    var o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return empty;
    return {
      before: (o.before && typeof o.before === 'object') ? o.before : {},
      after: (o.after && typeof o.after === 'object') ? o.after : {}
    };
  } catch (e) {
    return empty;
  }
}

function photoOrthoSave(map) {
  try { localStorage.setItem(photoOrthoKey(), JSON.stringify(map)); } catch (e) {}
  if (photoOrthoPushTimer) clearTimeout(photoOrthoPushTimer);
  photoOrthoPushTimer = setTimeout(function() {
    photoOrthoPushTimer = null;
    photoOrthoPushRemote(map);
  }, 400);
}

function photoOrthoParseSidecar(rec) {
  if (!photoIsOrthoSidecar(rec)) return null;
  try {
    var o = JSON.parse(String(rec.caption).slice(PHOTO_ORTHO_SIDECAR.length));
    if (!o || typeof o !== 'object') return null;
    return {
      before: (o.before && typeof o.before === 'object') ? o.before : {},
      after: (o.after && typeof o.after === 'object') ? o.after : {}
    };
  } catch (e) {
    return null;
  }
}

function photoOrthoHydrateFromRecords() {
  var row = null;
  var i;
  for (i = 0; i < photoAllRecords.length; i++) {
    if (photoIsOrthoSidecar(photoAllRecords[i])) { row = photoAllRecords[i]; break; }
  }
  var mapped = photoOrthoParseSidecar(row);
  if (!mapped) return;
  try { localStorage.setItem(photoOrthoKey(), JSON.stringify(mapped)); } catch (e) {}
  if (typeof photoOrthoRenderIfOpen === 'function') photoOrthoRenderIfOpen();
}

function photoOrthoPushRemote(map) {
  if (!photoPatientId || typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve();
  var caption = PHOTO_ORTHO_SIDECAR + JSON.stringify(map || photoOrthoLoad());
  var existing = null;
  var i;
  for (i = 0; i < photoAllRecords.length; i++) {
    if (photoIsOrthoSidecar(photoAllRecords[i])) { existing = photoAllRecords[i]; break; }
  }
  var req;
  if (existing && existing.id) {
    req = SB.from('photos').update({ caption: caption }).eq('id', existing.id).select('id');
  } else {
    req = SB.from('photos').insert([{
      patient_id: photoPatientId,
      category: 'Other',
      caption: caption,
      file_path: String(photoPatientId) + '/ortho-board.json',
      public_url: null,
      taken_date: null
    }]).select('id');
  }
  return Promise.resolve(req).then(function(r) {
    if (r && !r.error && r.data && r.data[0] && !existing) {
      photoAllRecords.push(Object.assign({ id: r.data[0].id, caption: caption, category: 'Other' }, r.data[0]));
    } else if (r && !r.error && existing) {
      existing.caption = caption;
    }
    return r;
  }, function() { return null; });
}

function photoOrthoFind(id) {
  var sid = String(id || '');
  if (!sid) return null;
  for (var i = 0; i < photoAllRecords.length; i++) {
    if (String(photoAllRecords[i].id) === sid) return photoAllRecords[i];
  }
  return null;
}

function photoOrthoIsImage(rec) {
  var p = String((rec && rec.file_path) || (rec && rec.public_url) || '').toLowerCase();
  if (!p) return false;
  return p.indexOf('.pdf') < 0;
}

function photoOrthoSlotLabel(key) {
  for (var i = 0; i < PHOTO_ORTHO_SLOTS.length; i++) {
    if (PHOTO_ORTHO_SLOTS[i][0] === key) return mediaTr(PHOTO_ORTHO_SLOTS[i][1]);
  }
  return key;
}

function photoOrthoSetLabel(setKey) {
  return mediaTr(setKey === 'after' ? 'media.ortho.after' : 'media.ortho.before');
}

function photoOrthoToggle(force) {
  var panel = g('photoOrthoPanel');
  if (!panel) return;
  var on = (typeof force === 'boolean') ? force : panel.hasAttribute('hidden');
  if (on) panel.removeAttribute('hidden');
  else {
    panel.setAttribute('hidden', '');
    photoOrthoPickClose();
  }
  var btn = g('btnPhotoOrtho');
  if (btn) btn.classList.toggle('is-on', on);
  if (on) {
    photoOrthoBind();
    photoOrthoRender();
  }
}

function photoOrthoBind() {
  var root = g('photoOrthoSets');
  if (!root || photoOrthoBound) return;
  photoOrthoBound = true;
  root.addEventListener('dragover', function(e) {
    var tile = e.target.closest ? e.target.closest('.ortho-tile') : null;
    var setEl = e.target.closest ? e.target.closest('.ortho-set') : null;
    if (!tile && !setEl) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (tile) tile.classList.add('is-over');
    if (setEl) setEl.classList.add('is-over');
  });
  root.addEventListener('dragleave', function(e) {
    var tile = e.target.closest ? e.target.closest('.ortho-tile') : null;
    var setEl = e.target.closest ? e.target.closest('.ortho-set') : null;
    if (tile) tile.classList.remove('is-over');
    if (setEl) setEl.classList.remove('is-over');
  });
  root.addEventListener('drop', function(e) {
    var tile = e.target.closest ? e.target.closest('.ortho-tile') : null;
    var setEl = e.target.closest ? e.target.closest('.ortho-set') : null;
    if (!tile && !setEl) return;
    e.preventDefault();
    if (tile) tile.classList.remove('is-over');
    if (setEl) setEl.classList.remove('is-over');
    var setKey = (tile && tile.dataset.set) || (setEl && setEl.dataset.set) || 'before';
    if (photoOrthoHasExternalFiles(e.dataTransfer)) {
      photoOrthoDrag = null;
      photoOrthoCollectDropFiles(e.dataTransfer).then(function(files) {
        if (files.length === 1 && tile && tile.dataset.slot) {
          var recs = photoOrthoIngestFiles(files, setKey);
          if (recs[0]) photoOrthoPlace(setKey, tile.dataset.slot, recs[0].id);
          return;
        }
        photoOrthoPlaceFiles(setKey, files);
      });
      return;
    }
    if (!tile) return;
    var from = photoOrthoDrag;
    var id = (from && from.id) || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
    photoOrthoDrag = null;
    if (!id) return;
    photoOrthoPlace(tile.dataset.set, tile.dataset.slot, id, from);
  });
  root.addEventListener('dragstart', function(e) {
    var tile = e.target.closest ? e.target.closest('.ortho-tile.is-filled') : null;
    if (!tile || !tile.dataset.photo) return;
    photoOrthoDrag = {
      id: tile.dataset.photo,
      fromSet: tile.dataset.set,
      fromSlot: tile.dataset.slot
    };
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', tile.dataset.photo);
      e.dataTransfer.effectAllowed = 'move';
    }
  });
  root.addEventListener('click', function(e) {
    var tile = e.target.closest ? e.target.closest('.ortho-tile') : null;
    if (!tile) return;
    photoOrthoPick(tile.dataset.set, tile.dataset.slot);
  });
}

function photoOrthoPlace(setKey, slotKey, id, from) {
  if (setKey !== 'before' && setKey !== 'after') return;
  var map = photoOrthoLoad();
  if (!map.before) map.before = {};
  if (!map.after) map.after = {};
  if (from && from.fromSet && (from.fromSet !== setKey || from.fromSlot !== slotKey)) {
    if (map[from.fromSet]) delete map[from.fromSet][from.fromSlot];
  }
  if (id) map[setKey][slotKey] = String(id);
  else delete map[setKey][slotKey];
  photoOrthoSave(map);
  photoOrthoRender();
  var show = g('photoOrthoShow');
  if (show && !show.hasAttribute('hidden')) photoOrthoSlidePaint();
}

function photoOrthoNameHitsSlot(rec, slotKey) {
  var s = (String((rec && rec.file_path) || '') + ' ' + String((rec && rec.caption) || '')).toLowerCase();
  var hints = {
    profile: /profile|side\b|lateral|侧面|側面/,
    face: /repose|frontal-face|face-front|正面(?!口)|fr(on)?tal(?!\s*smile)/,
    smile: /smile|微笑/,
    upper: /upper|occlusal-u|maxilla|上颌|上顎/,
    extra: /extra|three-quarter|3\/4|补充|補充/,
    lower: /lower|occlusal-l|mandible|下颌|下顎/,
    buccalR: /right.?buccal|buccal.?r|右侧|右側/,
    intra: /intraoral|front.?teeth|正面口/,
    buccalL: /left.?buccal|buccal.?l|左侧|左側/
  };
  return hints[slotKey] ? hints[slotKey].test(s) : false;
}

function photoOrthoAutoPlaceList() {
  var images = [];
  if (photoSelected && photoSelected.size) {
    photoAllRecords.forEach(function(x) {
      if (photoSelected.has(x.id) && photoOrthoIsImage(x) && !photoIsOrthoSidecar(x)) images.push(x);
    });
  }
  if (!images.length) {
    var groups = photoVisitGroups((photoAllRecords || []).filter(function(x) {
      return photoOrthoIsImage(x) && !photoIsOrthoSidecar(x);
    }));
    if (groups.length && groups[0].rows) images = groups[0].rows.slice();
  }
  return images;
}

function photoOrthoAutoPlace(setKey) {
  if (setKey !== 'before' && setKey !== 'after') return;
  var images = photoOrthoAutoPlaceList();
  if (!images.length) {
    mediaNotify(mediaTr('media.ortho.placeNone'), 'error');
    return 0;
  }
  var map = photoOrthoLoad();
  map[setKey] = {};
  var used = {};
  PHOTO_ORTHO_SLOTS.forEach(function(slot) {
    var hit = null;
    images.forEach(function(rec) {
      if (hit || used[String(rec.id)]) return;
      if (photoOrthoNameHitsSlot(rec, slot[0])) hit = rec;
    });
    if (hit) {
      map[setKey][slot[0]] = String(hit.id);
      used[String(hit.id)] = true;
    }
  });
  PHOTO_ORTHO_SLOTS.forEach(function(slot) {
    if (map[setKey][slot[0]]) return;
    var next = null;
    images.forEach(function(rec) {
      if (next || used[String(rec.id)]) return;
      next = rec;
    });
    if (next) {
      map[setKey][slot[0]] = String(next.id);
      used[String(next.id)] = true;
    }
  });
  photoOrthoSave(map);
  photoOrthoRender();
  var n = photoOrthoFilledCount(map, setKey);
  mediaNotify(mediaTrRepl('media.ortho.placeOk', { N: String(n), SET: photoOrthoSetLabel(setKey) }), 'info');
  return n;
}

function photoOrthoCopySet(fromKey, toKey) {
  if (fromKey !== 'before' && fromKey !== 'after') return;
  if (toKey !== 'before' && toKey !== 'after') return;
  var map = photoOrthoLoad();
  var src = map[fromKey] || {};
  var copy = {};
  Object.keys(src).forEach(function(k) { copy[k] = src[k]; });
  map[toKey] = copy;
  photoOrthoSave(map);
  photoOrthoRender();
  mediaNotify(mediaTr('media.ortho.copyOk'), 'info');
}

function photoOrthoApplySitting(setKey, date) {
  if (!date) return 0;
  var images = (photoAllRecords || []).filter(function(x) {
    return photoOrthoIsImage(x) && !photoIsOrthoSidecar(x) && photoVisitKey(x) === date;
  });
  if (!images.length) {
    mediaNotify(mediaTr('media.ortho.placeNone'), 'error');
    return 0;
  }
  var prev = photoSelected;
  photoSelected = new Set(images.map(function(x) { return x.id; }));
  var n = photoOrthoAutoPlace(setKey);
  photoSelected = prev;
  return n;
}

var photoOrthoFolderTarget = 'before';

function photoOrthoImageFiles(files) {
  return (files || []).filter(function(file) {
    if (!file) return false;
    var name = String(file.name || '').toLowerCase();
    var type = String(file.type || '').toLowerCase();
    if (type.indexOf('pdf') >= 0 || /\.pdf$/.test(name)) return false;
    if (type.indexOf('image/') === 0) return true;
    return /\.(jpe?g|png|webp|gif|bmp|heic|tif{1,2})$/.test(name);
  });
}

function photoOrthoHasExternalFiles(dt) {
  if (!dt) return false;
  if (dt.files && dt.files.length) return true;
  var items = dt.items;
  if (!items || !items.length) return false;
  var i;
  for (i = 0; i < items.length; i++) {
    if (!items[i].kind || items[i].kind === 'file') return true;
  }
  return false;
}

function photoOrthoEntryToFiles(entry) {
  if (!entry) return Promise.resolve([]);
  if (entry.isFile) {
    return new Promise(function(resolve) {
      try {
        entry.file(function(f) { resolve(f ? [f] : []); }, function() { resolve([]); });
      } catch (e) {
        resolve([]);
      }
    });
  }
  if (entry.isDirectory && typeof entry.createReader === 'function') {
    var reader = entry.createReader();
    var jobs = [];
    function readBatch() {
      return new Promise(function(resolve) {
        try {
          reader.readEntries(function(ents) { resolve(ents || []); }, function() { resolve([]); });
        } catch (e) {
          resolve([]);
        }
      }).then(function(ents) {
        if (!ents.length) {
          return Promise.all(jobs).then(function(chunks) {
            return [].concat.apply([], chunks);
          });
        }
        ents.forEach(function(ent) { jobs.push(photoOrthoEntryToFiles(ent)); });
        return readBatch();
      });
    }
    return readBatch();
  }
  return Promise.resolve([]);
}

function photoOrthoCollectDropFiles(dt) {
  if (!dt) return Promise.resolve([]);
  var items = dt.items;
  if (items && items.length) {
    var jobs = [];
    var i;
    for (i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.kind && item.kind !== 'file') continue;
      var entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) jobs.push(photoOrthoEntryToFiles(entry));
      else if (typeof item.getAsFile === 'function') {
        var got = item.getAsFile();
        if (got) jobs.push(Promise.resolve([got]));
      }
    }
    if (jobs.length) {
      return Promise.all(jobs).then(function(chunks) {
        return photoOrthoImageFiles([].concat.apply([], chunks));
      });
    }
  }
  var files = (dt.files && dt.files.length) ? Array.prototype.slice.call(dt.files) : [];
  return Promise.resolve(photoOrthoImageFiles(files));
}

function photoOrthoReadDirHandle(dir) {
  if (!dir || typeof dir.values !== 'function') return Promise.resolve([]);
  var it = dir.values();
  var files = [];
  function step() {
    return Promise.resolve(it.next()).then(function(n) {
      if (!n || n.done) return files;
      var handle = n.value;
      if (!handle) return step();
      if (handle.kind === 'file' && typeof handle.getFile === 'function') {
        return handle.getFile().then(function(f) {
          if (f) files.push(f);
          return step();
        });
      }
      if (handle.kind === 'directory') {
        return photoOrthoReadDirHandle(handle).then(function(inner) {
          files = files.concat(inner);
          return step();
        });
      }
      return step();
    });
  }
  return step();
}

function photoOrthoFilesToRecs(files) {
  var stamp = Date.now();
  return (files || []).map(function(file, i) {
    var name = String(file.name || ('photo-' + i));
    var url = '';
    try { url = URL.createObjectURL(file); } catch (e) { url = ''; }
    return {
      id: 'drop-' + stamp + '-' + i,
      category: 'Before',
      file_path: name,
      caption: name.replace(/\.[^.]+$/, ''),
      public_url: url,
      taken_date: (typeof todayISO === 'function' ? todayISO() : ''),
      _localFile: true
    };
  });
}

function photoOrthoIngestFiles(files, setKey) {
  var recs = photoOrthoFilesToRecs(photoOrthoImageFiles(files));
  recs.forEach(function(r) {
    r.category = setKey === 'after' ? 'After' : 'Before';
  });
  photoAllRecords = (photoAllRecords || []).concat(recs);
  if (typeof filterPhotos === 'function') filterPhotos();
  return recs;
}

function photoOrthoUploadDropped(files, recs) {
  return Promise.resolve({ skipped: true, n: (recs && recs.length) || 0 });
}

function photoOrthoPlaceFiles(setKey, files) {
  if (setKey !== 'before' && setKey !== 'after') return 0;
  var images = photoOrthoImageFiles(files);
  if (!images.length) {
    mediaNotify(mediaTr('media.ortho.dropNone'), 'error');
    return 0;
  }
  var need = PHOTO_ORTHO_SLOTS.length;
  if (images.length !== need) {
    var ok = window.confirm(mediaTrRepl('media.ortho.dropCount', {
      N: String(images.length),
      SET: photoOrthoSetLabel(setKey),
      M: String(need)
    }));
    if (!ok) return 0;
  }
  var recs = photoOrthoIngestFiles(images, setKey);
  var prev = photoSelected;
  photoSelected = new Set(recs.map(function(x) { return x.id; }));
  var n = photoOrthoAutoPlace(setKey);
  photoSelected = prev;
  photoOrthoUploadDropped(images, recs);
  return n;
}

function photoOrthoPickFolder(setKey) {
  photoOrthoFolderTarget = (setKey === 'after') ? 'after' : 'before';
  if (typeof window.showDirectoryPicker === 'function') {
    window.showDirectoryPicker({ id: 'jsm-ortho-folder' }).then(function(dir) {
      return photoOrthoReadDirHandle(dir);
    }).then(function(files) {
      return photoOrthoPlaceFiles(photoOrthoFolderTarget, files);
    }).catch(function(err) {
      if (err && err.name === 'AbortError') return;
      mediaNotify(mediaTrRepl('media.ortho.exportFail', { MSG: (err && err.message) || String(err) }), 'error');
    });
    return;
  }
  var inp = g('photoOrthoFolderInput');
  if (inp) { inp.value = ''; inp.click(); }
}

function photoOrthoFolderInputChange(inp) {
  var files = inp && inp.files ? Array.prototype.slice.call(inp.files) : [];
  if (inp) inp.value = '';
  photoOrthoPlaceFiles(photoOrthoFolderTarget, files);
}

function photoOrthoFillSittingSelects() {
  var groups = photoVisitGroups((photoAllRecords || []).filter(function(x) {
    return photoOrthoIsImage(x) && !photoIsOrthoSidecar(x) && photoVisitKey(x);
  }));
  ['photoOrthoSitBefore', 'photoOrthoSitAfter'].forEach(function(id) {
    var sel = g(id);
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(mediaTr('media.ortho.sitPh')) + '</option>';
    groups.forEach(function(group) {
      var o = document.createElement('option');
      o.value = group.date;
      o.textContent = (typeof fmtDateLong === 'function' ? fmtDateLong(group.date) : group.date) +
        ' (' + group.rows.length + ')';
      if (group.date === cur) o.selected = true;
      sel.appendChild(o);
    });
  });
}

function photoOrthoFilledCount(map, setKey) {
  var bag = (map && map[setKey]) || {};
  var n = 0;
  PHOTO_ORTHO_SLOTS.forEach(function(slot) {
    var rec = photoOrthoFind(bag[slot[0]]);
    if (rec && photoOrthoIsImage(rec)) n++;
  });
  return n;
}

function photoOrthoTileHtml(setKey, slotKey, labelKey, photoId) {
  var label = mediaTr(labelKey);
  var rec = photoId ? photoOrthoFind(photoId) : null;
  var src = rec && photoOrthoIsImage(rec) ? photoDisplayUrl(rec) : '';
  if (photoId && src) {
    var dateStr = rec.taken_date
      ? (typeof formatDobDisplay === 'function' ? formatDobDisplay(String(rec.taken_date).slice(0, 10)) : String(rec.taken_date).slice(0, 10))
      : '';
    return '<div class="ortho-tile is-filled" draggable="true"' +
      ' data-set="' + esc(setKey) + '" data-slot="' + esc(slotKey) + '"' +
      ' data-photo="' + esc(photoId) + '" title="' + esc(label) + '">' +
      '<img alt="' + esc(label) + '" src="' + esc(src) + '">' +
      '<span class="ortho-tile-name">' + esc(label) +
      (dateStr ? '<span class="ortho-tile-date">' + esc(dateStr) + '</span>' : '') +
      '</span>' +
      '<span class="ortho-tile-edit" aria-hidden="true">✎</span>' +
      '</div>';
  }
  var hint = slotKey === 'extra' ? mediaTr('media.ortho.extraHint') : mediaTr('media.ortho.add');
  var missing = photoId && !src ? '<span class="ortho-tile-miss">' + esc(mediaTr('media.ortho.missing')) + '</span>' : '';
  return '<button type="button" class="ortho-tile is-empty"' +
    ' data-set="' + esc(setKey) + '" data-slot="' + esc(slotKey) + '">' +
    '<span class="ortho-tile-name">' + esc(label) + '</span>' +
    '<span class="ortho-tile-add">' + esc(hint) + '</span>' +
    missing +
    '</button>';
}

function photoOrthoRender() {
  var root = g('photoOrthoSets');
  if (!root) return;
  photoOrthoBind();
  var map = photoOrthoLoad();
  var sets = ['before', 'after'];
  var html = '';
  sets.forEach(function(setKey) {
    var bag = map[setKey] || {};
    html += '<section class="ortho-set" data-set="' + setKey + '">';
    html += '<h3 class="ortho-set-title">' + esc(photoOrthoSetLabel(setKey)) + '</h3>';
    html += '<div class="ortho-set-grid">';
    PHOTO_ORTHO_SLOTS.forEach(function(slot) {
      html += photoOrthoTileHtml(setKey, slot[0], slot[1], bag[slot[0]] || '');
    });
    html += '</div></section>';
  });
  root.innerHTML = html;
  var meter = g('photoOrthoMeter');
  photoOrthoFillSittingSelects();
  if (meter) {
    meter.textContent = mediaTrRepl('media.ortho.meter', {
      BEFORE: photoOrthoSetLabel('before'),
      AFTER: photoOrthoSetLabel('after'),
      BN: String(photoOrthoFilledCount(map, 'before')),
      AN: String(photoOrthoFilledCount(map, 'after')),
      M: String(PHOTO_ORTHO_SLOTS.length)
    });
  }
}

function photoOrthoRenderIfOpen() {
  var panel = g('photoOrthoPanel');
  if (panel && !panel.hasAttribute('hidden')) photoOrthoRender();
  var show = g('photoOrthoShow');
  if (show && !show.hasAttribute('hidden')) photoOrthoSlidePaint();
}

function photoOrthoImages() {
  return (photoAllRecords || []).filter(photoOrthoIsImage);
}

function photoOrthoPick(setKey, slotKey) {
  photoOrthoPickTarget = { set: setKey, slot: slotKey };
  var box = g('photoOrthoPick');
  if (!box) return;
  var map = photoOrthoLoad();
  var current = map[setKey] && map[setKey][slotKey] ? String(map[setKey][slotKey]) : '';
  var title = mediaTrRepl('media.ortho.pick', {
    SET: photoOrthoSetLabel(setKey),
    SLOT: photoOrthoSlotLabel(slotKey)
  });
  var images = photoOrthoImages();
  var row = '';
  images.forEach(function(rec) {
    var src = photoDisplayUrl(rec);
    if (!src) return;
    var on = String(rec.id) === current ? ' is-on' : '';
    row += '<button type="button" class="ortho-pick-item' + on + '" data-id="' + esc(rec.id) + '">' +
      '<img alt="" src="' + esc(src) + '">' +
      '</button>';
  });
  if (!row) row = '<p class="ortho-pick-empty">' + esc(mediaTr('media.ortho.none')) + '</p>';
  var remove = current
    ? '<button type="button" class="ortho-pick-remove" data-id="">' + esc(mediaTr('media.ortho.remove')) + '</button>'
    : '';
  box.innerHTML =
    '<div class="ortho-pick-bar"><strong>' + esc(title) + '</strong>' +
    remove +
    '<button type="button" class="ortho-pick-x" data-close="1">×</button></div>' +
    '<div class="ortho-pick-row">' + row + '</div>';
  box.removeAttribute('hidden');
  box.onclick = function(e) {
    var closer = e.target.closest ? e.target.closest('[data-close]') : null;
    if (closer) { photoOrthoPickClose(); return; }
    var btn = e.target.closest ? e.target.closest('.ortho-pick-item, .ortho-pick-remove') : null;
    if (!btn || !photoOrthoPickTarget) return;
    photoOrthoPlace(photoOrthoPickTarget.set, photoOrthoPickTarget.slot, btn.getAttribute('data-id') || '', null);
    photoOrthoPickClose();
  };
  if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
}

function photoOrthoPickClose() {
  photoOrthoPickTarget = null;
  var box = g('photoOrthoPick');
  if (box) {
    box.setAttribute('hidden', '');
    box.innerHTML = '';
    box.onclick = null;
  }
}

function photoOrthoFrameHtml(photoId) {
  var rec = photoId ? photoOrthoFind(photoId) : null;
  var src = rec && photoOrthoIsImage(rec) ? photoDisplayUrl(rec) : '';
  if (!src) {
    return '<div class="ortho-show-empty">' + esc(mediaTr('media.ortho.noPhoto')) + '</div>';
  }
  return '<img alt="" src="' + esc(src) + '">';
}

function photoOrthoSlideDate(photoId) {
  var rec = photoId ? photoOrthoFind(photoId) : null;
  if (!rec || !rec.taken_date) return '';
  var d = String(rec.taken_date).slice(0, 10);
  return typeof formatDobDisplay === 'function' ? formatDobDisplay(d) : d;
}

function photoOrthoSlotHasPhoto(map, slotKey) {
  function ok(id) {
    var rec = id ? photoOrthoFind(id) : null;
    return !!(rec && photoOrthoIsImage(rec) && photoDisplayUrl(rec));
  }
  return ok(map && map.before && map.before[slotKey]) || ok(map && map.after && map.after[slotKey]);
}

function photoOrthoSlideSteps() {
  var map = photoOrthoLoad();
  var all = PHOTO_ORTHO_SLOTS.map(function(s) { return s[0]; });
  if (!photoOrthoSlideSkipEmpty) return all;
  var filled = all.filter(function(k) { return photoOrthoSlotHasPhoto(map, k); });
  return filled.length ? filled : all;
}

function photoOrthoSlideshow() {
  var panel = g('photoOrthoPanel');
  if (panel && panel.hasAttribute('hidden')) photoOrthoToggle(true);
  photoOrthoSlideIdx = 0;
  var el = g('photoOrthoShow');
  if (!el) return;
  el.removeAttribute('hidden');
  photoOrthoSlidePaint();
}

function photoOrthoSlideClose() {
  var el = g('photoOrthoShow');
  if (el) el.setAttribute('hidden', '');
}

function photoOrthoSlideSkipChange(on) {
  photoOrthoSlideSkipEmpty = !!on;
  photoOrthoSlideIdx = 0;
  photoOrthoSlidePaint();
}

function photoOrthoSlideSetMode(mode) {
  photoOrthoSlideMode = (mode === 'slider' || mode === 'fade') ? mode : 'pair';
  photoOrthoSlidePaint();
}

function photoOrthoSlideSetMix(val) {
  var n = Number(val);
  photoOrthoSlideMixPct = isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
  var mix = g('photoOrthoShowMix');
  if (mix) mix.style.setProperty('--ortho-mix', photoOrthoSlideMixPct + '%');
  var range = g('photoOrthoSlideMix');
  if (range && String(range.value) !== String(photoOrthoSlideMixPct)) range.value = String(photoOrthoSlideMixPct);
}

function photoOrthoSlideStep(delta) {
  var n = photoOrthoSlideSteps().length || PHOTO_ORTHO_SLOTS.length;
  photoOrthoSlideIdx = (photoOrthoSlideIdx + delta + n) % n;
  photoOrthoSlidePaint();
}

function photoOrthoSlidePaint() {
  var el = g('photoOrthoShow');
  if (!el || el.hasAttribute('hidden')) return;
  var steps = photoOrthoSlideSteps();
  if (photoOrthoSlideIdx >= steps.length) photoOrthoSlideIdx = 0;
  var slotKey = steps[photoOrthoSlideIdx] || (PHOTO_ORTHO_SLOTS[0] && PHOTO_ORTHO_SLOTS[0][0]);
  var map = photoOrthoLoad();
  var title = g('photoOrthoShowTitle');
  var step = g('photoOrthoShowStep');
  if (title) title.textContent = photoOrthoSlotLabel(slotKey);
  if (step) {
    step.textContent = mediaTrRepl('media.ortho.step', {
      N: photoOrthoSlideIdx + 1,
      M: steps.length
    });
  }
  var beforeId = map.before && map.before[slotKey];
  var afterId = map.after && map.after[slotKey];
  var before = g('photoOrthoShowBefore');
  var after = g('photoOrthoShowAfter');
  if (before) before.innerHTML = photoOrthoFrameHtml(beforeId);
  if (after) after.innerHTML = photoOrthoFrameHtml(afterId);
  var bd = photoOrthoSlideDate(beforeId);
  var ad = photoOrthoSlideDate(afterId);
  var beforeDate = g('photoOrthoShowBeforeDate');
  var afterDate = g('photoOrthoShowAfterDate');
  if (beforeDate) beforeDate.textContent = bd;
  if (afterDate) afterDate.textContent = ad;
  var mixBeforeDate = g('photoOrthoMixBeforeDate');
  var mixAfterDate = g('photoOrthoMixAfterDate');
  if (mixBeforeDate) mixBeforeDate.textContent = (bd ? photoOrthoSetLabel('before') + ' · ' + bd : photoOrthoSetLabel('before'));
  if (mixAfterDate) mixAfterDate.textContent = (ad ? photoOrthoSetLabel('after') + ' · ' + ad : photoOrthoSetLabel('after'));
  var mixBefore = g('photoOrthoMixBefore');
  var mixAfter = g('photoOrthoMixAfter');
  if (mixBefore) mixBefore.innerHTML = photoOrthoFrameHtml(beforeId);
  if (mixAfter) mixAfter.innerHTML = photoOrthoFrameHtml(afterId);
  var pair = g('photoOrthoShowPair');
  var mix = g('photoOrthoShowMix');
  var isMix = photoOrthoSlideMode === 'slider' || photoOrthoSlideMode === 'fade';
  if (pair) {
    if (isMix) pair.setAttribute('hidden', '');
    else pair.removeAttribute('hidden');
  }
  if (mix) {
    if (isMix) mix.removeAttribute('hidden');
    else mix.setAttribute('hidden', '');
    mix.classList.toggle('is-slider', photoOrthoSlideMode === 'slider');
    mix.classList.toggle('is-fade', photoOrthoSlideMode === 'fade');
    mix.style.setProperty('--ortho-mix', photoOrthoSlideMixPct + '%');
  }
  var skip = g('photoOrthoSlideSkip');
  if (skip) skip.checked = !!photoOrthoSlideSkipEmpty;
  var modes = { pair: 'photoOrthoModePair', slider: 'photoOrthoModeSlider', fade: 'photoOrthoModeFade' };
  Object.keys(modes).forEach(function(k) {
    var b = g(modes[k]);
    if (b) b.classList.toggle('is-on', photoOrthoSlideMode === k);
  });
}

function photoOrthoIsAbort(err) {
  return !!(err && (err.name === 'AbortError' || err.code === 20));
}

function photoOrthoSetBusy(btnId, on) {
  ['photoOrthoSlideBtn', 'photoOrthoCompBtn', 'photoOrthoPdfBtn', 'photoOrthoPrintBtn'].forEach(function(id) {
    var b = g(id);
    if (b) b.disabled = !!on;
  });
  var btn = g(btnId);
  if (!btn) return;
  if (on) {
    if (!btn.dataset.orthoLabel) btn.dataset.orthoLabel = btn.textContent;
    btn.textContent = mediaTr('media.ortho.exporting');
  } else if (typeof applyI18nInRoot === 'function' && btn.parentNode) {
    applyI18nInRoot(btn.parentNode);
  } else if (btn.dataset.orthoLabel) {
    btn.textContent = btn.dataset.orthoLabel;
  }
}

function photoOrthoSafeFile(s, fallback) {
  var t = String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, 60) || fallback || 'patient';
}

function photoOrthoFileBase() {
  var p = photoPatientData || {};
  var no = photoOrthoSafeFile(p.patient_no, '');
  var name = photoOrthoSafeFile(p.full_name, 'patient');
  return (no ? no + '-' : '') + name + '-ortho';
}

function photoOrthoClinicName() {
  if (typeof clinicNameForOutboundMessage === 'function') {
    var n = clinicNameForOutboundMessage({});
    if (n) return n;
  }
  return (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) ? currentClinicLabel : '';
}

function photoOrthoDoctorName() {
  if (typeof currentName === 'string' && currentName.trim()) return currentName.trim();
  if (typeof window !== 'undefined' && window.currentName && String(window.currentName).trim()) {
    return String(window.currentName).trim();
  }
  var p = photoPatientData || {};
  if (p.dr && String(p.dr).trim()) return String(p.dr).trim();
  var i, rec;
  for (i = 0; i < (photoAllRecords || []).length; i++) {
    rec = photoAllRecords[i];
    if (rec && rec.dr && String(rec.dr).trim()) return String(rec.dr).trim();
  }
  return '';
}

function photoOrthoBagDateLabel(bag) {
  var dates = [];
  PHOTO_ORTHO_SLOTS.forEach(function(slot) {
    var rec = photoOrthoFind((bag && bag[slot[0]]) || '');
    if (!rec || !rec.taken_date) return;
    var d = String(rec.taken_date).slice(0, 10);
    if (d && dates.indexOf(d) < 0) dates.push(d);
  });
  dates.sort();
  if (!dates.length) return '';
  function fmt(d) {
    return typeof formatDobDisplay === 'function' ? formatDobDisplay(d) : d;
  }
  if (dates.length === 1) return fmt(dates[0]);
  return fmt(dates[0]) + ' – ' + fmt(dates[dates.length - 1]);
}

function photoOrthoPatientMeta() {
  var p = photoPatientData || {};
  var dob = p.dob && typeof formatDobAge === 'function' ? formatDobAge(p.dob) : (p.dob || '—');
  var printed = (typeof todayISO === 'function' && typeof formatDobDisplay === 'function')
    ? formatDobDisplay(todayISO())
    : '';
  var map = photoOrthoLoad();
  return {
    clinic: photoOrthoClinicName(),
    name: p.full_name || '—',
    no: p.patient_no || '—',
    dob: dob || '—',
    date: printed || '',
    doctor: photoOrthoDoctorName(),
    beforeDate: photoOrthoBagDateLabel(map.before || {}),
    afterDate: photoOrthoBagDateLabel(map.after || {})
  };
}

function photoOrthoSetFilled(map, setKey) {
  var bag = map && map[setKey];
  if (!bag) return false;
  var i, rec;
  for (i = 0; i < PHOTO_ORTHO_SLOTS.length; i++) {
    rec = photoOrthoFind(bag[PHOTO_ORTHO_SLOTS[i][0]]);
    if (rec && photoOrthoIsImage(rec)) return true;
  }
  return false;
}

function photoOrthoDecodeImg(url, cors) {
  return new Promise(function(resolve, reject) {
    var im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    im.onload = function() { resolve(im); };
    im.onerror = function() { reject(new Error('img')); };
    im.src = url;
  });
}

function photoOrthoLoadImg(rec) {
  var url = photoBareUrl(rec) || photoDisplayUrl(rec);
  if (!url) return Promise.resolve(null);
  if (url.indexOf('data:') === 0) return photoOrthoDecodeImg(url, false);
  return fetch(url, { mode: 'cors', credentials: 'omit' }).then(function(res) {
    if (!res.ok) throw new Error('http');
    return res.blob();
  }).then(function(blob) {
    var obj = URL.createObjectURL(blob);
    return photoOrthoDecodeImg(obj, false).then(function(img) {
      URL.revokeObjectURL(obj);
      return img;
    }, function(err) {
      URL.revokeObjectURL(obj);
      throw err;
    });
  }).catch(function() {
    return photoOrthoDecodeImg(photoDisplayUrl(rec) || url, true);
  });
}

function photoOrthoCollectImages(map) {
  var seen = {};
  ['before', 'after'].forEach(function(setKey) {
    var bag = (map && map[setKey]) || {};
    PHOTO_ORTHO_SLOTS.forEach(function(slot) {
      var id = bag[slot[0]];
      if (id) seen[String(id)] = true;
    });
  });
  var ids = Object.keys(seen);
  var out = {};
  return Promise.all(ids.map(function(id) {
    var rec = photoOrthoFind(id);
    if (!rec || !photoOrthoIsImage(rec)) return Promise.resolve();
    return photoOrthoLoadImg(rec).then(function(img) {
      out[id] = img;
    }, function() {
      out[id] = null;
    });
  })).then(function() { return out; });
}

function photoOrthoToBlob(canvas, mime, quality) {
  return new Promise(function(resolve, reject) {
    canvas.toBlob(function(blob) {
      if (!blob) reject(new Error('canvas'));
      else resolve(blob);
    }, mime, quality);
  });
}

function photoOrthoWriteHandle(handle, blob) {
  return handle.createWritable().then(function(stream) {
    return stream.write(blob).then(function() { return stream.close(); });
  });
}

function photoOrthoDownloadBlob(blob, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 4000);
}

function photoOrthoPickSave(name, mime, ext, desc) {
  if (typeof window.showSaveFilePicker !== 'function') return Promise.resolve(null);
  var accept = {};
  accept[mime] = [ext];
  return window.showSaveFilePicker({
    suggestedName: name,
    types: [{ description: desc, accept: accept }]
  });
}

function photoOrthoFont() {
  return "'Segoe UI', 'Microsoft YaHei', 'PingFang TC', 'Noto Sans CJK SC', sans-serif";
}

function photoOrthoFitImage(ctx, img, x, y, w, h) {
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  var s = Math.min(w / iw, h / ih);
  var dw = iw * s;
  var dh = ih * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function photoOrthoDrawSet(setKey, bag, imgs) {
  var loaded = [];
  PHOTO_ORTHO_SLOTS.forEach(function(slot) {
    var im = imgs[String(bag[slot[0]] || '')];
    if (im) loaded.push(im);
  });
  var cell = 1000;
  loaded.forEach(function(im) {
    var side = Math.max(im.naturalWidth || im.width || 0, im.naturalHeight || im.height || 0);
    if (side > cell) cell = side;
  });
  cell = Math.max(900, Math.min(1600, cell));
  var gap = Math.round(cell * 0.03);
  var pad = Math.round(cell * 0.06);
  var titleH = Math.round(cell * 0.16);
  var labelH = Math.round(cell * 0.08);
  var cols = 3;
  var rows = 3;
  var w = pad * 2 + cols * cell + (cols - 1) * gap;
  var h = pad + titleH + rows * cell + (rows - 1) * gap + pad;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
  var meta = photoOrthoPatientMeta();
  var font = photoOrthoFont();
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'top';
  ctx.font = '700 ' + Math.round(titleH * 0.38) + 'px ' + font;
  ctx.fillText(photoOrthoSetLabel(setKey), pad, pad);
  ctx.font = '600 ' + Math.round(titleH * 0.22) + 'px ' + font;
  ctx.fillStyle = '#475569';
  var sub = [meta.name, meta.no !== '—' ? meta.no : ''].filter(Boolean).join('  ·  ');
  ctx.fillText(sub, pad, pad + Math.round(titleH * 0.42));
  var sitDate = photoOrthoBagDateLabel(bag);
  if (sitDate) {
    ctx.font = '600 ' + Math.round(titleH * 0.2) + 'px ' + font;
    ctx.fillText(sitDate, pad, pad + Math.round(titleH * 0.72));
  }
  PHOTO_ORTHO_SLOTS.forEach(function(slot, i) {
    var col = i % 3;
    var row = Math.floor(i / 3);
    var x = pad + col * (cell + gap);
    var y = pad + titleH + row * (cell + gap);
    var img = imgs[String(bag[slot[0]] || '')] || null;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, cell, cell, Math.round(cell * 0.02));
    else ctx.rect(x, y, cell, cell);
    ctx.clip();
    ctx.fillStyle = img ? '#0f172a' : '#f8fafc';
    ctx.fillRect(x, y, cell, cell);
    if (img) photoOrthoFitImage(ctx, img, x, y, cell, cell);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(x, y + cell - labelH, cell, labelH);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 ' + Math.round(labelH * 0.46) + 'px ' + font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(photoOrthoSlotLabel(slot[0]), x + cell / 2, y + cell - labelH / 2);
    ctx.restore();
    if (!img) {
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = Math.max(2, Math.round(cell * 0.006));
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(x + 4, y + 4, cell - 8, cell - 8);
      ctx.setLineDash([]);
    }
  });
  return canvas;
}

function photoOrthoDrawPdfPage(beforeCanvas, afterCanvas) {
  var w = 2480;
  var h = 1754;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
  var meta = photoOrthoPatientMeta();
  var font = photoOrthoFont();
  var pad = 48;
  var headerH = 200;
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'top';
  var y = pad;
  if (meta.clinic) {
    ctx.font = '600 22px ' + font;
    ctx.fillStyle = '#64748b';
    ctx.fillText(meta.clinic, pad, y);
    y += 32;
  }
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 34px ' + font;
  ctx.fillText(mediaTr('media.ortho.pdfTitle'), pad, y);
  y += 48;
  ctx.font = '600 22px ' + font;
  ctx.fillStyle = '#334155';
  var bits = [
    mediaTr('media.ortho.lblPatient') + '  ' + meta.name,
    mediaTr('media.ortho.lblNo') + '  ' + meta.no,
    mediaTr('media.ortho.lblDob') + '  ' + meta.dob
  ];
  if (meta.doctor) bits.push(mediaTr('media.ortho.lblDr') + '  ' + meta.doctor);
  if (meta.date) bits.push(mediaTr('media.ortho.lblDate') + '  ' + meta.date);
  ctx.fillText(bits.join('    ·    '), pad, y);
  y += 32;
  var sits = [];
  if (meta.beforeDate) sits.push(photoOrthoSetLabel('before') + '  ' + meta.beforeDate);
  if (meta.afterDate) sits.push(photoOrthoSetLabel('after') + '  ' + meta.afterDate);
  if (sits.length) {
    ctx.font = '600 20px ' + font;
    ctx.fillStyle = '#0f766e';
    ctx.fillText(sits.join('    ·    '), pad, y);
  }
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(pad, pad + headerH - 8, w - pad * 2, 3);
  var gutter = 36;
  var colW = Math.floor((w - pad * 2 - gutter) / 2);
  var colH = h - pad - (pad + headerH);
  var colY = pad + headerH;
  function place(src, colX) {
    if (!src) return;
    var s = Math.min(colW / src.width, colH / src.height);
    var dw = src.width * s;
    var dh = src.height * s;
    ctx.drawImage(src, colX + (colW - dw) / 2, colY + (colH - dh) / 2, dw, dh);
  }
  place(beforeCanvas, pad);
  place(afterCanvas, pad + colW + gutter);
  return canvas;
}

function photoOrthoJpegPageToPdf(page) {
  var PW = 841.89;
  var PH = 595.28;
  var parts = [];
  var off = 0;
  function add(u8) { parts.push(u8); off += u8.length; }
  function addStr(s) { add(new TextEncoder().encode(s)); }
  addStr('%PDF-1.4\n');
  var xref = [0, 0, 0, 0, 0, 0];
  function obj(n, body) {
    xref[n] = off;
    addStr(n + ' 0 obj\n');
    if (typeof body === 'string') addStr(body);
    else body();
    addStr('\nendobj\n');
  }
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  var content = 'q\n' + PW.toFixed(2) + ' 0 0 ' + PH.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ\n';
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW.toFixed(2) + ' ' + PH.toFixed(2) +
    '] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>');
  obj(4, '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
  obj(5, function() {
    addStr('<< /Type /XObject /Subtype /Image /Width ' + page.w + ' /Height ' + page.h +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.jpeg.length +
      ' >>\nstream\n');
    add(page.jpeg);
    addStr('\nendstream');
  });
  var xrefPos = off;
  addStr('xref\n0 6\n');
  addStr('0000000000 65535 f \n');
  var oi;
  for (oi = 1; oi < 6; oi++) {
    addStr(('0000000000' + (xref[oi] || 0)).slice(-10) + ' 00000 n \n');
  }
  addStr('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');
  var out = new Uint8Array(off);
  var p = 0;
  parts.forEach(function(u) { out.set(u, p); p += u.length; });
  return new Blob([out], { type: 'application/pdf' });
}

function photoOrthoBlobToFile(blob, name) {
  var type = (blob && blob.type) || 'image/png';
  try { return new File([blob], name, { type: type }); }
  catch (e) { return blob; }
}

function photoOrthoSaveCompositesToChart(blobs, names) {
  var keys = Object.keys(blobs || {});
  if (!keys.length || !photoPatientId || typeof photoUploadOne !== 'function') {
    return Promise.resolve({ n: 0, ids: [] });
  }
  var acc = { n: 0, ids: [] };
  var chain = Promise.resolve();
  keys.forEach(function(k) {
    chain = chain.then(function() {
      var file = photoOrthoBlobToFile(blobs[k], names[k] || (k + '.png'));
      return photoUploadOne(file, {
        category: 'Scanned Document',
        caption: mediaTrRepl('media.ortho.chartCaption', { SET: photoOrthoSetLabel(k) }),
        taken_date: typeof todayISO === 'function' ? todayISO() : null
      }).then(function(res) {
        if (res && res.ok) {
          acc.n++;
          if (res.id) acc.ids.push(res.id);
        }
        return acc;
      });
    });
  });
  return chain.then(function() { return acc; });
}

function photoOrthoBuildPdfBlob(map) {
  return photoOrthoCollectImages(map).then(function(imgs) {
    var before = photoOrthoDrawSet('before', map.before || {}, imgs);
    var after = photoOrthoDrawSet('after', map.after || {}, imgs);
    var page = photoOrthoDrawPdfPage(before, after);
    return photoOrthoToBlob(page, 'image/jpeg', 0.92).then(function(jpegBlob) {
      return jpegBlob.arrayBuffer().then(function(buf) {
        return photoOrthoJpegPageToPdf({
          w: page.width,
          h: page.height,
          jpeg: new Uint8Array(buf)
        });
      });
    });
  });
}

function photoOrthoPrintBlob(blob) {
  var url = URL.createObjectURL(blob);
  var win = window.open(url, '_blank');
  if (win) {
    try { win.focus(); win.print(); } catch (e) {}
    setTimeout(function() {
      try { win.focus(); win.print(); } catch (e2) {}
    }, 400);
    return 'window';
  }
  var iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = function() {
    try { iframe.contentWindow.print(); } catch (e) {}
    setTimeout(function() {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 4000);
  };
  return 'iframe';
}

function photoOrthoPrintPdf() {
  var map = photoOrthoLoad();
  if (!photoOrthoSetFilled(map, 'before') && !photoOrthoSetFilled(map, 'after')) {
    mediaNotify(mediaTr('media.ortho.noPins'), 'error');
    return;
  }
  photoOrthoSetBusy('photoOrthoPrintBtn', true);
  photoOrthoBuildPdfBlob(map).then(function(pdf) {
    photoOrthoPrintBlob(pdf);
    mediaNotify(mediaTr('media.ortho.printOk'), 'info');
  }).catch(function(err) {
    if (photoOrthoIsAbort(err)) mediaNotify(mediaTr('media.ortho.exportCancel'));
    else mediaNotify(mediaTrRepl('media.ortho.exportFail', { MSG: (err && err.message) || String(err) }), 'error');
  }).then(function() {
    photoOrthoSetBusy('photoOrthoPrintBtn', false);
  });
}

function photoOrthoComposite() {
  var map = photoOrthoLoad();
  var sets = [];
  if (photoOrthoSetFilled(map, 'before')) sets.push('before');
  if (photoOrthoSetFilled(map, 'after')) sets.push('after');
  if (!sets.length) {
    mediaNotify(mediaTr('media.ortho.noPins'), 'error');
    return;
  }
  var names = {};
  sets.forEach(function(k) {
    names[k] = photoOrthoFileBase() + '-' + k + '.png';
  });
  var usedDir = typeof window.showDirectoryPicker === 'function';
  var pickP;
  try {
    if (usedDir) {
      pickP = window.showDirectoryPicker({ id: 'jsm-ortho-export', mode: 'readwrite' });
    } else {
      pickP = photoOrthoPickSave(names[sets[0]], 'image/png', '.png', mediaTr('media.ortho.pngDesc'));
    }
  } catch (err) {
    if (photoOrthoIsAbort(err)) {
      mediaNotify(mediaTr('media.ortho.exportCancel'));
      return;
    }
    usedDir = false;
    pickP = Promise.resolve(null);
  }
  photoOrthoSetBusy('photoOrthoCompBtn', true);
  Promise.resolve(pickP).then(function(picked) {
    return photoOrthoCollectImages(map).then(function(imgs) {
      var blobs = {};
      var chain = Promise.resolve();
      sets.forEach(function(k) {
        chain = chain.then(function() {
          var canvas = photoOrthoDrawSet(k, map[k] || {}, imgs);
          return photoOrthoToBlob(canvas, 'image/png').then(function(blob) {
            blobs[k] = blob;
          });
        });
      });
      return chain.then(function() {
        return { picked: picked, blobs: blobs };
      });
    });
  }).then(function(pack) {
    var seq = Promise.resolve();
    if (usedDir && pack.picked && typeof pack.picked.getFileHandle === 'function') {
      sets.forEach(function(k) {
        seq = seq.then(function() {
          return pack.picked.getFileHandle(names[k], { create: true }).then(function(fh) {
            return photoOrthoWriteHandle(fh, pack.blobs[k]);
          });
        });
      });
      return seq.then(function() { return pack; });
    }
    if (pack.picked && typeof pack.picked.createWritable === 'function') {
      seq = photoOrthoWriteHandle(pack.picked, pack.blobs[sets[0]]);
    } else {
      photoOrthoDownloadBlob(pack.blobs[sets[0]], names[sets[0]]);
    }
    sets.slice(1).forEach(function(k) {
      seq = seq.then(function() {
        return photoOrthoPickSave(names[k], 'image/png', '.png', mediaTr('media.ortho.pngDesc')).then(function(h) {
          if (h) return photoOrthoWriteHandle(h, pack.blobs[k]);
          photoOrthoDownloadBlob(pack.blobs[k], names[k]);
        }, function(err) {
          if (photoOrthoIsAbort(err)) return;
          photoOrthoDownloadBlob(pack.blobs[k], names[k]);
        });
      });
    });
    return seq.then(function() { return pack; });
  }).then(function(pack) {
    mediaNotify(mediaTrRepl('media.ortho.compositeOk', { N: String(sets.length) }), 'info');
    var box = g('photoOrthoSaveChart');
    if (box && !box.checked) return;
    if (!pack || !pack.blobs) return;
    return photoOrthoSaveCompositesToChart(pack.blobs, names).then(function(acc) {
      if (acc && acc.n) mediaNotify(mediaTrRepl('media.ortho.chartOk', { N: String(acc.n) }), 'info');
    });
  }).catch(function(err) {
    if (photoOrthoIsAbort(err)) mediaNotify(mediaTr('media.ortho.exportCancel'));
    else mediaNotify(mediaTrRepl('media.ortho.exportFail', { MSG: (err && err.message) || String(err) }), 'error');
  }).then(function() {
    photoOrthoSetBusy('photoOrthoCompBtn', false);
  });
}

function photoOrthoExportPdf() {
  var map = photoOrthoLoad();
  if (!photoOrthoSetFilled(map, 'before') && !photoOrthoSetFilled(map, 'after')) {
    mediaNotify(mediaTr('media.ortho.noPins'), 'error');
    return;
  }
  var name = photoOrthoFileBase() + '.pdf';
  var pickP;
  try {
    pickP = photoOrthoPickSave(name, 'application/pdf', '.pdf', mediaTr('media.ortho.pdfDesc'));
  } catch (err) {
    if (photoOrthoIsAbort(err)) {
      mediaNotify(mediaTr('media.ortho.exportCancel'));
      return;
    }
    pickP = Promise.resolve(null);
  }
  photoOrthoSetBusy('photoOrthoPdfBtn', true);
  Promise.resolve(pickP).then(function(handle) {
    return photoOrthoBuildPdfBlob(map).then(function(pdf) {
      if (handle) return photoOrthoWriteHandle(handle, pdf);
      photoOrthoDownloadBlob(pdf, name);
    });
  }).then(function() {
    mediaNotify(mediaTr('media.ortho.pdfOk'), 'info');
  }).catch(function(err) {
    if (photoOrthoIsAbort(err)) mediaNotify(mediaTr('media.ortho.exportCancel'));
    else mediaNotify(mediaTrRepl('media.ortho.exportFail', { MSG: (err && err.message) || String(err) }), 'error');
  }).then(function() {
    photoOrthoSetBusy('photoOrthoPdfBtn', false);
  });
}

document.addEventListener('dragend', function() {
  setTimeout(function() { photoOrthoDrag = null; }, 0);
});

document.addEventListener('keydown', function(e) {
  var el = g('photoOrthoShow');
  if (!el || el.hasAttribute('hidden')) return;
  var tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'ArrowRight') { photoOrthoSlideStep(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { photoOrthoSlideStep(-1); e.preventDefault(); }
  else if (e.key === 'Escape') { photoOrthoSlideClose(); }
});
