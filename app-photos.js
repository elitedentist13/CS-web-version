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

var photoOrthoCatNarrow = false;
var photoOrthoViewRestore = null;

function photoOrthoDocCategory(value) {
    var v = String(value || '');
    return v === 'Consent Form' || v === 'Lab Report' || v === 'Scanned Document' || v === '__consent_lab';
}

function photoOrthoCategoryPairs() {
    if (!photoOrthoCatNarrow) return PHOTO_CATEGORY_PAIRS;
    return PHOTO_CATEGORY_PAIRS.filter(function(pair) {
        return !photoOrthoDocCategory(pair[0]);
    });
}

function refreshPhotoCategorySelects() {
    function fill(selId, includeAll) {
        var sel = g(selId);
        if (!sel) return;
        var prev = sel.value;
        var pairs = (selId === 'photoFilterCat') ? photoOrthoCategoryPairs() : PHOTO_CATEGORY_PAIRS;
        var html = includeAll
            ? '<option value="">' + esc(mediaTr('media.allCategories')) + '</option>'
            : '';
        pairs.forEach(function(pair) {
            html += '<option value="' + esc(pair[0]) + '">' + esc(mediaTr(pair[1])) + '</option>';
        });
        if (includeAll && !photoOrthoCatNarrow && typeof conMediaTr === 'function') {
            html += '<option value="__consent_lab">' + esc(conMediaTr('cm.hub.consent')) + '</option>';
        }
        sel.innerHTML = html;
        if (prev && !photoOrthoDocCategory(prev)) sel.value = prev;
        else if (photoOrthoDocCategory(prev)) sel.value = '';
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
var phLbSharpness   = 0;
var phLbLoupeActive = false;
var phLbLoupeLast   = { x: 0, y: 0 };
var PHOTO_LB_LOUPE_SIZE = 192;
var PHOTO_LB_LOUPE_MAG  = 3;
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
          ? '<img src="' + esc(imgSrc) + '" alt="Photo" draggable="false" ' +
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

function photoEnsureSlideImg() {
  var viewer = g('photoSlideViewer');
  if (!viewer) return null;
  var img = g('photoSlideImg');
  if (img && viewer.contains(img)) return img;
  img = document.createElement('img');
  img.id = 'photoSlideImg';
  img.alt = 'Photo';
  img.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;';
  viewer.insertBefore(img, viewer.firstChild);
  return img;
}

function photoSlideEmptyEl() {
  var viewer = g('photoSlideViewer');
  if (!viewer) return null;
  var el = g('photoSlideEmpty');
  if (el && viewer.contains(el)) return el;
  el = document.createElement('div');
  el.id = 'photoSlideEmpty';
  el.className = 'xray-empty';
  el.style.cssText = 'display:none;height:100%;min-height:420px;align-items:center;justify-content:center;';
  viewer.appendChild(el);
  return el;
}

function photoSlidePdfEl() {
  var viewer = g('photoSlideViewer');
  if (!viewer) return null;
  var el = g('photoSlidePdf');
  if (el && viewer.contains(el)) return el;
  el = document.createElement('a');
  el.id = 'photoSlidePdf';
  el.target = '_blank';
  el.rel = 'noopener';
  el.style.cssText = 'display:none;flex-direction:column;align-items:center;justify-content:center;color:#fbbf24;text-decoration:none;height:100%;font-size:1rem;';
  el.innerHTML = '<div style="font-size:4rem;margin-bottom:.6rem;">📄</div><div>Click to open PDF</div>';
  viewer.appendChild(el);
  return el;
}

function renderPhotoSlide() {
  var img = photoEnsureSlideImg();
  var empty = photoSlideEmptyEl();
  var pdf = photoSlidePdfEl();
  if (!photoFiltered.length) {
    if (img) {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    if (pdf) pdf.style.display = 'none';
    if (empty) {
      empty.style.display = 'flex';
      empty.innerHTML =
        '<div style="text-align:center;color:#666;">' +
        '<div style="font-size:48px;">📷</div>' +
        '<p>' + esc(mediaTr('media.noPhotos')) + '</p></div>';
    }
    var fs = g('photoFilmstrip');
    if (fs) fs.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (photoCurrentIdx >= photoFiltered.length) photoCurrentIdx = 0;
  renderPhotoSlideAt(photoCurrentIdx);
  renderPhotoFilmstrip();
}

function renderPhotoSlideAt(idx) {
  photoCurrentIdx = idx;

  var x      = photoFiltered[idx];
  if (!x) return;
  var isPdf  = x.file_path && String(x.file_path).toLowerCase().endsWith('.pdf');
  var imgEl  = photoEnsureSlideImg();
  var empty  = photoSlideEmptyEl();
  var pdfEl  = photoSlidePdfEl();
  if (empty) empty.style.display = 'none';

  if (isPdf) {
    if (imgEl) {
      imgEl.removeAttribute('src');
      imgEl.style.display = 'none';
    }
    if (pdfEl) {
      pdfEl.href = photoDisplayUrl(x) || photoBareUrl(x) || '#';
      pdfEl.style.display = 'flex';
    }
  } else {
    if (pdfEl) pdfEl.style.display = 'none';
    if (imgEl) {
      var url = photoDisplayUrl(x) || photoBareUrl(x) || '';
      imgEl.style.display = '';
      imgEl.alt = photoCategoryLabel(x.category) || 'Photo';
      imgEl.onerror = function() {
        var bare = photoBareUrl(x);
        if (bare && imgEl.getAttribute('src') !== bare) imgEl.src = bare;
      };
      imgEl.src = url;
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
  var filt = photoLbCssFilter();
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
  if (phLbLoupeActive) {
    host.style.cursor = 'none';
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
  if (phLbLoupeActive) return false;
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
  phLbSharpness  = 0;
  photoLbLoupeStop();
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
  var ss = g('photoLbSharpSlider');
  if (ss) ss.value = 0;
  var sharpVal = g('photoLbSharpVal');
  if (sharpVal) sharpVal.textContent = '0';
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
    photoLbLoupeStop();
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
  photoLbResetTune(false);
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

function photoLbSyncSharpenKernel() {
  var a = Math.max(0, Math.min(100, Number(phLbSharpness) || 0)) / 100;
  var e = -a;
  var c = 1 + (4 * a);
  var el = g('photoLbSharpenKernel');
  if (el) el.setAttribute('kernelMatrix', '0 ' + e + ' 0 ' + e + ' ' + c + ' ' + e + ' 0 ' + e + ' 0');
}

function photoLbCssFilter() {
  var t = phLbTransform || {};
  var s = (t.invert ? 'invert(1) ' : '') +
    'brightness(' + phLbBrightness + '%) contrast(' + phLbContrast + '%)';
  if (phLbSharpness > 0) {
    photoLbSyncSharpenKernel();
    s += ' url(#photoLbSharpenFx)';
  }
  return s;
}

function photoLbResetTune(apply) {
  phLbBrightness = 100;
  phLbContrast = 100;
  phLbSharpness = 0;
  var bs = g('photoLbBrightSlider');   if (bs) bs.value = 100;
  var bv = g('photoLbBrightVal');      if (bv) bv.textContent = '100%';
  var cs = g('photoLbContrastSlider'); if (cs) cs.value = 100;
  var cv = g('photoLbContrastVal');    if (cv) cv.textContent = '100%';
  var ss = g('photoLbSharpSlider');    if (ss) ss.value = 0;
  var sharpVal = g('photoLbSharpVal'); if (sharpVal) sharpVal.textContent = '0';
  if (apply !== false) photoLbApplyTransform();
}

function photoLbSetSharpness(val) {
  var n = parseInt(val, 10);
  phLbSharpness = isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  var el = g('photoLbSharpVal');
  if (el) el.textContent = String(phLbSharpness);
  photoLbApplyTransform();
}

function photoLbNav(dir) {
  if (!photoLbCurrentId || !photoFiltered || !photoFiltered.length) return;
  var i = -1;
  photoFiltered.forEach(function (r, n) {
    if (String(r.id) === String(photoLbCurrentId)) i = n;
  });
  var next = i + dir;
  if (next < 0 || next >= photoFiltered.length) return;
  openPhotoLightbox(next);
}

function photoLbToggleLoupe(e) {
  if (e && e.clientX) phLbLoupeLast = { x: e.clientX, y: e.clientY };
  if (phLbLoupeActive) photoLbLoupeStop({ resumeDrag: true });
  else photoLbLoupeStart();
}

function photoLbLoupeStart() {
  var loupe = g('photoLbLoupe');
  var viewer = g('photoLbViewerDiv');
  if (!loupe || !viewer) return;
  if (g('photoLbPdf') && g('photoLbPdf').style.display === 'flex') return;
  phLbScrollDragging = false;
  phLbIsDrawing = false;
  if (phLbTool !== 'none' && phLbTool !== 'pan') photoLbSetTool('none');
  phLbLoupeActive = true;
  loupe.hidden = false;
  viewer.classList.add('xray-lb-loupe-on');
  var btn = g('photoLbLoupeBtn');
  if (btn) {
    btn.classList.add('lb-tool-active');
    btn.setAttribute('aria-pressed', 'true');
  }
  photoLbUpdateScrollHostCursor();
  photoLbLoupeRedraw();
}

function photoLbLoupeStop(opts) {
  opts = opts || {};
  var wasOn = phLbLoupeActive;
  phLbLoupeActive = false;
  var loupe = g('photoLbLoupe');
  if (loupe) loupe.hidden = true;
  var viewer = g('photoLbViewerDiv');
  if (viewer) viewer.classList.remove('xray-lb-loupe-on');
  var btn = g('photoLbLoupeBtn');
  if (btn) {
    btn.classList.remove('lb-tool-active');
    btn.setAttribute('aria-pressed', 'false');
  }
  if (wasOn && opts.resumeDrag) photoLbSetTool('pan');
  photoLbUpdateScrollHostCursor();
}

function photoLbScreenToMediaLocal(clientX, clientY) {
  var wrap = g('photoLbMediaWrap');
  if (!wrap) return null;
  var W = wrap.offsetWidth;
  var H = wrap.offsetHeight;
  if (!W || !H) return null;
  var r = wrap.getBoundingClientRect();
  var dx = clientX - (r.left + r.width / 2);
  var dy = clientY - (r.top + r.height / 2);
  var t = phLbTransform || {};
  var sx = (t.scale || 1) * (t.flipH ? -1 : 1);
  var sy = (t.scale || 1) * (t.flipV ? -1 : 1);
  if (Math.abs(sx) < 1e-6) sx = 1e-6;
  if (Math.abs(sy) < 1e-6) sy = 1e-6;
  var rad = ((t.rotate || 0) * Math.PI) / 180;
  var c = Math.cos(rad);
  var s = Math.sin(rad);
  var usx = dx / sx;
  var usy = dy / sy;
  return {
    x: usx * c + usy * s + W / 2,
    y: -usx * s + usy * c + H / 2,
    w: W,
    h: H
  };
}

function photoLbLoupeOnMove(e) {
  if (!phLbLoupeActive) return;
  phLbLoupeLast = { x: e.clientX, y: e.clientY };
  photoLbLoupeRedraw();
}

function photoLbLoupeOnContextMenu(e) {
  if (!phLbLoupeActive) return;
  e.preventDefault();
  e.stopPropagation();
  photoLbLoupeStop({ resumeDrag: true });
}

function photoLbLoupeRedraw() {
  if (!phLbLoupeActive) return;
  var loupe = g('photoLbLoupe');
  var canvas = g('photoLbLoupeCanvas');
  var viewer = g('photoLbViewerDiv');
  if (!loupe || !canvas || !viewer) return;
  var D = PHOTO_LB_LOUPE_SIZE;
  var mag = PHOTO_LB_LOUPE_MAG;
  var vr = viewer.getBoundingClientRect();
  var cx = phLbLoupeLast.x;
  var cy = phLbLoupeLast.y;
  if (!cx && !cy) {
    cx = vr.left + vr.width / 2;
    cy = vr.top + vr.height / 2;
  }
  var left = cx - vr.left - D / 2;
  var top = cy - vr.top - D / 2;
  left = Math.max(-D / 3, Math.min(vr.width - D * 2 / 3, left));
  top = Math.max(-D / 3, Math.min(vr.height - D * 2 / 3, top));
  loupe.style.left = left + 'px';
  loupe.style.top = top + 'px';

  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, D, D);
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, D, D);

  var local = photoLbScreenToMediaLocal(cx, cy);
  var media = phLbIsVideo ? g('photoLbVideo') : g('photoLbImg');
  var t = phLbTransform || {};
  var scale = Math.max(0.12, Math.abs(t.scale || 1));
  var span = D / (mag * scale);

  ctx.save();
  ctx.beginPath();
  ctx.arc(D / 2, D / 2, D / 2 - 1.5, 0, Math.PI * 2);
  ctx.clip();
  ctx.filter = photoLbCssFilter();
  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';

  if (media && local) {
    var natW = phLbIsVideo ? (media.videoWidth || local.w) : (media.naturalWidth || local.w);
    var natH = phLbIsVideo ? (media.videoHeight || local.h) : (media.naturalHeight || local.h);
    var sx = (local.x - span / 2) * (natW / local.w);
    var sy = (local.y - span / 2) * (natH / local.h);
    var sw = span * (natW / local.w);
    var sh = span * (natH / local.h);
    try {
      ctx.drawImage(media, sx, sy, sw, sh, 0, 0, D, D);
    } catch (err) { /* tainted image — ring still useful as a pointer */ }
  }

  ctx.filter = 'none';
  var ov = g('photoLbCanvas');
  if (ov && local && ov.style.display !== 'none' && ov.width && ov.height) {
    var ox = (local.x - span / 2) * (ov.width / local.w);
    var oy = (local.y - span / 2) * (ov.height / local.h);
    var ow = span * (ov.width / local.w);
    var oh = span * (ov.height / local.h);
    try {
      ctx.drawImage(ov, ox, oy, ow, oh, 0, 0, D, D);
    } catch (err2) { /* ignore overlay sample failures */ }
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(D / 2, D / 2, D / 2 - 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(245,215,110,0.95)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(D / 2 - 7, D / 2);
  ctx.lineTo(D / 2 + 7, D / 2);
  ctx.moveTo(D / 2, D / 2 - 7);
  ctx.lineTo(D / 2, D / 2 + 7);
  ctx.strokeStyle = 'rgba(245,215,110,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
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
      mCtx.filter = photoLbCssFilter();
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
  if (phLbBrightness !== 100 || phLbContrast !== 100 || phLbSharpness > 0 || phLbTransform.invert) {
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

    mCtx.filter = photoLbCssFilter();
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

          mCtx.filter = photoLbCssFilter();
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
    plbHost.addEventListener('mousemove', photoLbLoupeOnMove);
    plbHost.addEventListener('contextmenu', photoLbLoupeOnContextMenu);
  }
  document.addEventListener('mousemove', function (e) {
    if (phLbLoupeActive) photoLbLoupeOnMove(e);
    photoLbScrollHostMove(e);
  });
  document.addEventListener('mouseup', photoLbScrollHostUp);
  document.addEventListener('contextmenu', function (e) {
    if (!phLbLoupeActive) return;
    var modal = g('photoLightbox');
    if (!modal || modal.style.display !== 'block') return;
    if (!modal.contains(e.target)) return;
    photoLbLoupeOnContextMenu(e);
  }, true);

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
   Layout pins sync to the patient photo row. Dropped files
   upload to the photos bucket after the working clinic and
   an existing appointment are confirmed.
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
var photoOrthoHover = null;
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

function photoOrthoEmptyMap() {
  return {
    before: {}, after: {}, progress: {}, xf: {}, input: {},
    setMeta: { before: { id: '', date: '', remarks: '', appointmentId: '' }, after: { id: '', date: '', remarks: '', appointmentId: '' } },
    progressSets: [], progressDate: '', activeRecordId: '', focus: '',
    compareLeft: '', compareRight: ''
  };
}

function photoOrthoBagOf(o, key) {
  return (o && o[key] && typeof o[key] === 'object' && !Array.isArray(o[key])) ? o[key] : {};
}

function photoOrthoBagHasContent(bag) {
  var k;
  if (!bag) return false;
  for (k in bag) {
    if (Object.prototype.hasOwnProperty.call(bag, k) && bag[k]) return true;
  }
  return false;
}

function photoOrthoCopyBag(bag) {
  var out = {};
  var k;
  for (k in (bag || {})) {
    if (Object.prototype.hasOwnProperty.call(bag, k) && bag[k]) out[k] = bag[k];
  }
  return out;
}

function photoOrthoNewSetId() {
  return 'os-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function photoOrthoMetaOf(raw) {
  raw = raw || {};
  return {
    id: String(raw.id || ''),
    date: String(raw.date || '').slice(0, 10),
    remarks: String(raw.remarks || ''),
    appointmentId: String(raw.appointmentId || '')
  };
}

function photoOrthoNormalizeMap(o) {
  o = o || {};
  var metaIn = photoOrthoBagOf(o, 'setMeta');
  var map = {
    before: photoOrthoBagOf(o, 'before'),
    after: photoOrthoBagOf(o, 'after'),
    progress: photoOrthoBagOf(o, 'progress'),
    xf: photoOrthoBagOf(o, 'xf'),
    input: photoOrthoBagOf(o, 'input'),
    setMeta: {
      before: photoOrthoMetaOf(metaIn.before),
      after: photoOrthoMetaOf(metaIn.after)
    },
    progressSets: [],
    progressDate: String(o.progressDate || '').slice(0, 10),
    activeRecordId: String(o.activeRecordId || ''),
    focus: (o.focus === 'before' || o.focus === 'after' || o.focus === 'progress') ? o.focus : '',
    compareLeft: String(o.compareLeft || '').slice(0, 10),
    compareRight: String(o.compareRight || '').slice(0, 10)
  };
  var list = Array.isArray(o.progressSets) ? o.progressSets : [];
  var i;
  for (i = 0; i < list.length; i++) {
    var src = list[i];
    if (!src || typeof src !== 'object') continue;
    var date = String(src.date || '').slice(0, 10);
    var dup = false;
    var j;
    for (j = 0; j < map.progressSets.length; j++) {
      if (map.progressSets[j].date === date) { dup = true; break; }
    }
    if (dup) continue;
    map.progressSets.push({
      id: String(src.id || '') || photoOrthoNewSetId(),
      date: date,
      remarks: String(src.remarks || ''),
      appointmentId: String(src.appointmentId || ''),
      slots: photoOrthoCopyBag(src.slots),
      xf: photoOrthoCopyBag(src.xf)
    });
  }
  if (!map.progressSets.length && photoOrthoBagHasContent(map.progress)) {
    map.progressSets.push({
      id: photoOrthoNewSetId(),
      date: map.progressDate || '',
      remarks: '',
      appointmentId: '',
      slots: photoOrthoCopyBag(map.progress),
      xf: photoOrthoCopyBag(map.xf && map.xf.progress)
    });
  }
  photoOrthoApplyProgressDate(map);
  photoOrthoTouchSetIds(map);
  return map;
}

function photoOrthoApplyProgressDate(map) {
  var date = String(map.progressDate || '');
  var hit = null;
  var i;
  for (i = 0; i < map.progressSets.length; i++) {
    if (String(map.progressSets[i].date || '') === date) { hit = map.progressSets[i]; break; }
  }
  if (!hit) return;
  map.progress = photoOrthoCopyBag(hit.slots);
  if (!map.xf) map.xf = {};
  map.xf.progress = photoOrthoCopyBag(hit.xf);
}

function photoOrthoTouchSetIds(map) {
  ['before', 'after'].forEach(function(key) {
    if (!map.setMeta[key]) map.setMeta[key] = { id: '', date: '', remarks: '', appointmentId: '' };
    if (photoOrthoBagHasContent(map[key]) && !map.setMeta[key].id) map.setMeta[key].id = photoOrthoNewSetId();
  });
}

function photoOrthoWriteProgressSnapshot(map) {
  if (!map) return;
  if (!Array.isArray(map.progressSets)) map.progressSets = [];
  var date = String(map.progressDate || '').slice(0, 10);
  var hit = null;
  var i;
  for (i = 0; i < map.progressSets.length; i++) {
    if (String(map.progressSets[i].date || '') === date) { hit = map.progressSets[i]; break; }
  }
  if (!hit && !photoOrthoBagHasContent(map.progress)) return;
  if (!hit) {
    hit = { id: photoOrthoNewSetId(), date: date, remarks: '', appointmentId: '', slots: {}, xf: {} };
    map.progressSets.push(hit);
  }
  if (!hit.id) hit.id = photoOrthoNewSetId();
  hit.slots = photoOrthoCopyBag(map.progress);
  hit.xf = photoOrthoCopyBag(map.xf && map.xf.progress);
}

function photoOrthoIsSetKey(k) {
  return k === 'before' || k === 'after' || k === 'progress';
}

function photoOrthoKnownSets() {
  return ['before', 'after', 'progress'];
}

function photoOrthoFilterCat() {
  return String((g('photoFilterCat') && g('photoFilterCat').value) || '').trim().toLowerCase();
}

function photoOrthoVisibleSets() {
  var map = photoOrthoLoad();
  if (map.focus === 'before' || map.focus === 'after' || map.focus === 'progress') return [map.focus];
  var cat = photoOrthoFilterCat();
  if (cat === 'before') return ['before'];
  if (cat === 'after') return ['after'];
  if (cat === 'progress') return ['progress'];
  return ['before', 'after'];
}

function photoOrthoInputMode(map, setKey) {
  var m = map && map.input && map.input[setKey];
  return m === 'composite' ? 'composite' : 'tiles';
}

function photoOrthoSetInputMode(setKey, mode) {
  if (!photoOrthoIsSetKey(setKey)) return;
  var map = photoOrthoLoad();
  if (!map.input) map.input = {};
  map.input[setKey] = mode === 'composite' ? 'composite' : 'tiles';
  photoOrthoSave(map);
  photoOrthoRender();
  var show = g('photoOrthoShow');
  if (show && !show.hasAttribute('hidden')) photoOrthoSlidePaint();
}

function photoOrthoCompId(map, setKey) {
  var bag = map && map[setKey];
  return (bag && bag.composite) || '';
}

function photoOrthoAllComposite(map) {
  var vis = photoOrthoVisibleSets();
  return !!vis.length && vis.every(function(k) {
    return photoOrthoInputMode(map, k) === 'composite';
  });
}

function photoOrthoLoad() {
  var empty = photoOrthoEmptyMap();
  try {
    var raw = localStorage.getItem(photoOrthoKey());
    if (!raw) return empty;
    var o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return empty;
    return photoOrthoNormalizeMap(o);
  } catch (e) {
    return empty;
  }
}

function photoOrthoSave(map) {
  photoOrthoWriteProgressSnapshot(map);
  photoOrthoTouchSetIds(map);
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
    return photoOrthoNormalizeMap(o);
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
  if (setKey === 'after') return mediaTr('media.ortho.after');
  if (setKey === 'progress') return mediaTr('media.ortho.progress');
  return mediaTr('media.ortho.before');
}

function photoOrthoXfGet(map, setKey, slotKey) {
  var bag = map && map.xf && map.xf[setKey];
  var x = bag && bag[slotKey];
  return {
    rot: x && isFinite(Number(x.rot)) ? ((Number(x.rot) % 360) + 360) % 360 : 0,
    flipH: !!(x && x.flipH),
    flipV: !!(x && x.flipV)
  };
}

function photoOrthoXfSet(map, setKey, slotKey, xf) {
  if (!map.xf) map.xf = {};
  if (!map.xf[setKey]) map.xf[setKey] = {};
  if (!xf || (!xf.rot && !xf.flipH && !xf.flipV)) {
    delete map.xf[setKey][slotKey];
    return;
  }
  map.xf[setKey][slotKey] = {
    rot: xf.rot || 0,
    flipH: !!xf.flipH,
    flipV: !!xf.flipV
  };
}

function photoOrthoXfClear(map, setKey, slotKey) {
  if (!map || !map.xf || !map.xf[setKey]) return;
  delete map.xf[setKey][slotKey];
}

function photoOrthoXfCss(xf) {
  var t = [];
  if (xf && xf.rot) t.push('rotate(' + xf.rot + 'deg)');
  if (xf && xf.flipH) t.push('scaleX(-1)');
  if (xf && xf.flipV) t.push('scaleY(-1)');
  return t.join(' ');
}

function photoOrthoToggle(force) {
  var panel = g('photoOrthoPanel');
  if (!panel) return;
  var wasHidden = panel.hasAttribute('hidden');
  var on = (typeof force === 'boolean') ? force : wasHidden;
  if (on) panel.removeAttribute('hidden');
  else {
    panel.setAttribute('hidden', '');
    photoOrthoPickClose();
    if (typeof photoOrthoDatasetCancel === 'function') photoOrthoDatasetCancel();
  }
  var btn = g('btnPhotoOrtho');
  if (btn) btn.classList.toggle('is-on', on);
  if (on) {
    if (wasHidden) photoOrthoPickTarget = null;
    photoOrthoChartDismissed = false;
    photoOrthoBind();
    photoOrthoArmLibraryView();
    photoOrthoRender();
    photoOrthoChartPickerOpen();
    photoOrthoWarmBrowse();
  } else {
    photoOrthoDisarmLibraryView();
  }
}

function photoOrthoArmLibraryView() {
  if (!photoOrthoViewRestore) photoOrthoViewRestore = { kind: photoKindFilter };
  photoOrthoCatNarrow = true;
  var sel = g('photoFilterCat');
  if (sel && photoOrthoDocCategory(sel.value)) sel.value = '';
  refreshPhotoCategorySelects();
  if (photoKindFilter !== 'photos') setPhotoKind('photos');
  else if (typeof filterPhotos === 'function') filterPhotos();
}

function photoOrthoDisarmLibraryView() {
  photoOrthoCatNarrow = false;
  refreshPhotoCategorySelects();
  var kind = photoOrthoViewRestore && photoOrthoViewRestore.kind;
  photoOrthoViewRestore = null;
  if (kind && kind !== photoKindFilter && typeof setPhotoKind === 'function') setPhotoKind(kind);
}

function photoOrthoTileFromEvent(e) {
  var t = e && e.target;
  if (t && t.closest) {
    var tile = t.closest('.ortho-tile');
    if (tile) return tile;
  }
  if (!e || e.clientX == null || typeof document.elementFromPoint !== 'function') return null;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  return (el && el.closest) ? el.closest('.ortho-tile') : null;
}

function photoOrthoSetFromEvent(e) {
  var t = e && e.target;
  if (t && t.closest) {
    var setEl = t.closest('.ortho-set');
    if (setEl) return setEl;
  }
  if (!e || e.clientX == null || typeof document.elementFromPoint !== 'function') return null;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  return (el && el.closest) ? el.closest('.ortho-set') : null;
}

function photoOrthoResolveId(raw) {
  var id = String(raw || '').trim();
  if (!id) return '';
  if (photoOrthoFind(id)) return id;
  var i, rec, url, path, bare;
  bare = id.split('?')[0];
  for (i = 0; i < (photoAllRecords || []).length; i++) {
    rec = photoAllRecords[i];
    if (!rec || photoIsOrthoSidecar(rec)) continue;
    url = String(rec.public_url || '');
    path = String(rec.file_path || '');
    if (url && (id === url || bare === url.split('?')[0] || url.indexOf(bare) === 0 || id.indexOf(url.split('?')[0]) === 0)) {
      return String(rec.id);
    }
    if (path && (id.indexOf(path) >= 0 || bare.indexOf(path) >= 0)) return String(rec.id);
  }
  return '';
}

function photoOrthoReadDragId(e) {
  var fromDrag = (photoOrthoDrag && photoOrthoDrag.id) ? String(photoOrthoDrag.id) : '';
  var fromDt = '';
  if (e && e.dataTransfer) {
    try { fromDt = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text') || ''; } catch (err) { /* dragover cannot read */ }
  }
  return photoOrthoResolveId(fromDrag) || photoOrthoResolveId(fromDt) || fromDrag || String(fromDt || '').trim();
}

function photoOrthoAllowDrop(e) {
  if (!e) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = photoOrthoDrag && photoOrthoDrag.fromSet ? 'move' : 'copy';
}

function photoOrthoDragTypesFiles(dt) {
  if (!dt) return false;
  var types = dt.types;
  var i;
  if (types) {
    for (i = 0; i < types.length; i++) {
      if (String(types[i] || '').toLowerCase() === 'files') return true;
    }
  }
  try {
    if (dt.items && dt.items.length) {
      for (i = 0; i < dt.items.length; i++) {
        if (dt.items[i] && dt.items[i].kind === 'file') return true;
      }
    }
  } catch (err) { /* dragover may hide items */ }
  return false;
}

function photoOrthoEventInPanel(e) {
  var panel = g('photoOrthoPanel');
  if (!panel || panel.hasAttribute('hidden')) return false;
  var t = e && e.target;
  if (t && t.closest && t.closest('#photoOrthoPanel')) return true;
  if (!e || e.clientX == null || typeof document.elementFromPoint !== 'function') return false;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  return !!(el && el.closest && el.closest('#photoOrthoPanel'));
}

function photoOrthoAcceptOsDrag(e) {
  if (!photoOrthoEventInPanel(e)) return;
  // Explorer only completes a desktop drop when dragover is accepted and
  // left alone. Choosing an effect, or stopping the event, from document
  // capture makes Chrome cancel the drop before it reaches the frame.
  e.preventDefault();
  photoOrthoRememberHover(e);
  var tile = photoOrthoTileFromEvent(e);
  var setEl = photoOrthoSetFromEvent(e);
  if (tile) tile.classList.add('is-over');
  if (setEl) setEl.classList.add('is-over');
}

function photoOrthoOsDropAllow(e) {
  if (!photoOrthoEventInPanel(e)) return;
  var external = photoOrthoDragTypesFiles(e.dataTransfer) || photoOrthoHasExternalFiles(e.dataTransfer);
  var internal = !!(photoOrthoDrag && photoOrthoDrag.id);
  if (!external && !internal) return;
  e.preventDefault();
}

function photoOrthoFirstOpenSlot(setKey) {
  var map = photoOrthoLoad();
  var bag = (map && map[setKey]) || {};
  var i;
  for (i = 0; i < PHOTO_ORTHO_SLOTS.length; i++) {
    if (!bag[PHOTO_ORTHO_SLOTS[i][0]]) return PHOTO_ORTHO_SLOTS[i][0];
  }
  return PHOTO_ORTHO_SLOTS[0][0];
}

function photoOrthoSnapshotFiles(dt) {
  var out = [];
  var i;
  var list;
  if (!dt) return out;
  list = dt.files;
  if (list && list.length) {
    for (i = 0; i < list.length; i++) if (list[i]) out.push(list[i]);
  }
  if (out.length || !dt.items) return out;
  for (i = 0; i < dt.items.length; i++) {
    var item = dt.items[i];
    if (!item || (item.kind && item.kind !== 'file')) continue;
    if (typeof item.getAsFile !== 'function') continue;
    var got = item.getAsFile();
    if (got) out.push(got);
  }
  return out;
}

function photoOrthoRememberHover(e) {
  var tile = photoOrthoTileFromEvent(e);
  var setEl = photoOrthoSetFromEvent(e);
  if (tile) {
    photoOrthoHover = { setKey: tile.dataset.set || 'before', slotKey: tile.dataset.slot || '' };
  } else if (setEl) {
    photoOrthoHover = { setKey: setEl.dataset.set || 'before', slotKey: '' };
  }
  return photoOrthoHover;
}

function photoOrthoDropTarget(e) {
  var tile = photoOrthoTileFromEvent(e);
  var setEl = photoOrthoSetFromEvent(e);
  var hover = photoOrthoHover || {};
  var slotKey = '';
  if (tile && tile.dataset.slot) slotKey = tile.dataset.slot;
  else if (!tile) slotKey = hover.slotKey || '';
  return {
    tile: tile,
    setEl: setEl,
    setKey: (tile && tile.dataset.set) || (setEl && setEl.dataset.set) || hover.setKey || 'before',
    slotKey: slotKey
  };
}

function photoOrthoBind() {
  var root = g('photoOrthoSets');
  var panel = g('photoOrthoPanel');
  if (!root || photoOrthoBound) return;
  photoOrthoBound = true;
  var recBox = g('photoOrthoRecords');
  if (recBox && !recBox.dataset.bound) {
    recBox.dataset.bound = '1';
    recBox.addEventListener('click', function(e) {
      if (e.target.closest && e.target.closest('input, button, select, textarea')) return;
      var tr = e.target.closest ? e.target.closest('[data-record]') : null;
      if (!tr) return;
      photoOrthoLoadRecord(tr.getAttribute('data-record'));
    });
    recBox.addEventListener('change', function(e) {
      var note = e.target.getAttribute ? e.target.getAttribute('data-record-note') : '';
      var date = e.target.getAttribute ? e.target.getAttribute('data-record-date') : '';
      var visit = e.target.getAttribute ? e.target.getAttribute('data-record-visit') : '';
      if (note) photoOrthoRecordRemark(note, e.target.value);
      else if (date) photoOrthoRecordDate(date, e.target.value);
      else if (visit) photoOrthoRecordVisit(visit, e.target.value);
    });
  }
  function onOver(e) {
    var tile = photoOrthoTileFromEvent(e);
    var setEl = photoOrthoSetFromEvent(e);
    var external = photoOrthoDragTypesFiles(e.dataTransfer);
    if (!tile && !setEl && !external) return;
    if (external) e.preventDefault();
    else photoOrthoAllowDrop(e);
    photoOrthoRememberHover(e);
    if (tile) tile.classList.add('is-over');
    if (setEl) setEl.classList.add('is-over');
  }
  function placeExternal(setKey, slotKey, files) {
    var images = photoOrthoImageFiles(files);
    if (!images.length) {
      mediaNotify(mediaTr('media.ortho.dropNone'), 'error');
      return;
    }
    var mapNow = photoOrthoLoad();
    var slot = null;
    if (photoOrthoInputMode(mapNow, setKey) === 'composite' || slotKey === 'composite') slot = 'composite';
    else if (slotKey) slot = slotKey;
    else if (images.length === 1) slot = photoOrthoFirstOpenSlot(setKey);
    photoOrthoCommitDrop(setKey, images, slot);
  }
  function onDrop(e) {
    var where = photoOrthoDropTarget(e);
    // Read the file list on the frame. A document capture listener sees an
    // empty list for a real Explorer drag, and an empty snapshot must not
    // hide the files that are present once the drop reaches this element.
    var snappedRaw = (e && e._orthoFiles && e._orthoFiles.length)
      ? e._orthoFiles
      : photoOrthoSnapshotFiles(e && e.dataTransfer);
    var snapped = photoOrthoImageFiles(snappedRaw);
    if (!where.tile && !where.setEl && !snapped.length && !photoOrthoHasExternalFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    if (where.tile) where.tile.classList.remove('is-over');
    if (where.setEl) where.setEl.classList.remove('is-over');
    var setKey = where.setKey;
    var compareDate = (where.tile && where.tile.getAttribute('data-compare-date')) ||
      (where.setEl && where.setEl.getAttribute('data-compare-date')) || '';
    if (compareDate) photoOrthoEnsureCompareLive(compareDate);
    if (snapped.length || photoOrthoHasExternalFiles(e.dataTransfer)) {
      photoOrthoDrag = null;
      if (snapped.length) {
        placeExternal(setKey, where.slotKey, snapped);
        return;
      }
      photoOrthoCollectDropFiles(e.dataTransfer).then(function(files) {
        placeExternal(setKey, where.slotKey, files);
      });
      return;
    }
    if (!where.tile) return;
    var from = photoOrthoDrag;
    var id = photoOrthoReadDragId(e);
    photoOrthoDrag = null;
    if (!id) return;
    photoOrthoPlace(where.tile.dataset.set, where.tile.dataset.slot, id, from);
  }
  root.addEventListener('change', function(e) {
    var side = e.target && e.target.getAttribute && e.target.getAttribute('data-compare-side');
    if (!side) return;
    photoOrthoComparePick(side, e.target.value);
  });
  document.addEventListener('dragenter', photoOrthoAcceptOsDrag, true);
  document.addEventListener('dragover', photoOrthoAcceptOsDrag, true);
  document.addEventListener('drop', photoOrthoOsDropAllow, true);
  ['dragenter', 'dragover'].forEach(function(name) {
    root.addEventListener(name, onOver);
    if (panel) panel.addEventListener(name, onOver);
  });
  root.addEventListener('drop', onDrop);
  if (panel) panel.addEventListener('drop', onDrop);
  root.addEventListener('dragleave', function(e) {
    var tile = e.target.closest ? e.target.closest('.ortho-tile') : null;
    var setEl = e.target.closest ? e.target.closest('.ortho-set') : null;
    if (tile) tile.classList.remove('is-over');
    if (setEl) setEl.classList.remove('is-over');
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
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tile.dataset.photo); } catch (err) { /* IE */ }
      try { e.dataTransfer.setData('text', tile.dataset.photo); } catch (err2) { /* WebView */ }
    }
  });
  root.addEventListener('click', function(e) {
    var folderBtn = e.target.closest ? e.target.closest('[data-ortho-folder]') : null;
    if (folderBtn) {
      e.preventDefault();
      e.stopPropagation();
      photoOrthoPickFolder(folderBtn.getAttribute('data-set'), folderBtn.getAttribute('data-compare-date') || '');
      return;
    }
    var modeBtn = e.target.closest ? e.target.closest('[data-ortho-mode]') : null;
    if (modeBtn) {
      e.preventDefault();
      e.stopPropagation();
      photoOrthoSetInputMode(modeBtn.getAttribute('data-set'), modeBtn.getAttribute('data-ortho-mode'));
      return;
    }
    var edit = e.target.closest ? e.target.closest('[data-ortho-edit]') : null;
    if (edit) {
      e.preventDefault();
      e.stopPropagation();
      photoOrthoTileMenuOpen(edit);
      return;
    }
    var browse = e.target.closest ? e.target.closest('[data-ortho-browse]') : null;
    if (browse) {
      e.preventDefault();
      e.stopPropagation();
      photoOrthoBrowseFile(browse.getAttribute('data-set'), browse.getAttribute('data-slot'), browse.getAttribute('data-compare-date') || '');
      return;
    }
    var tile = e.target.closest ? e.target.closest('.ortho-tile') : null;
    if (!tile) return;
    photoOrthoAimFrame(tile.dataset.set, tile.dataset.slot);
  });
  root.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest && e.target.closest('[data-ortho-browse], [data-ortho-edit], [data-ortho-mode], [data-ortho-folder]')) return;
    var tile = e.target.closest ? e.target.closest('.ortho-tile') : null;
    if (!tile) return;
    e.preventDefault();
    photoOrthoAimFrame(tile.dataset.set, tile.dataset.slot);
  });
}

function photoOrthoPlace(setKey, slotKey, id, from) {
  if (!photoOrthoIsSetKey(setKey)) return;
  var resolved = id ? (photoOrthoResolveId(id) || '') : '';
  if (id && !resolved) {
    mediaNotify(mediaTr('media.ortho.attachFail'), 'error');
    return;
  }
  var map = photoOrthoLoad();
  if (!map.before) map.before = {};
  if (!map.after) map.after = {};
  if (!map.progress) map.progress = {};
  if (!map.xf) map.xf = {};
  if (from && from.fromSet && (from.fromSet !== setKey || from.fromSlot !== slotKey)) {
    if (map[from.fromSet]) delete map[from.fromSet][from.fromSlot];
    photoOrthoXfClear(map, from.fromSet, from.fromSlot);
  }
  if (resolved) {
    map[setKey][slotKey] = resolved;
    photoOrthoXfClear(map, setKey, slotKey);
  } else {
    delete map[setKey][slotKey];
    photoOrthoXfClear(map, setKey, slotKey);
  }
  photoOrthoSave(map);
  photoOrthoRender();
  var show = g('photoOrthoShow');
  if (show && !show.hasAttribute('hidden')) photoOrthoSlidePaint();
}

function photoOrthoTeethFrontal(text) {
  var s = String(text || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  return /front(?:al)?[\s.]*teeth|front(?:al)?[\s.]*tooth|teeth[\s.]*front(?:al)?|tooth[\s.]*front(?:al)?|正面牙|正面口|口内正面|口內正面|intraoral/.test(s);
}

function photoOrthoNameHitsSlot(rec, slotKey) {
  var s = (String((rec && rec.file_path) || '') + ' ' + String((rec && rec.caption) || '')).toLowerCase();
  var loose = s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  if (slotKey === 'face' && photoOrthoTeethFrontal(loose)) return false;
  var hints = {
    profile: /profile|side\b|lateral|侧面|側面/,
    face: /repose|frontal face|face front|facial|正面(?!口|牙)|fr(?:on)?tal(?![\s.]*smile)/,
    smile: /smile|微笑/,
    upper: /upper|occlusal-u|maxilla|上颌|上顎/,
    extra: /extra|three-quarter|3\/4|补充|補充/,
    lower: /lower|occlusal-l|mandible|下颌|下顎/,
    buccalR: /right.?buccal|buccal.?r|右侧|右側/,
    intra: /intraoral|front(?:al)?[\s.]*teeth|front(?:al)?[\s.]*tooth|teeth[\s.]*front(?:al)?|tooth[\s.]*front(?:al)?|正面口|正面牙|口内正面|口內正面/,
    buccalL: /left.?buccal|buccal.?l|左侧|左側/
  };
  var hay = (slotKey === 'face' || slotKey === 'intra') ? loose : s;
  return hints[slotKey] ? hints[slotKey].test(hay) : false;
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
  if (!photoOrthoIsSetKey(setKey)) return;
  var images = photoOrthoAutoPlaceList();
  if (!images.length) {
    mediaNotify(mediaTr('media.ortho.placeNone'), 'error');
    return 0;
  }
  var map = photoOrthoLoad();
  if (photoOrthoInputMode(map, setKey) === 'composite') {
    if (!map[setKey]) map[setKey] = {};
    map[setKey].composite = String(images[0].id);
    photoOrthoSave(map);
    photoOrthoRender();
    mediaNotify(mediaTrRepl('media.ortho.placeOk', { N: '1', SET: photoOrthoSetLabel(setKey) }), 'info');
    return 1;
  }
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
  if (!map.input) map.input = {};
  map.input[toKey] = photoOrthoInputMode(map, fromKey);
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
var photoOrthoUploadBusy = false;
var photoOrthoDatasetWait = null;
var photoOrthoDatasetTag = '';

function photoOrthoImageFiles(files) {
  return (files || []).filter(function(file) {
    if (!file) return false;
    var name = String(file.name || '').toLowerCase();
    var type = String(file.type || '').toLowerCase();
    if (type.indexOf('pdf') >= 0 || /\.pdf$/.test(name)) return false;
    if (type.indexOf('image/') === 0) return true;
    if (/\.(jpe?g|jpe|jfif|png|webp|gif|bmp|heic|heif|avif|tif{1,2})$/.test(name)) return true;
    if ((!type || type === 'application/octet-stream') && file.size > 0 && !/\.[a-z0-9]{1,5}$/.test(name)) return true;
    return false;
  });
}

function photoOrthoHasExternalFiles(dt) {
  if (photoOrthoDrag && photoOrthoResolveId(photoOrthoDrag.id)) return false;
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

function photoOrthoCategoryForSet(setKey) {
  if (setKey === 'after') return 'After';
  if (setKey === 'progress') return 'Progress';
  return 'Before';
}

function photoOrthoWorkingClinicTag() {
  return (typeof currentClinicCodeForTagging === 'function') ? String(currentClinicCodeForTagging() || '') : '';
}

function photoOrthoDatasetHide(result) {
  var box = g('photoOrthoDataset');
  if (box) box.hidden = true;
  var board = g('photoOrthoPanel');
  if (board) board.classList.remove('is-armed');
  var wait = photoOrthoDatasetWait;
  photoOrthoDatasetWait = null;
  photoOrthoDatasetTag = '';
  if (wait) wait(result || null);
}

function photoOrthoDatasetNote(msg) {
  var note = g('photoOrthoDatasetNote');
  if (note) note.textContent = msg || '';
}

function photoOrthoDatasetRead() {
  var clinic = photoOrthoClinicName();
  var sel = g('photoOrthoDatasetAppt');
  var opt = sel && sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
  var id = sel && sel.value ? String(sel.value) : '';
  if (!clinic || !id) return null;
  var date = opt ? (opt.getAttribute('data-date') || '') : '';
  var dr = opt ? (opt.getAttribute('data-dr') || '') : '';
  return {
    appointment_id: id,
    clinic: clinic,
    taken_date: date || (typeof todayISO === 'function' ? todayISO() : null),
    dr: dr || photoOrthoDoctorName()
  };
}

function photoOrthoDatasetSave() {
  if (photoOrthoDatasetTag && photoOrthoWorkingClinicTag() !== photoOrthoDatasetTag) {
    photoOrthoDatasetNote(mediaTr('media.ortho.clinicChanged'));
    return;
  }
  var ctx = photoOrthoDatasetRead();
  if (!ctx || !ctx.clinic) {
    photoOrthoDatasetNote(mediaTr('media.ortho.clinicMissing'));
    return;
  }
  if (!ctx.appointment_id) {
    photoOrthoDatasetNote(mediaTr('media.ortho.apptNeed'));
    return;
  }
  photoOrthoDatasetHide(ctx);
}

function photoOrthoDatasetCancel() {
  if (!photoOrthoDatasetWait && !(g('photoOrthoDataset') && !g('photoOrthoDataset').hidden)) return;
  photoOrthoDatasetHide(null);
}

function photoOrthoLoadVisitRows(pid) {
  if (!pid || typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve([]);
  function run(cols) {
    return Promise.resolve(
      SB.from('appointments').select(cols).eq('patient_id', pid)
        .order('date', { ascending: false }).limit(40)
    );
  }
  return run('id,date,start_time,dentist_name,doctor_code,treatment_items,clinic_tag').then(function(r) {
    if (r && r.error) return run('id,date,start_time,dentist_name,doctor_code,treatment_items');
    return r;
  }).then(function(r) {
    return (r && !r.error && Array.isArray(r.data)) ? r.data : [];
  }, function() { return []; });
}

function photoOrthoConfirmDataset(setKey, count) {
  return new Promise(function(resolve) {
    if (photoOrthoDatasetWait) photoOrthoDatasetWait(null);
    var box = g('photoOrthoDataset');
    if (!box) { resolve(null); return; }
    photoOrthoDatasetWait = resolve;
    photoOrthoDatasetTag = photoOrthoWorkingClinicTag();
    var saveBtnEarly = g('photoOrthoDatasetSave');
    if (saveBtnEarly) saveBtnEarly.disabled = true;
    var lead = g('photoOrthoDatasetLead');
    if (lead) {
      lead.textContent = mediaTrRepl('media.ortho.datasetLead', {
        N: String(count),
        SET: photoOrthoSetLabel(setKey)
      });
    }
    var clinicEl = g('photoOrthoDatasetClinic');
    var clinicName = photoOrthoClinicName();
    if (clinicEl) clinicEl.textContent = clinicName || '—';
    var saveBtn = g('photoOrthoDatasetSave');
    var sel = g('photoOrthoDatasetAppt');
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(box);
    if (lead) {
      lead.textContent = mediaTrRepl('media.ortho.datasetLead', {
        N: String(count),
        SET: photoOrthoSetLabel(setKey)
      });
    }
    function fill(rows) {
      var tag = photoOrthoDatasetTag;
      var today = (typeof todayISO === 'function') ? todayISO() : '';
      var prefer = '';
      var n = 0;
      if (sel) {
        sel.innerHTML = '<option value="">' + esc(mediaTr('media.ortho.apptPh')) + '</option>';
        (rows || []).forEach(function(a) {
          if (!a || !a.id) return;
          if (tag && a.clinic_tag && String(a.clinic_tag) !== tag) return;
          var o = document.createElement('option');
          o.value = String(a.id);
          var label = (typeof conMediaApptLabel === 'function') ? conMediaApptLabel(a) : String(a.date || a.id);
          o.textContent = label;
          o.setAttribute('data-date', String(a.date || '').slice(0, 10));
          o.setAttribute('data-dr', String(a.dentist_name || a.doctor_code || ''));
          sel.appendChild(o);
          n++;
          if (!prefer && a.date === today) prefer = String(a.id);
        });
        if (!prefer && sel.options.length > 1) prefer = sel.options[1].value;
        sel.value = prefer || '';
      }
      var ready = !!clinicName && n > 0;
      if (saveBtn) saveBtn.disabled = !ready;
      if (!clinicName) photoOrthoDatasetNote(mediaTr('media.ortho.clinicMissing'));
      else if (!n) photoOrthoDatasetNote(mediaTr('media.ortho.apptNone'));
      else photoOrthoDatasetNote(mediaTr('media.ortho.datasetHint'));
      box.hidden = false;
      var board = g('photoOrthoPanel');
      if (board) board.classList.add('is-armed');
      try { box.scrollIntoView({ block: 'center' }); } catch (e) {}
    }
    photoOrthoLoadVisitRows(photoPatientId).then(fill, function() { fill([]); });
  });
}

function photoOrthoProgress(show, label, pct) {
  var box = g('photoOrthoProgress');
  var known = typeof pct === 'number' && isFinite(pct);
  if (box) {
    if (!show) {
      box.hidden = true;
      box.classList.remove('is-busy', 'is-wait');
    } else {
      box.hidden = false;
      var lab = g('photoOrthoProgressLabel');
      if (lab) lab.textContent = label || '';
      var fill = g('photoOrthoProgressFill');
      box.classList.toggle('is-busy', !known);
      box.classList.toggle('is-wait', known && pct < 100);
      if (fill) fill.style.width = known ? Math.max(8, Math.min(100, pct)) + '%' : '';
    }
  }
  if (typeof showPhotoUploadProgress === 'function') {
    showPhotoUploadProgress(!!show, label, known ? pct : 12);
  }
}

function photoOrthoPrepareUploadFile(file) {
  var type = String((file && file.type) || '').toLowerCase();
  if (!file || file.size < 900000 || !/^image\/(jpeg|png|webp)$/.test(type)) {
    return Promise.resolve(file);
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined') return Promise.resolve(file);
  photoOrthoProgress(true, mediaTr('media.ortho.preparing'));
  return new Promise(function(resolve) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    var done = function(next) {
      try { URL.revokeObjectURL(url); } catch (eRevoke) {}
      resolve(next || file);
    };
    img.onload = function() {
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      var scale = (w && h) ? Math.min(1, 2000 / Math.max(w, h)) : 1;
      if (!w || !h || (scale > 0.92 && file.size < 1500000)) {
        done(file);
        return;
      }
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      var draw = canvas.getContext('2d');
      if (!draw || typeof canvas.toBlob !== 'function') { done(file); return; }
      draw.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function(blob) {
        if (!blob || blob.size >= file.size) { done(file); return; }
        var name = String(file.name || 'photo.jpg').replace(/\.[^.]+$/, '') + '.jpg';
        try {
          done(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
        } catch (errFile) {
          done(file);
        }
      }, 'image/jpeg', 0.82);
    };
    img.onerror = function() { done(file); };
    img.src = url;
  });
}

function photoOrthoUploadDropped(files, setKey, ctx, opts) {
  var images = photoOrthoImageFiles(files);
  var cat = photoOrthoCategoryForSet(setKey);
  var recs = [];
  var failed = '';
  if (!images.length || !ctx || typeof photoUploadOne !== 'function') {
    return Promise.resolve({ recs: recs, error: failed || 'upload' });
  }
  var chain = Promise.resolve();
  images.forEach(function(file, i) {
    chain = chain.then(function() {
      if (failed) return null;
      var label = mediaTrRepl('media.ortho.savingN', {
        N: String(i + 1),
        M: String(images.length)
      });
      photoOrthoProgress(true, label, Math.round((i / images.length) * 90));
      var caption = String(file.name || '').replace(/\.[^.]+$/, '');
      var prepared = (opts && opts.asImport) ? Promise.resolve(file) : photoOrthoPrepareUploadFile(file);
      return prepared.then(function(ready) {
      return photoUploadOne(ready, {
        category: cat,
        caption: caption,
        taken_date: ctx.taken_date || null,
        dr: ctx.dr || null,
        clinic: ctx.clinic || null,
        ctx: {
          appointment_id: ctx.appointment_id || null,
          tags: ['ortho', setKey]
        }
      }, function(stageLabel, pct) {
        var span = 90 / images.length;
        var base = (i / images.length) * 90;
        var mapped = base + (Math.max(0, Math.min(100, pct || 0)) / 100) * span;
        photoOrthoProgress(true, stageLabel || label, Math.round(mapped));
      }).then(function(res) {
        if (!res || !res.ok || !res.id) {
          failed = (res && res.msg) || 'upload';
          return null;
        }
        recs.push({
          id: res.id,
          patient_id: photoPatientId,
          category: cat,
          file_path: res.path || '',
          caption: caption,
          public_url: (res.path && typeof photoGetPublicUrlForPath === 'function')
            ? (photoGetPublicUrlForPath(res.path) || null) : null,
          taken_date: ctx.taken_date || null,
          dr: ctx.dr || null,
          clinic: ctx.clinic || null,
          appointment_id: ctx.appointment_id || null
        });
        return res;
      });
      });
    });
  });
  return chain.then(function() {
    photoOrthoProgress(false);
    return { recs: recs, error: failed };
  }, function(err) {
    photoOrthoProgress(false);
    return { recs: recs, error: (err && err.message) || String(err) };
  });
}

function photoOrthoMergeUploaded(recs) {
  (recs || []).forEach(function(rec) {
    if (!rec || !rec.id || photoOrthoFind(rec.id)) return;
    photoAllRecords = (photoAllRecords || []).concat([rec]);
  });
}

function photoOrthoApplyUploaded(setKey, recs, slotKey) {
  if (!recs || !recs.length) return 0;
  if (slotKey) {
    photoOrthoPlace(setKey, slotKey, recs[0].id, null);
    return photoOrthoFind(recs[0].id) ? 1 : 0;
  }
  var mapMode = photoOrthoLoad();
  if (photoOrthoInputMode(mapMode, setKey) === 'composite') {
    photoOrthoPlace(setKey, 'composite', recs[0].id, null);
    return photoOrthoFind(recs[0].id) ? 1 : 0;
  }
  var prev = photoSelected;
  photoSelected = new Set(recs.map(function(x) { return x.id; }));
  var n = photoOrthoAutoPlace(setKey);
  photoSelected = prev;
  return n;
}

function photoOrthoCommitDrop(setKey, files, slotKey, opts) {
  if (!photoOrthoIsSetKey(setKey)) return Promise.resolve(0);
  var images = photoOrthoImageFiles(files);
  if (!images.length) {
    mediaNotify(mediaTr('media.ortho.dropNone'), 'error');
    photoOrthoProgress(false);
    return Promise.resolve(0);
  }
  if (photoOrthoUploadBusy) {
    mediaNotify(mediaTr('media.ortho.savingBusy'), 'error');
    return Promise.resolve(0);
  }
  if (!photoPatientId) {
    mediaNotify(mediaTr('con.forms.alertSelectPatient'), 'error');
    photoOrthoProgress(false);
    return Promise.resolve(0);
  }
  var pinSlot = slotKey || null;
  if (!pinSlot && photoOrthoInputMode(photoOrthoLoad(), setKey) === 'composite') pinSlot = 'composite';
  if (pinSlot === 'composite') images = images.slice(0, 1);
  if (pinSlot) return photoOrthoQuietSave(setKey, images, pinSlot);
  if (images.length !== PHOTO_ORTHO_SLOTS.length) {
    var ok = window.confirm(mediaTrRepl('media.ortho.dropCount', {
      N: String(images.length),
      SET: photoOrthoSetLabel(setKey),
      M: String(PHOTO_ORTHO_SLOTS.length)
    }));
    if (!ok) {
      photoOrthoProgress(false);
      return Promise.resolve(0);
    }
  }
  var job = {};
  return photoOrthoConfirmDataset(setKey, images.length).then(function(ctx) {
    if (!ctx) {
      photoOrthoProgress(false);
      return 0;
    }
    photoOrthoUploadBusy = job;
    return photoOrthoUploadDropped(images, setKey, ctx, opts).then(function(pack) {
      pack = pack || { recs: [], error: '' };
      var reload = (typeof loadPhotoRecords === 'function') ? loadPhotoRecords() : Promise.resolve();
      return Promise.resolve(reload).then(function() {
        photoOrthoMergeUploaded(pack.recs);
        if (typeof filterPhotos === 'function') filterPhotos();
        var n = photoOrthoApplyUploaded(setKey, pack.recs, pinSlot);
        if (typeof conSchedulePatientTimelineRefresh === 'function' && photoPatientId) {
          conSchedulePatientTimelineRefresh(photoPatientId);
        }
        if (pack.error) {
          mediaNotify(mediaTrRepl('media.ortho.saveFail', { MSG: pack.error }), 'error');
        } else if (n) {
          mediaNotify(mediaTrRepl('media.ortho.savedOk', { N: String(n), SET: photoOrthoSetLabel(setKey) }), 'info');
        }
        return n;
      });
    });
  }).catch(function(err) {
    mediaNotify(mediaTrRepl('media.ortho.saveFail', { MSG: (err && err.message) || String(err) }), 'error');
    return 0;
  }).then(function(n) {
    if (photoOrthoUploadBusy === job) photoOrthoUploadBusy = false;
    return n;
  });
}

function photoOrthoQuietContext() {
  var clinic = photoOrthoClinicName() || null;
  var today = (typeof todayISO === 'function') ? todayISO() : null;
  var dr = photoOrthoDoctorName() || null;
  var sel = g('photoOrthoDatasetAppt');
  var id = sel && sel.value ? String(sel.value) : '';
  var opt = (id && sel && sel.options && sel.selectedIndex >= 0) ? sel.options[sel.selectedIndex] : null;
  if (id && opt) {
    return {
      appointment_id: id,
      clinic: clinic,
      taken_date: opt.getAttribute('data-date') || today,
      dr: opt.getAttribute('data-dr') || dr
    };
  }
  return { appointment_id: null, clinic: clinic, taken_date: today, dr: dr };
}

var photoOrthoPreviewUrl = '';
var photoOrthoHoldBoard = false;

function photoOrthoShowLocalPreview(setKey, slotKey, file) {
  if (!file || !slotKey) return;
  var root = g('photoOrthoSets');
  if (!root) return;
  var tiles = root.querySelectorAll('.ortho-tile');
  var tile = null;
  var i;
  for (i = 0; i < tiles.length; i++) {
    if (tiles[i].dataset.set === setKey && tiles[i].dataset.slot === slotKey) { tile = tiles[i]; break; }
  }
  if (!tile) return;
  var url = '';
  try { url = URL.createObjectURL(file); } catch (e) { return; }
  if (photoOrthoPreviewUrl) {
    try { URL.revokeObjectURL(photoOrthoPreviewUrl); } catch (e2) {}
  }
  photoOrthoPreviewUrl = url;
  tile.classList.add('is-filled');
  tile.classList.remove('is-empty');
  var img = tile.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.alt = '';
    tile.insertBefore(img, tile.firstChild);
  }
  img.src = url;
}

function photoOrthoDropLocalPreview() {
  if (!photoOrthoPreviewUrl) return;
  var url = photoOrthoPreviewUrl;
  photoOrthoPreviewUrl = '';
  try { URL.revokeObjectURL(url); } catch (e) {}
}

function photoOrthoQuietSave(setKey, images, pinSlot) {
  var job = {};
  var ctx = photoOrthoQuietContext();
  photoOrthoShowLocalPreview(setKey, pinSlot, images && images[0]);
  photoOrthoUploadBusy = job;
  return photoOrthoUploadDropped(images, setKey, ctx, { asImport: true }).then(function(pack) {
    pack = pack || { recs: [], error: '' };
    photoOrthoMergeUploaded(pack.recs);
    var id = pack.recs[0] && pack.recs[0].id;
    var n = 0;
    if (id) {
      photoOrthoPlace(setKey, pinSlot, id, null);
      n = photoOrthoFind(id) ? 1 : 0;
    } else {
      photoOrthoRender();
    }
    photoOrthoDropLocalPreview();
    photoOrthoHoldBoard = true;
    setTimeout(function() {
      try { if (typeof filterPhotos === 'function') filterPhotos(); } catch (errGrid) { /* grid refresh */ }
      if (typeof conSchedulePatientTimelineRefresh === 'function' && photoPatientId) {
        conSchedulePatientTimelineRefresh(photoPatientId);
      }
    }, 0);
    if (pack.error) {
      mediaNotify(mediaTrRepl('media.ortho.saveFail', { MSG: pack.error }), 'error');
    } else if (n) {
      mediaNotify(mediaTrRepl('media.ortho.savedOk', { N: String(n), SET: photoOrthoSetLabel(setKey) }), 'info');
    }
    return n;
  }).catch(function(err) {
    photoOrthoDropLocalPreview();
    photoOrthoRender();
    mediaNotify(mediaTrRepl('media.ortho.saveFail', { MSG: (err && err.message) || String(err) }), 'error');
    return 0;
  }).then(function(n) {
    if (photoOrthoUploadBusy === job) photoOrthoUploadBusy = false;
    return n;
  });
}

function photoOrthoPlaceFiles(setKey, files) {
  return photoOrthoCommitDrop(setKey, files, null, { asImport: true });
}

var photoOrthoBrowseTarget = null;
var photoOrthoBrowseDir = null;
var photoOrthoBrowseWarmed = false;
var photoOrthoFolderDate = '';

function photoOrthoBrowseDb() {
  return new Promise(function(resolve) {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    var req;
    try { req = indexedDB.open('jsm-ortho-browse', 1); } catch (e) { resolve(null); return; }
    req.onupgradeneeded = function() {
      try { req.result.createObjectStore('handles'); } catch (errStore) {}
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { resolve(null); };
  });
}

function photoOrthoSaveBrowseDir(dir) {
  if (!dir || dir.kind !== 'directory') return;
  photoOrthoBrowseDir = dir;
  photoOrthoBrowseDb().then(function(db) {
    if (!db) return;
    try {
      db.transaction('handles', 'readwrite').objectStore('handles').put(dir, 'folder');
    } catch (e) {}
  }, function() {});
}

function photoOrthoWarmBrowseDir() {
  photoOrthoBrowseDb().then(function(db) {
    if (!db) return null;
    return new Promise(function(resolve) {
      var get;
      try { get = db.transaction('handles', 'readonly').objectStore('handles').get('folder'); }
      catch (e) { resolve(null); return; }
      get.onsuccess = function() { resolve(get.result || null); };
      get.onerror = function() { resolve(null); };
    });
  }).then(function(dir) {
    if (!dir || typeof dir.queryPermission !== 'function') return;
    return Promise.resolve(dir.queryPermission({ mode: 'read' })).then(function(state) {
      if (state !== 'granted') return;
      photoOrthoBrowseDir = dir;
      if (typeof dir.values !== 'function') return;
      var it = dir.values();
      var n = 0;
      function step() {
        return Promise.resolve(it.next()).then(function(item) {
          if (!item || item.done || n >= 40) return;
          n++;
          return step();
        }, function() {});
      }
      return step();
    }, function() {});
  }, function() {});
}

function photoOrthoWarmEncoder() {
  try {
    var canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    var ctx = canvas.getContext('2d');
    if (ctx) ctx.fillRect(0, 0, 2, 2);
    if (typeof canvas.toBlob === 'function') canvas.toBlob(function() {}, 'image/jpeg', 0.82);
  } catch (e) {}
}

function photoOrthoWarmStorage() {
  if (!photoPatientId || typeof SB === 'undefined' || !SB || !SB.storage || typeof SB.storage.from !== 'function') return;
  try {
    Promise.resolve(SB.storage.from(PHOTO_BUCKET).list(String(photoPatientId), { limit: 1 })).then(function() {}, function() {});
  } catch (e) {}
}

function photoOrthoWarmBrowse() {
  photoOrthoEnsureVisitCache();
  photoOrthoWarmStorage();
  if (photoOrthoBrowseWarmed) return;
  photoOrthoBrowseWarmed = true;
  photoOrthoWarmEncoder();
  photoOrthoWarmBrowseDir();
}

function photoOrthoBrowseFileInput() {
  var inp = g('photoOrthoFrameInput');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

function photoOrthoFrameInputChange(inp) {
  var file = inp && inp.files && inp.files[0];
  var target = photoOrthoBrowseTarget;
  if (inp) inp.value = '';
  if (!file || !target) return;
  photoOrthoCommitDrop(target.set, [file], target.slot);
}

function photoOrthoAimFrame(setKey, slotKey) {
  if (!photoOrthoIsSetKey(setKey) || !slotKey) return;
  photoOrthoChartDismissed = false;
  photoOrthoPick(setKey, slotKey, { quiet: true });
}

function photoOrthoBrowseBtnHtml(setKey, slotKey, date) {
  return '<button type="button" class="ortho-tile-browse" data-ortho-browse="1"' +
    ' data-set="' + esc(setKey) + '" data-slot="' + esc(slotKey) + '"' +
    (date ? ' data-compare-date="' + esc(date) + '"' : '') +
    ' aria-label="' + esc(mediaTr('media.ortho.browse')) + '">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M2.5 6.2A1.7 1.7 0 0 1 4.2 4.5h4.1l1.7 1.8h9.8A1.7 1.7 0 0 1 21.5 8v1.1H2.5V6.2zm0 4.2h19l-1.35 7.4a1.7 1.7 0 0 1-1.67 1.4H5.52a1.7 1.7 0 0 1-1.67-1.4L2.5 10.4z"/>' +
    '</svg></button>';
}

function photoOrthoMarkAimed(setKey, slotKey) {
  var root = g('photoOrthoSets');
  if (!root) return;
  var tiles = root.querySelectorAll('.ortho-tile');
  var i;
  for (i = 0; i < tiles.length; i++) {
    tiles[i].classList.toggle('is-aimed', tiles[i].dataset.set === setKey && tiles[i].dataset.slot === slotKey);
  }
}

function photoOrthoBrowseFile(setKey, slotKey, date) {
  if (!photoOrthoIsSetKey(setKey) || !slotKey) return;
  photoOrthoBrowseTarget = { set: setKey, slot: slotKey, date: String(date || '') };
  photoOrthoChartDismissed = false;
  var picker = null;
  var wide = [{
    description: 'Images',
    accept: {
      'image/jpeg': ['.jpg', '.jpeg', '.jpe', '.jfif'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/gif': ['.gif'],
      'image/bmp': ['.bmp'],
      'image/tiff': ['.tif', '.tiff'],
      'image/avif': ['.avif'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif']
    }
  }];
  var narrow = [{
    description: 'Images',
    accept: {
      'image/jpeg': ['.jpg', '.jpeg', '.jfif'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/gif': ['.gif']
    }
  }];
  // Open the dialog in this click. A wildcard type throws before the
  // promise exists, and the plain file input only opens during the click.
  if (typeof window.showOpenFilePicker === 'function') {
    var frameOpt = {
      id: 'jsm-ortho-frame',
      startIn: 'downloads',
      multiple: false,
      types: wide
    };
    if (photoOrthoBrowseDir) frameOpt.startIn = photoOrthoBrowseDir;
    try {
      picker = window.showOpenFilePicker(frameOpt);
    } catch (errWide) {
      try {
        picker = window.showOpenFilePicker({
          id: 'jsm-ortho-frame',
          startIn: 'downloads',
          multiple: false,
          types: narrow
        });
      } catch (errNarrow) {
        picker = null;
      }
    }
  }
  if (!picker) {
    photoOrthoBrowseFileInput();
    return;
  }
  Promise.resolve(picker).then(function(handles) {
    var handle = handles && handles[0];
    if (!handle || typeof handle.getFile !== 'function') return null;
    photoOrthoProgress(true, mediaTr('media.ortho.reading'));
    return handle.getFile();
  }).then(function(file) {
    if (!file || !photoOrthoBrowseTarget) {
      photoOrthoProgress(false);
      return;
    }
    var target = photoOrthoBrowseTarget;
    if (target.date) photoOrthoEnsureCompareLive(target.date);
    photoOrthoCommitDrop(target.set, [file], target.slot);
  }).catch(function(err) {
    photoOrthoProgress(false);
    if (err && err.name === 'AbortError') return;
  });
}

function photoOrthoPickFolder(setKey, date) {
  photoOrthoFolderTarget = photoOrthoIsSetKey(setKey) ? setKey : 'before';
  photoOrthoFolderDate = String(date || '');
  if (typeof window.showDirectoryPicker === 'function') {
    window.showDirectoryPicker({ id: 'jsm-ortho-folder' }).then(function(dir) {
      photoOrthoSaveBrowseDir(dir);
      if (photoOrthoFolderDate) photoOrthoEnsureCompareLive(photoOrthoFolderDate);
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
  if (photoOrthoFolderDate) photoOrthoEnsureCompareLive(photoOrthoFolderDate);
  photoOrthoPlaceFiles(photoOrthoFolderTarget, files);
}

function photoOrthoFillSittingSelects() {
  var groups = photoVisitGroups((photoAllRecords || []).filter(function(x) {
    return photoOrthoIsImage(x) && !photoIsOrthoSidecar(x) && photoVisitKey(x);
  }));
  ['photoOrthoSitBefore', 'photoOrthoSitAfter', 'photoOrthoSitProgress'].forEach(function(id) {
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

function photoOrthoCountSlots(map, view) {
  var bag = (view && view.slots) || {};
  var n = 0;
  var keys = (view && photoOrthoInputMode(map, view.key) === 'composite')
    ? ['composite']
    : PHOTO_ORTHO_SLOTS.map(function(s) { return s[0]; });
  keys.forEach(function(slot) {
    var rec = photoOrthoFind(bag[slot]);
    if (rec && photoOrthoIsImage(rec)) n++;
  });
  return n;
}

function photoOrthoFilledCount(map, setKey) {
  var bag = (map && map[setKey]) || {};
  if (photoOrthoInputMode(map, setKey) === 'composite') {
    var crec = photoOrthoFind(bag.composite);
    return (crec && photoOrthoIsImage(crec)) ? 1 : 0;
  }
  var n = 0;
  PHOTO_ORTHO_SLOTS.forEach(function(slot) {
    var rec = photoOrthoFind(bag[slot[0]]);
    if (rec && photoOrthoIsImage(rec)) n++;
  });
  return n;
}

function photoOrthoFolderSetBtnHtml(setKey, date) {
  return '<button type="button" class="xray-btn ortho-set-folder" data-ortho-folder="1"' +
    ' data-set="' + esc(setKey) + '"' +
    (date ? ' data-compare-date="' + esc(date) + '"' : '') + '>' +
    esc(mediaTr('media.ortho.folderLoad')) + '</button>';
}

function photoOrthoModeToggleHtml(setKey, mode) {
  function btn(val, labelKey) {
    return '<button type="button" class="ortho-mode-btn' + (mode === val ? ' is-on' : '') +
      '" data-ortho-mode="' + val + '" data-set="' + esc(setKey) + '">' +
      esc(mediaTr(labelKey)) + '</button>';
  }
  return '<div class="ortho-input-toggle" role="group">' +
    btn('tiles', 'media.ortho.modeTiles') +
    btn('composite', 'media.ortho.modeComp') +
    '</div>';
}

function photoOrthoCompositeTileHtml(setKey, photoId, xf) {
  var label = mediaTr('media.ortho.compTile');
  var rec = photoId ? photoOrthoFind(photoId) : null;
  var src = rec && photoOrthoIsImage(rec) ? (photoDisplayUrl(rec) || photoBareUrl(rec)) : '';
  if (photoId && src) {
    var dateStr = rec.taken_date
      ? (typeof formatDobDisplay === 'function' ? formatDobDisplay(String(rec.taken_date).slice(0, 10)) : String(rec.taken_date).slice(0, 10))
      : '';
    var css = photoOrthoXfCss(xf);
    return '<div class="ortho-tile ortho-comp-tile is-filled" draggable="true"' +
      ' data-set="' + esc(setKey) + '" data-slot="composite"' +
      ' data-photo="' + esc(photoId) + '" title="' + esc(label) + '">' +
      '<img alt="' + esc(label) + '" src="' + esc(src) + '"' +
      (css ? ' style="transform:' + esc(css) + '"' : '') + '>' +
      '<span class="ortho-tile-name">' + esc(label) +
      (dateStr ? '<span class="ortho-tile-date">' + esc(dateStr) + '</span>' : '') +
      '</span>' +
      '<button type="button" class="ortho-edit-btn ortho-tile-edit" data-ortho-edit="1"' +
      ' data-set="' + esc(setKey) + '" data-slot="composite"' +
      ' aria-label="' + esc(mediaTr('media.ortho.edit')) + '">✎</button>' +
      photoOrthoBrowseBtnHtml(setKey, 'composite') +
      '</div>';
  }
  var missing = photoId && !src ? '<span class="ortho-tile-miss">' + esc(mediaTr('media.ortho.missing')) + '</span>' : '';
  return '<div class="ortho-tile ortho-comp-tile is-empty" role="button" tabindex="0"' +
    ' data-set="' + esc(setKey) + '" data-slot="composite">' +
    '<span class="ortho-tile-name">' + esc(label) + '</span>' +
    '<span class="ortho-tile-add">' + esc(mediaTr('media.ortho.compHint')) + '</span>' +
    photoOrthoBrowseBtnHtml(setKey, 'composite') +
    missing +
    '</div>';
}

function photoOrthoTileHtml(setKey, slotKey, labelKey, photoId, xf, date) {
  var label = mediaTr(labelKey);
  var rec = photoId ? photoOrthoFind(photoId) : null;
  var src = rec && photoOrthoIsImage(rec) ? (photoDisplayUrl(rec) || photoBareUrl(rec)) : '';
  if (photoId && src) {
    var dateStr = rec.taken_date
      ? (typeof formatDobDisplay === 'function' ? formatDobDisplay(String(rec.taken_date).slice(0, 10)) : String(rec.taken_date).slice(0, 10))
      : '';
    var css = photoOrthoXfCss(xf);
    return '<div class="ortho-tile is-filled" draggable="true"' +
      ' data-set="' + esc(setKey) + '" data-slot="' + esc(slotKey) + '"' +
      (date ? ' data-compare-date="' + esc(date) + '"' : '') +
      ' data-photo="' + esc(photoId) + '" title="' + esc(label) + '">' +
      '<img alt="' + esc(label) + '" src="' + esc(src) + '"' +
      (css ? ' style="transform:' + esc(css) + '"' : '') + '>' +
      '<span class="ortho-tile-name">' + esc(label) +
      (dateStr ? '<span class="ortho-tile-date">' + esc(dateStr) + '</span>' : '') +
      '</span>' +
      '<button type="button" class="ortho-edit-btn ortho-tile-edit" data-ortho-edit="1"' +
      ' data-set="' + esc(setKey) + '" data-slot="' + esc(slotKey) + '"' +
      ' aria-label="' + esc(mediaTr('media.ortho.edit')) + '">✎</button>' +
      photoOrthoBrowseBtnHtml(setKey, slotKey, date) +
      '</div>';
  }
  var hint = slotKey === 'extra' ? mediaTr('media.ortho.extraHint') : mediaTr('media.ortho.add');
  var missing = photoId && !src ? '<span class="ortho-tile-miss">' + esc(mediaTr('media.ortho.missing')) + '</span>' : '';
  return '<div class="ortho-tile is-empty" role="button" tabindex="0"' +
    ' data-set="' + esc(setKey) + '" data-slot="' + esc(slotKey) + '"' +
    (date ? ' data-compare-date="' + esc(date) + '"' : '') + '>' +
    '<span class="ortho-tile-name">' + esc(label) + '</span>' +
    '<span class="ortho-tile-add">' + esc(hint) + '</span>' +
    photoOrthoBrowseBtnHtml(setKey, slotKey, date) +
    missing +
    '</div>';
}

function photoOrthoHealMap(map) {
  if (!map) return map;
  var dirty = false;
  photoOrthoKnownSets().forEach(function(setKey) {
    var bag = map[setKey];
    if (!bag) return;
    Object.keys(bag).forEach(function(slot) {
      var ok = photoOrthoResolveId(bag[slot]);
      if (ok && String(ok) !== String(bag[slot])) {
        bag[slot] = ok;
        dirty = true;
      }
    });
  });
  if (dirty) photoOrthoSave(map);
  return map;
}

function photoOrthoSyncLayoutTools(sets) {
  var showB = sets.indexOf('before') >= 0;
  var showA = sets.indexOf('after') >= 0;
  var showP = sets.indexOf('progress') >= 0;
  function vis(id, on) {
    var el = g(id);
    if (el) el.hidden = !on;
  }
  vis('photoOrthoSitBefore', false);
  vis('photoOrthoSitAfter', false);
  vis('photoOrthoSitProgress', false);
  vis('photoOrthoCopyBtn', showB && showA);
  vis('photoOrthoPlaceBeforeBtn', showB);
  vis('photoOrthoPlaceAfterBtn', showA);
  vis('photoOrthoPlaceProgressBtn', showP);
  vis('photoOrthoFolderBeforeBtn', showB);
  vis('photoOrthoFolderAfterBtn', showA);
  vis('photoOrthoFolderProgressBtn', showP);
}

function photoOrthoRecordCatLabel(cat) {
  if (cat === 'final') return mediaTr('media.ortho.catFinal');
  if (cat === 'progress') return mediaTr('media.ortho.catProgress');
  return mediaTr('media.ortho.catInitial');
}

var photoOrthoVisitCache = null;
var photoOrthoVisitCachePid = '';
var photoOrthoVisitReq = 0;

function photoOrthoVisitsReady() {
  return Array.isArray(photoOrthoVisitCache) && photoOrthoVisitCachePid === String(photoPatientId || '');
}

function photoOrthoVisitList() {
  var rows = photoOrthoVisitCache || [];
  var tag = '';
  try { tag = photoOrthoWorkingClinicTag(); } catch (e) { tag = ''; }
  if (!tag) return rows.slice();
  return rows.filter(function(a) {
    return a && (!a.clinic_tag || String(a.clinic_tag) === tag);
  });
}

function photoOrthoVisitById(id) {
  if (!id) return null;
  var rows = photoOrthoVisitCache || [];
  var i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i] && String(rows[i].id) === String(id)) return rows[i];
  }
  return null;
}

function photoOrthoVisitForDate(date) {
  date = String(date || '').slice(0, 10);
  if (!date) return null;
  var rows = photoOrthoVisitList();
  var i;
  for (i = 0; i < rows.length; i++) {
    if (String(rows[i].date || '').slice(0, 10) === date) return rows[i];
  }
  return null;
}

function photoOrthoWireMeta(meta) {
  if (!meta || !photoOrthoVisitsReady()) return false;
  var date = String(meta.date || '').slice(0, 10);
  var current = meta.appointmentId ? photoOrthoVisitById(meta.appointmentId) : null;
  if (current && String(current.date || '').slice(0, 10) === date) return false;
  var match = photoOrthoVisitForDate(date);
  var want = match ? String(match.id) : (current ? String(meta.appointmentId || '') : '');
  if (!match && current && String(current.date || '').slice(0, 10) !== date) want = '';
  if (String(meta.appointmentId || '') === want) return false;
  meta.appointmentId = want;
  return true;
}

function photoOrthoApplyVisitMatches(map) {
  if (!map || !photoOrthoVisitsReady()) return false;
  var changed = false;
  if (map.setMeta) {
    if (photoOrthoWireMeta(map.setMeta.before)) changed = true;
    if (photoOrthoWireMeta(map.setMeta.after)) changed = true;
  }
  var i;
  for (i = 0; i < (map.progressSets || []).length; i++) {
    if (photoOrthoWireMeta(map.progressSets[i])) changed = true;
  }
  if (changed) photoOrthoSave(map);
  return changed;
}

function photoOrthoEnsureVisitCache() {
  var pid = String(photoPatientId || '');
  if (photoOrthoVisitsReady()) return;
  var req = ++photoOrthoVisitReq;
  photoOrthoLoadVisitRows(pid).then(function(rows) {
    if (req !== photoOrthoVisitReq) return;
    if (photoOrthoVisitsReady()) return;
    photoOrthoVisitCachePid = pid;
    photoOrthoVisitCache = rows || [];
    var panel = g('photoOrthoPanel');
    if (!panel || panel.hasAttribute('hidden')) return;
    var map = photoOrthoLoad();
    photoOrthoApplyVisitMatches(map);
    photoOrthoPaintVisitNav(photoOrthoLoad());
  }, function() {
    if (req !== photoOrthoVisitReq) return;
    photoOrthoVisitCachePid = pid;
    photoOrthoVisitCache = [];
  });
}

function photoOrthoProgressByDate(map, date) {
  date = String(date || '');
  var i;
  for (i = 0; i < (map.progressSets || []).length; i++) {
    if (String(map.progressSets[i].date || '') === date) return map.progressSets[i];
  }
  return null;
}

function photoOrthoActiveVisitDate(map) {
  map = map || photoOrthoLoad();
  if (map.focus === 'before') return (map.setMeta && map.setMeta.before && map.setMeta.before.date) || '';
  if (map.focus === 'after') return (map.setMeta && map.setMeta.after && map.setMeta.after.date) || '';
  if (map.focus === 'progress') return String(map.progressDate || '').slice(0, 10);
  return '';
}

function photoOrthoSetForDate(map, date) {
  date = String(date || '').slice(0, 10);
  if (!date) return null;
  if (map.setMeta && map.setMeta.before && String(map.setMeta.before.date || '') === date) return { key: 'before', category: 'initial' };
  if (map.setMeta && map.setMeta.after && String(map.setMeta.after.date || '') === date) return { key: 'after', category: 'final' };
  if (photoOrthoProgressByDate(map, date)) return { key: 'progress', category: 'progress' };
  return null;
}

function photoOrthoNavVisitOptions(map) {
  var byValue = {};
  function put(value, label) {
    value = String(value || '');
    if (!value || byValue[value]) return;
    byValue[value] = { value: value, label: label || value };
  }
  function dateLabel(date) {
    date = String(date || '').slice(0, 10);
    if (!date) return '';
    if (typeof fmtDateLong === 'function') return fmtDateLong(date);
    return date;
  }
  photoOrthoVisitList().forEach(function(a) {
    if (!a || !a.date) return;
    var date = String(a.date).slice(0, 10);
    put(date, dateLabel(date));
  });
  function mark(date) {
    date = String(date || '').slice(0, 10);
    if (!date) return;
    put(date, dateLabel(date));
  }
  if (map.setMeta && map.setMeta.before) mark(map.setMeta.before.date);
  if (map.setMeta && map.setMeta.after) mark(map.setMeta.after.date);
  (map.progressSets || []).forEach(function(set) {
    if (set && set.date) mark(set.date);
    else if (set && set.id) put('id:' + set.id, photoOrthoRecordCatLabel('progress'));
  });
  return Object.keys(byValue).map(function(k) { return byValue[k]; }).sort(function(a, b) {
    return String(a.value) < String(b.value) ? 1 : (String(a.value) > String(b.value) ? -1 : 0);
  });
}

function photoOrthoWireAppointment(meta, date) {
  if (!meta) return;
  var visit = photoOrthoVisitForDate(date);
  if (visit && !meta.appointmentId) meta.appointmentId = String(visit.id);
}

function photoOrthoSelectVisit(value) {
  value = String(value || '');
  if (!value) {
    photoOrthoShowPair();
    return;
  }
  if (value.indexOf('id:') === 0) {
    photoOrthoLoadRecord(value.slice(3));
    return;
  }
  var date = value.slice(0, 10);
  var map = photoOrthoLoad();
  photoOrthoWriteProgressSnapshot(map);
  var found = photoOrthoSetForDate(map, date);
  if (!found) {
    photoOrthoSave(map);
    photoOrthoOpenProgressDate(date);
    map = photoOrthoLoad();
    var created = photoOrthoProgressByDate(map, date);
    photoOrthoWireAppointment(created, date);
    photoOrthoSave(map);
    photoOrthoRender();
    return;
  }
  if (found.key === 'progress') {
    photoOrthoSave(map);
    photoOrthoOpenProgressDate(date);
    map = photoOrthoLoad();
    photoOrthoWireAppointment(photoOrthoProgressByDate(map, date), date);
    photoOrthoSave(map);
    photoOrthoRender();
    return;
  }
  photoOrthoWireAppointment(map.setMeta[found.key], date);
  map.focus = found.key;
  map.activeRecordId = map.setMeta[found.key].id || '';
  photoOrthoSave(map);
  photoOrthoRender();
}

function photoOrthoStepVisit(dir) {
  var sel = g('photoOrthoVisitSelect');
  if (!sel || !sel.options || sel.options.length < 2) return;
  var idx = sel.selectedIndex;
  if (idx < 0) idx = 0;
  var next = idx + (dir < 0 ? -1 : 1);
  if (next < 1) next = 1;
  if (next >= sel.options.length) next = sel.options.length - 1;
  if (!sel.options[next] || sel.options[next].value === sel.value) return;
  photoOrthoSelectVisit(sel.options[next].value);
}

function photoOrthoClearExclusive(map, key) {
  map[key] = {};
  if (!map.xf) map.xf = {};
  map.xf[key] = {};
  if (map.setMeta && map.setMeta[key]) {
    map.setMeta[key].date = '';
    map.setMeta[key].appointmentId = '';
  }
}

function photoOrthoDemoteExclusive(map, key, keepDate) {
  var meta = map.setMeta && map.setMeta[key];
  if (!meta) return;
  var oldDate = String(meta.date || '').slice(0, 10);
  if (oldDate === String(keepDate || '')) return;
  if (!photoOrthoBagHasContent(map[key]) && !oldDate) return;
  var dest = photoOrthoProgressByDate(map, oldDate);
  if (!dest) {
    dest = { id: photoOrthoNewSetId(), date: oldDate, remarks: meta.remarks || '', appointmentId: meta.appointmentId || '', slots: {}, xf: {} };
    map.progressSets.push(dest);
  }
  if (!photoOrthoBagHasContent(dest.slots)) {
    dest.slots = photoOrthoCopyBag(map[key]);
    dest.xf = photoOrthoCopyBag(map.xf && map.xf[key]);
  }
  if (!dest.appointmentId) dest.appointmentId = meta.appointmentId || '';
  photoOrthoClearExclusive(map, key);
}

function photoOrthoRemoveProgressDate(map, date) {
  date = String(date || '');
  var next = '';
  map.progressSets = (map.progressSets || []).filter(function(set) {
    var keep = String(set.date || '') !== date;
    if (keep && !next && set.date) next = set.date;
    return keep;
  });
  if (String(map.progressDate || '') !== date) return;
  var hit = next ? photoOrthoProgressByDate(map, next) : null;
  map.progressDate = next;
  map.progress = hit ? photoOrthoCopyBag(hit.slots) : {};
  if (!map.xf) map.xf = {};
  map.xf.progress = hit ? photoOrthoCopyBag(hit.xf) : {};
}

function photoOrthoSetVisitCategory(cat) {
  cat = (cat === 'final' || cat === 'progress') ? cat : 'initial';
  var map = photoOrthoLoad();
  photoOrthoWriteProgressSnapshot(map);
  var date = photoOrthoActiveVisitDate(map);
  if (!date) return;
  var found = photoOrthoSetForDate(map, date);
  var curKey = found ? found.key : (map.focus || 'progress');
  if (!map[curKey]) map[curKey] = {};
  var slots = photoOrthoCopyBag(map[curKey]);
  var xf = photoOrthoCopyBag(map.xf && map.xf[curKey]);
  var appt = '';
  if (curKey === 'before' || curKey === 'after') appt = (map.setMeta[curKey] && map.setMeta[curKey].appointmentId) || '';
  else {
    var curSet = photoOrthoProgressByDate(map, date);
    appt = (curSet && curSet.appointmentId) || '';
  }
  if (!appt) {
    var visit = photoOrthoVisitForDate(date);
    appt = visit ? String(visit.id) : '';
  }
  if (cat === 'initial' || cat === 'final') {
    var key = cat === 'final' ? 'after' : 'before';
    if (curKey !== key) photoOrthoDemoteExclusive(map, key, date);
    if (curKey === 'progress') photoOrthoRemoveProgressDate(map, date);
    if (curKey === 'before' || curKey === 'after') {
      if (curKey !== key) photoOrthoClearExclusive(map, curKey);
    }
    map[key] = slots;
    if (!map.xf) map.xf = {};
    map.xf[key] = xf;
    if (!map.setMeta[key]) map.setMeta[key] = { id: '', date: '', remarks: '', appointmentId: '' };
    map.setMeta[key].date = date;
    map.setMeta[key].appointmentId = appt;
    map.focus = key;
    map.activeRecordId = map.setMeta[key].id || '';
  } else {
    var hit = photoOrthoProgressByDate(map, date);
    if (!hit) {
      hit = { id: photoOrthoNewSetId(), date: date, remarks: '', appointmentId: appt, slots: {}, xf: {} };
      map.progressSets.push(hit);
    }
    hit.slots = slots;
    hit.xf = xf;
    hit.appointmentId = appt || hit.appointmentId || '';
    if (curKey === 'before' || curKey === 'after') photoOrthoClearExclusive(map, curKey);
    map.progressDate = date;
    map.progress = photoOrthoCopyBag(slots);
    if (!map.xf) map.xf = {};
    map.xf.progress = photoOrthoCopyBag(xf);
    map.focus = 'progress';
    map.activeRecordId = hit.id;
  }
  photoOrthoSave(map);
  photoOrthoRender();
}

function photoOrthoPaintVisitNav(map) {
  var sel = g('photoOrthoVisitSelect');
  if (!sel) return;
  map = map || photoOrthoLoad();
  var nav = g('photoOrthoVisitNav');
  if (nav) nav.classList.toggle('is-compare', !map.focus);
  var cmpBtn = g('photoOrthoCompareBtn');
  if (cmpBtn) cmpBtn.classList.toggle('is-on', !map.focus);
  photoOrthoEnsureVisitCache();
  var current = photoOrthoActiveVisitDate(map);
  var options = photoOrthoNavVisitOptions(map);
  var html = '<option value="">' + esc(mediaTr('media.ortho.visitPh')) + '</option>';
  options.forEach(function(o) {
    html += '<option value="' + esc(o.value) + '"' + (o.value === current ? ' selected' : '') + '>' + esc(o.label) + '</option>';
  });
  sel.innerHTML = html;
  var cat = map.focus === 'after' ? 'final' : (map.focus === 'progress' ? 'progress' : (map.focus === 'before' ? 'initial' : ''));
  var picks = document.querySelectorAll('[data-ortho-cat]');
  var i;
  for (i = 0; i < picks.length; i++) {
    picks[i].classList.toggle('is-on', picks[i].getAttribute('data-ortho-cat') === cat);
  }
}

function photoOrthoRecordShell(meta, category, focus, token) {
  meta = meta || {};
  return {
    token: meta.id || token,
    id: meta.id || '',
    date: meta.date || '',
    category: category,
    remarks: meta.remarks || '',
    appointmentId: meta.appointmentId || '',
    focus: focus
  };
}

function photoOrthoRecordRows(map) {
  map = map || photoOrthoLoad();
  var before = (map.setMeta && map.setMeta.before) || {};
  var after = (map.setMeta && map.setMeta.after) || {};
  var rows = [photoOrthoRecordShell(before, 'initial', 'before', 'before')];
  var progress = [];
  var seen = {};
  (map.progressSets || []).forEach(function(set) {
    if (!set || !set.id || seen[set.id]) return;
    seen[set.id] = true;
    progress.push(photoOrthoRecordShell(set, 'progress', 'progress', 'progress-draft'));
  });
  if (!progress.length) {
    progress.push(photoOrthoRecordShell(null, 'progress', 'progress', 'progress-draft'));
  }
  progress.sort(function(a, b) {
    return String(a.date || '').localeCompare(String(b.date || ''));
  });
  rows = rows.concat(progress);
  rows.push(photoOrthoRecordShell(after, 'final', 'after', 'after'));
  return rows;
}

function photoOrthoResolveRecord(map, token) {
  token = String(token || '');
  if (!map.setMeta) return null;
  if (token === 'before' || token === 'after') {
    if (!map.setMeta[token]) map.setMeta[token] = { id: '', date: '', remarks: '', appointmentId: '' };
    if (!map.setMeta[token].id) map.setMeta[token].id = photoOrthoNewSetId();
    return map.setMeta[token];
  }
  if (token === 'progress-draft') {
    if (!map.progressSets.length) {
      map.progressSets.push({ id: photoOrthoNewSetId(), date: '', remarks: '', appointmentId: '', slots: {}, xf: {} });
    }
    return map.progressSets[0];
  }
  return photoOrthoRecordById(map, token);
}

function photoOrthoRecordIsProgress(map, hit) {
  var i;
  for (i = 0; i < (map.progressSets || []).length; i++) {
    if (map.progressSets[i] === hit) return true;
  }
  return false;
}

function photoOrthoLoadRecord(id) {
  var map = photoOrthoLoad();
  photoOrthoWriteProgressSnapshot(map);
  var hit = photoOrthoResolveRecord(map, id);
  if (!hit) return;
  if (hit === map.setMeta.before) {
    map.focus = 'before';
    map.activeRecordId = hit.id;
  } else if (hit === map.setMeta.after) {
    map.focus = 'after';
    map.activeRecordId = hit.id;
  } else {
    map.progressDate = hit.date || '';
    map.progress = photoOrthoCopyBag(hit.slots);
    if (!map.xf) map.xf = {};
    map.xf.progress = photoOrthoCopyBag(hit.xf);
    map.focus = 'progress';
    map.activeRecordId = hit.id;
  }
  photoOrthoSave(map);
  photoOrthoRender();
  var show = g('photoOrthoShow');
  if (show && !show.hasAttribute('hidden')) photoOrthoSlidePaint();
}

function photoOrthoOpenProgressDate(date) {
  date = String(date || '').slice(0, 10);
  if (!date) return;
  var map = photoOrthoLoad();
  photoOrthoWriteProgressSnapshot(map);
  var hit = null;
  var i;
  for (i = 0; i < map.progressSets.length; i++) {
    if (map.progressSets[i].date === date) { hit = map.progressSets[i]; break; }
  }
  if (!hit) {
    hit = { id: photoOrthoNewSetId(), date: date, remarks: '', appointmentId: '', slots: {}, xf: {} };
    map.progressSets.push(hit);
  }
  map.progressDate = date;
  map.progress = photoOrthoCopyBag(hit.slots);
  if (!map.xf) map.xf = {};
  map.xf.progress = photoOrthoCopyBag(hit.xf);
  map.focus = 'progress';
  map.activeRecordId = hit.id;
  photoOrthoSave(map);
  photoOrthoRender();
}

function photoOrthoShowPair() {
  var map = photoOrthoLoad();
  photoOrthoWriteProgressSnapshot(map);
  map.focus = '';
  map.activeRecordId = '';
  photoOrthoSave(map);
  photoOrthoRender();
}

function photoOrthoResolveVisitView(map, date, fallbackKey) {
  date = String(date || '').slice(0, 10);
  fallbackKey = (fallbackKey === 'after' || fallbackKey === 'progress') ? fallbackKey : 'before';
  if (date) {
    var found = photoOrthoSetForDate(map, date);
    if (found && (found.key === 'before' || found.key === 'after')) {
      return {
        key: found.key,
        date: date,
        slots: map[found.key] || {},
        xf: (map.xf && map.xf[found.key]) || {},
        category: found.category
      };
    }
    var prog = photoOrthoProgressByDate(map, date);
    if (prog || (found && found.key === 'progress')) {
      var live = String(map.progressDate || '') === date;
      return {
        key: 'progress',
        date: date,
        slots: live ? (map.progress || {}) : ((prog && prog.slots) || {}),
        xf: live ? ((map.xf && map.xf.progress) || {}) : ((prog && prog.xf) || {}),
        category: 'progress'
      };
    }
    return { key: 'progress', date: date, slots: {}, xf: {}, category: '' };
  }
  var meta = map.setMeta && map.setMeta[fallbackKey];
  return {
    key: fallbackKey,
    date: (meta && meta.date) || '',
    slots: map[fallbackKey] || {},
    xf: (map.xf && map.xf[fallbackKey]) || {},
    category: fallbackKey === 'after' ? 'final' : (fallbackKey === 'progress' ? 'progress' : 'initial')
  };
}

function photoOrthoComparePair(map) {
  map = map || photoOrthoLoad();
  if (map.focus) return null;
  var cat = photoOrthoFilterCat();
  if (cat === 'before' || cat === 'after' || cat === 'progress') return null;
  return {
    left: photoOrthoResolveVisitView(map, map.compareLeft, 'before'),
    right: photoOrthoResolveVisitView(map, map.compareRight, 'after')
  };
}

function photoOrthoCompareCaption(view) {
  if (!view) return '';
  var cat = view.category ? photoOrthoRecordCatLabel(view.category) : photoOrthoSetLabel(view.key);
  var date = String(view.date || '').slice(0, 10);
  var label = date && typeof fmtDateLong === 'function' ? fmtDateLong(date) : date;
  return label ? (cat + ' · ' + label) : cat;
}

function photoOrthoEnsureCompareLive(date) {
  date = String(date || '').slice(0, 10);
  if (!date) return;
  var map = photoOrthoLoad();
  var found = photoOrthoSetForDate(map, date);
  if (found && (found.key === 'before' || found.key === 'after')) return;
  if (found && found.key === 'progress' && String(map.progressDate || '') === date) return;
  photoOrthoWriteProgressSnapshot(map);
  var hit = photoOrthoProgressByDate(map, date);
  if (!hit) {
    hit = { id: photoOrthoNewSetId(), date: date, remarks: '', appointmentId: '', slots: {}, xf: {} };
    var visit = photoOrthoVisitForDate(date);
    if (visit) hit.appointmentId = String(visit.id);
    map.progressSets.push(hit);
  }
  map.progressDate = date;
  map.progress = photoOrthoCopyBag(hit.slots);
  if (!map.xf) map.xf = {};
  map.xf.progress = photoOrthoCopyBag(hit.xf);
  map.focus = '';
  map.activeRecordId = hit.id;
  photoOrthoSave(map);
}

function photoOrthoComparePick(side, value) {
  var map = photoOrthoLoad();
  photoOrthoWriteProgressSnapshot(map);
  value = String(value || '');
  if (value.indexOf('id:') === 0) {
    photoOrthoLoadRecord(value.slice(3));
    return;
  }
  var date = value.slice(0, 10);
  if (side === 'right') map.compareRight = date;
  else map.compareLeft = date;
  map.focus = '';
  photoOrthoSave(map);
  photoOrthoRender();
  var show = g('photoOrthoShow');
  if (show && !show.hasAttribute('hidden')) photoOrthoSlidePaint();
}

function photoOrthoToggleCompare() {
  var map = photoOrthoLoad();
  if (!map.focus) {
    var back = map.compareLeft || (map.setMeta && map.setMeta.before && map.setMeta.before.date) || '';
    if (back) photoOrthoSelectVisit(back);
    else {
      map.focus = 'before';
      photoOrthoSave(map);
      photoOrthoRender();
    }
    return;
  }
  photoOrthoWriteProgressSnapshot(map);
  var current = photoOrthoActiveVisitDate(map);
  if (!map.compareLeft) map.compareLeft = current || (map.setMeta && map.setMeta.before && map.setMeta.before.date) || '';
  if (!map.compareRight || map.compareRight === map.compareLeft) {
    var alt = (map.setMeta && map.setMeta.after && map.setMeta.after.date) || '';
    if (!alt || alt === map.compareLeft) alt = (map.setMeta && map.setMeta.before && map.setMeta.before.date) || '';
    if (!alt || alt === map.compareLeft) alt = '';
    map.compareRight = alt;
  }
  map.focus = '';
  photoOrthoSave(map);
  photoOrthoRender();
}

function photoOrthoCompareSelectHtml(side, selected) {
  var options = photoOrthoNavVisitOptions(photoOrthoLoad());
  var html = '<select class="xray-filter-sel ortho-compare-visit" data-compare-side="' + esc(side) + '">';
  html += '<option value="">' + esc(mediaTr('media.ortho.visitPh')) + '</option>';
  options.forEach(function(o) {
    html += '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>';
  });
  html += '</select>';
  return html;
}

function photoOrthoCompareSectionHtml(map, side, view) {
  var mode = photoOrthoInputMode(map, view.key);
  var date = view.date || '';
  var html = '<section class="ortho-set' + (mode === 'composite' ? ' is-composite' : '') + '" data-set="' + esc(view.key) + '"' +
    (date ? ' data-compare-date="' + esc(date) + '"' : '') + '>';
  html += '<div class="ortho-set-head">';
  html += '<div class="ortho-compare-nav">';
  html += photoOrthoCompareSelectHtml(side, date);
  if (view.category) html += '<span class="ortho-compare-cat">' + esc(photoOrthoRecordCatLabel(view.category)) + '</span>';
  html += '</div><div class="ortho-set-actions">';
  if (mode !== 'composite') html += photoOrthoFolderSetBtnHtml(view.key, date);
  html += photoOrthoModeToggleHtml(view.key, mode);
  html += '</div></div>';
  var xfWrap = { xf: {} };
  xfWrap.xf[view.key] = view.xf || {};
  if (mode === 'composite') {
    html += photoOrthoCompositeTileHtml(view.key, (view.slots && view.slots.composite) || '', photoOrthoXfGet(xfWrap, view.key, 'composite'));
  } else {
    html += '<div class="ortho-set-grid">';
    PHOTO_ORTHO_SLOTS.forEach(function(slot) {
      html += photoOrthoTileHtml(view.key, slot[0], slot[1], (view.slots && view.slots[slot[0]]) || '', photoOrthoXfGet(xfWrap, view.key, slot[0]), date);
    });
    html += '</div>';
  }
  html += '</section>';
  return html;
}

function photoOrthoRecordById(map, id) {
  var sid = String(id || '');
  if (map.setMeta && map.setMeta.before && map.setMeta.before.id === sid) return map.setMeta.before;
  if (map.setMeta && map.setMeta.after && map.setMeta.after.id === sid) return map.setMeta.after;
  var i;
  for (i = 0; i < (map.progressSets || []).length; i++) {
    if (map.progressSets[i].id === sid) return map.progressSets[i];
  }
  return null;
}

function photoOrthoRecordRemark(id, text) {
  var map = photoOrthoLoad();
  var hit = photoOrthoResolveRecord(map, id);
  if (!hit) return;
  hit.remarks = String(text || '');
  photoOrthoSave(map);
}

function photoOrthoRecordDate(id, date) {
  date = String(date || '').slice(0, 10);
  var map = photoOrthoLoad();
  var hit = photoOrthoResolveRecord(map, id);
  if (!hit) return;
  if (photoOrthoRecordIsProgress(map, hit)) {
    var i;
    for (i = 0; i < map.progressSets.length; i++) {
      if (map.progressSets[i] !== hit && String(map.progressSets[i].date || '') === date) return;
    }
    if (map.activeRecordId === hit.id) map.progressDate = date;
  }
  hit.date = date;
  var match = photoOrthoVisitForDate(date);
  hit.appointmentId = match ? String(match.id) : '';
  photoOrthoSave(map);
  photoOrthoRender();
}

function photoOrthoRecordVisit(id, appointmentId) {
  var map = photoOrthoLoad();
  var hit = photoOrthoResolveRecord(map, id);
  if (!hit) return;
  appointmentId = String(appointmentId || '');
  var visit = appointmentId ? photoOrthoVisitById(appointmentId) : null;
  var date = visit ? String(visit.date || '').slice(0, 10) : '';
  if (date && photoOrthoRecordIsProgress(map, hit)) {
    var i;
    for (i = 0; i < map.progressSets.length; i++) {
      if (map.progressSets[i] !== hit && String(map.progressSets[i].date || '') === date && date !== String(hit.date || '')) {
        photoOrthoRender();
        return;
      }
    }
  }
  hit.appointmentId = appointmentId;
  if (date) {
    hit.date = date;
    if (photoOrthoRecordIsProgress(map, hit) && map.activeRecordId === hit.id) map.progressDate = date;
  }
  photoOrthoSave(map);
  photoOrthoRender();
}

function photoOrthoVisitChoices(selectedId) {
  var list = photoOrthoVisitList();
  var cur = photoOrthoVisitById(selectedId);
  if (!cur) return list;
  var i;
  for (i = 0; i < list.length; i++) {
    if (list[i] && String(list[i].id) === String(cur.id)) return list;
  }
  return [cur].concat(list);
}

function photoOrthoVisitOptionsHtml(selectedId) {
  var html = '<option value="">' + esc(mediaTr('media.ortho.visitNone')) + '</option>';
  photoOrthoVisitChoices(selectedId).forEach(function(a) {
    if (!a || !a.id) return;
    var id = String(a.id);
    var label = (typeof conMediaApptLabel === 'function') ? conMediaApptLabel(a) : String(a.date || id);
    html += '<option value="' + esc(id) + '"' + (id === String(selectedId || '') ? ' selected' : '') + '>' + esc(label) + '</option>';
  });
  return html;
}

function photoOrthoPaintRecords(map) {
  var body = g('photoOrthoRecordsBody');
  if (!body) return;
  photoOrthoEnsureVisitCache();
  photoOrthoApplyVisitMatches(map);
  var rows = photoOrthoRecordRows(map);
  var html = '<table class="ortho-records-table"><thead><tr>' +
    '<th>' + esc(mediaTr('media.ortho.recId')) + '</th>' +
    '<th>' + esc(mediaTr('media.ortho.recDate')) + '</th>' +
    '<th>' + esc(mediaTr('media.ortho.recCat')) + '</th>' +
    '<th>' + esc(mediaTr('media.ortho.recVisit')) + '</th>' +
    '<th>' + esc(mediaTr('media.ortho.recNote')) + '</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(row) {
    var on = row.id && map.activeRecordId === row.id ? ' is-on' : '';
    html += '<tr class="ortho-record' + on + '" data-record="' + esc(row.token) + '">' +
      '<td class="ortho-record-id">' + esc(row.id || '—') + '</td>' +
      '<td><input type="date" data-record-date="' + esc(row.token) + '" value="' + esc(row.date || '') + '"></td>' +
      '<td>' + esc(photoOrthoRecordCatLabel(row.category)) + '</td>' +
      '<td><select data-record-visit="' + esc(row.token) + '">' + photoOrthoVisitOptionsHtml(row.appointmentId) + '</select></td>' +
      '<td><input type="text" data-record-note="' + esc(row.token) + '" value="' + esc(row.remarks || '') + '"></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  body.innerHTML = html;
}

function photoOrthoRender() {
  var root = g('photoOrthoSets');
  if (!root) return;
  photoOrthoBind();
  var map = photoOrthoHealMap(photoOrthoLoad());
  var sets = photoOrthoVisibleSets();
  var cmp = photoOrthoComparePair(map);
  var html = '';
  if (cmp) {
    html += photoOrthoCompareSectionHtml(map, 'left', cmp.left);
    html += photoOrthoCompareSectionHtml(map, 'right', cmp.right);
  }
  if (!cmp) sets.forEach(function(setKey) {
    var bag = map[setKey] || {};
    var mode = photoOrthoInputMode(map, setKey);
    html += '<section class="ortho-set' + (mode === 'composite' ? ' is-composite' : '') + '" data-set="' + setKey + '">';
    html += '<div class="ortho-set-head">';
    html += '<h3 class="ortho-set-title">' + esc(photoOrthoSetLabel(setKey)) + '</h3>';
    html += '<div class="ortho-set-actions">';
    if (mode !== 'composite') html += photoOrthoFolderSetBtnHtml(setKey);
    html += photoOrthoModeToggleHtml(setKey, mode);
    html += '</div></div>';
    if (mode === 'composite') {
      html += photoOrthoCompositeTileHtml(setKey, bag.composite || '', photoOrthoXfGet(map, setKey, 'composite'));
    } else {
      html += '<div class="ortho-set-grid">';
      PHOTO_ORTHO_SLOTS.forEach(function(slot) {
        html += photoOrthoTileHtml(setKey, slot[0], slot[1], bag[slot[0]] || '', photoOrthoXfGet(map, setKey, slot[0]));
      });
      html += '</div>';
    }
    html += '</section>';
  });
  root.innerHTML = html;
  photoOrthoTileMenuClose();
  root.classList.toggle('is-single', !cmp && sets.length === 1);
  photoOrthoSyncLayoutTools(cmp ? [cmp.left.key, cmp.right.key] : sets);
  var meter = g('photoOrthoMeter');
  photoOrthoFillSittingSelects();
  if (meter) {
    if (cmp) {
      var lMax = photoOrthoInputMode(map, cmp.left.key) === 'composite' ? 1 : PHOTO_ORTHO_SLOTS.length;
      var rMax = photoOrthoInputMode(map, cmp.right.key) === 'composite' ? 1 : PHOTO_ORTHO_SLOTS.length;
      meter.textContent = photoOrthoCompareCaption(cmp.left) + ' ' +
        photoOrthoCountSlots(map, cmp.left) + '/' + lMax + ' · ' +
        photoOrthoCompareCaption(cmp.right) + ' ' +
        photoOrthoCountSlots(map, cmp.right) + '/' + rMax;
    } else if (sets.length === 1) {
      var oneMode = photoOrthoInputMode(map, sets[0]);
      meter.textContent = photoOrthoSetLabel(sets[0]) + ' ' +
        photoOrthoFilledCount(map, sets[0]) + '/' +
        (oneMode === 'composite' ? '1' : PHOTO_ORTHO_SLOTS.length);
    } else {
      var bMax = photoOrthoInputMode(map, 'before') === 'composite' ? 1 : PHOTO_ORTHO_SLOTS.length;
      var aMax = photoOrthoInputMode(map, 'after') === 'composite' ? 1 : PHOTO_ORTHO_SLOTS.length;
      meter.textContent = mediaTrRepl('media.ortho.meter', {
        BEFORE: photoOrthoSetLabel('before'),
        AFTER: photoOrthoSetLabel('after'),
        BN: String(photoOrthoFilledCount(map, 'before')),
        AN: String(photoOrthoFilledCount(map, 'after')),
        M: String(bMax === aMax ? bMax : PHOTO_ORTHO_SLOTS.length)
      });
      if (bMax !== aMax) {
        meter.textContent = photoOrthoSetLabel('before') + ' ' +
          photoOrthoFilledCount(map, 'before') + '/' + bMax + ' · ' +
          photoOrthoSetLabel('after') + ' ' +
          photoOrthoFilledCount(map, 'after') + '/' + aMax;
      }
    }
  }
  photoOrthoPaintVisitNav(map);
}

var photoOrthoMenuTarget = null;

function photoOrthoTileMenuClose() {
  photoOrthoMenuTarget = null;
  var menu = g('photoOrthoTileMenu');
  if (menu) menu.setAttribute('hidden', '');
}

function photoOrthoTileMenuEnsure() {
  var menu = g('photoOrthoTileMenu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'photoOrthoTileMenu';
  menu.className = 'ortho-tile-menu';
  menu.setAttribute('hidden', '');
  document.body.appendChild(menu);
  return menu;
}

function photoOrthoOpenInLightbox(photoId, tool) {
  var rec = photoOrthoFind(photoId);
  if (!rec || typeof openPhotoLightbox !== 'function') return;
  var idx = -1;
  var i;
  for (i = 0; i < (photoFiltered || []).length; i++) {
    if (String(photoFiltered[i].id) === String(photoId)) { idx = i; break; }
  }
  if (idx < 0) {
    photoFiltered = (photoFiltered || []).concat([rec]);
    idx = photoFiltered.length - 1;
  }
  openPhotoLightbox(idx);
  if (tool && typeof photoLbSetTool === 'function') {
    setTimeout(function() { photoLbSetTool(tool); }, 40);
  }
}

function photoOrthoTileAct(act) {
  var t = photoOrthoMenuTarget;
  photoOrthoTileMenuClose();
  if (!t || !t.set || !t.slot) return;
  var map = photoOrthoLoad();
  var xf = photoOrthoXfGet(map, t.set, t.slot);
  if (act === 'flipV') xf.flipV = !xf.flipV;
  else if (act === 'flipH') xf.flipH = !xf.flipH;
  else if (act === 'rotateL') xf.rot = (xf.rot + 270) % 360;
  else if (act === 'rotateR') xf.rot = (xf.rot + 90) % 360;
  else if (act === 'crop') {
    photoOrthoOpenInLightbox(t.photo, 'crop');
    return;
  } else if (act === 'replace') {
    photoOrthoPick(t.set, t.slot);
    return;
  } else if (act === 'delete') {
    photoOrthoPlace(t.set, t.slot, '', null);
    return;
  } else {
    return;
  }
  photoOrthoXfSet(map, t.set, t.slot, xf);
  photoOrthoSave(map);
  photoOrthoRender();
  var show = g('photoOrthoShow');
  if (show && !show.hasAttribute('hidden')) photoOrthoSlidePaint();
}

function photoOrthoTileMenuOpen(btn) {
  var tile = btn && btn.closest ? btn.closest('.ortho-tile') : null;
  if (!tile || !tile.classList.contains('is-filled')) return;
  var menu = photoOrthoTileMenuEnsure();
  var items = [
    ['flipV', '⇅', 'media.ortho.flipV', ''],
    ['flipH', '⇄', 'media.ortho.flipH', ''],
    ['rotateL', '↺', 'media.ortho.rotateL', ''],
    ['rotateR', '↻', 'media.ortho.rotateR', ''],
    ['crop', '⛶', 'media.ortho.crop', 'is-sep'],
    ['replace', '↔', 'media.ortho.replace', ''],
    ['delete', '🗑', 'media.ortho.delete', 'is-danger']
  ];
  menu.innerHTML = items.map(function(row) {
    return '<button type="button" class="ortho-tile-menu-item' + (row[3] ? ' ' + row[3] : '') +
      '" data-ortho-act="' + row[0] + '"><span class="ortho-tile-menu-ico" aria-hidden="true">' +
      row[1] + '</span><span>' + esc(mediaTr(row[2])) + '</span></button>';
  }).join('');
  photoOrthoMenuTarget = {
    set: tile.dataset.set,
    slot: tile.dataset.slot,
    photo: tile.dataset.photo || ''
  };
  menu.onclick = function(e) {
    var item = e.target.closest ? e.target.closest('[data-ortho-act]') : null;
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    photoOrthoTileAct(item.getAttribute('data-ortho-act'));
  };
  menu.removeAttribute('hidden');
  var r = btn.getBoundingClientRect();
  var mw = menu.offsetWidth || 220;
  var mh = menu.offsetHeight || 280;
  var left = r.right + 8;
  var top = r.top;
  if (left + mw > window.innerWidth - 8) left = Math.max(8, r.left - mw - 8);
  if (top + mh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - mh - 8);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

document.addEventListener('mousedown', function(e) {
  var menu = g('photoOrthoTileMenu');
  if (!menu || menu.hasAttribute('hidden')) return;
  if (menu.contains(e.target)) return;
  if (e.target.closest && e.target.closest('[data-ortho-edit]')) return;
  photoOrthoTileMenuClose();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') photoOrthoTileMenuClose();
});

function photoOrthoRenderIfOpen() {
  var panel = g('photoOrthoPanel');
  if (photoOrthoHoldBoard) {
    photoOrthoHoldBoard = false;
    if (panel && !panel.hasAttribute('hidden')) photoOrthoChartPickerSync();
    return;
  }
  if (panel && !panel.hasAttribute('hidden')) photoOrthoRender();
  var show = g('photoOrthoShow');
  if (show && !show.hasAttribute('hidden')) photoOrthoSlidePaint();
  if (panel && !panel.hasAttribute('hidden')) photoOrthoChartPickerSync();
}

function photoOrthoImages() {
  return (photoAllRecords || []).filter(function(rec) {
    return photoOrthoIsImage(rec) && !photoIsOrthoSidecar(rec) && !photoIsDocRec(rec);
  });
}

var photoOrthoChartDismissed = false;

function photoOrthoChartTarget() {
  var sets = photoOrthoVisibleSets();
  var map = photoOrthoLoad();
  var s;
  var i;
  var setKey;
  var slot;
  if (!sets.length) sets = ['before'];
  for (s = 0; s < sets.length; s++) {
    setKey = sets[s];
    if (photoOrthoInputMode(map, setKey) === 'composite') {
      if (!(map[setKey] && map[setKey].composite)) return { set: setKey, slot: 'composite' };
      continue;
    }
    for (i = 0; i < PHOTO_ORTHO_SLOTS.length; i++) {
      slot = PHOTO_ORTHO_SLOTS[i][0];
      if (!(map[setKey] && map[setKey][slot])) return { set: setKey, slot: slot };
    }
  }
  setKey = sets[0];
  return {
    set: setKey,
    slot: photoOrthoInputMode(map, setKey) === 'composite' ? 'composite' : PHOTO_ORTHO_SLOTS[0][0]
  };
}

function photoOrthoChartPickerOpen() {
  var panel = g('photoOrthoPanel');
  if (!panel || panel.hasAttribute('hidden') || photoOrthoChartDismissed) return;
  var target = photoOrthoPickTarget || photoOrthoChartTarget();
  if (target) photoOrthoPick(target.set, target.slot, { quiet: true });
}

function photoOrthoChartPickerSync() {
  var box = g('photoOrthoPick');
  if (photoOrthoChartDismissed || !box || box.hasAttribute('hidden')) return;
  var target = photoOrthoPickTarget || photoOrthoChartTarget();
  if (target) photoOrthoPick(target.set, target.slot, { quiet: true });
}

function photoOrthoPick(setKey, slotKey, opts) {
  opts = opts || {};
  photoOrthoPickTarget = { set: setKey, slot: slotKey };
  photoOrthoMarkAimed(setKey, slotKey);
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
    if (closer) {
      photoOrthoChartDismissed = true;
      photoOrthoPickClose();
      return;
    }
    var btn = e.target.closest ? e.target.closest('.ortho-pick-item, .ortho-pick-remove') : null;
    if (!btn || !photoOrthoPickTarget) return;
    var aimed = photoOrthoPickTarget;
    photoOrthoPlace(aimed.set, aimed.slot, btn.getAttribute('data-id') || '', null);
    photoOrthoPick(aimed.set, aimed.slot, { quiet: true });
  };
  if (!opts.quiet && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
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

function photoOrthoFrameHtml(photoId, xf) {
  var rec = photoId ? photoOrthoFind(photoId) : null;
  var src = rec && photoOrthoIsImage(rec) ? (photoDisplayUrl(rec) || photoBareUrl(rec)) : '';
  if (!src) {
    return '<div class="ortho-show-empty">' + esc(mediaTr('media.ortho.noPhoto')) + '</div>';
  }
  var css = photoOrthoXfCss(xf);
  return '<img alt="" src="' + esc(src) + '" style="width:100%;height:100%;object-fit:contain;' +
    (css ? 'transform:' + esc(css) + ';' : '') + '">';
}

function photoOrthoSlideDate(photoId) {
  var rec = photoId ? photoOrthoFind(photoId) : null;
  if (!rec || !rec.taken_date) return '';
  var d = String(rec.taken_date).slice(0, 10);
  return typeof formatDobDisplay === 'function' ? formatDobDisplay(d) : d;
}

function photoOrthoSlotPhotoId(map, setKey, slotKey) {
  if (!map || !setKey) return '';
  if (photoOrthoInputMode(map, setKey) === 'composite' || slotKey === 'composite') {
    return photoOrthoCompId(map, setKey);
  }
  return (map[setKey] && map[setKey][slotKey]) || '';
}

function photoOrthoSlotHasPhoto(map, slotKey) {
  function ok(id) {
    var rec = id ? photoOrthoFind(id) : null;
    return !!(rec && photoOrthoIsImage(rec) && (photoDisplayUrl(rec) || photoBareUrl(rec)));
  }
  var cmp = photoOrthoComparePair(map);
  if (cmp) {
    var lSlot = photoOrthoInputMode(map, cmp.left.key) === 'composite' ? 'composite' : slotKey;
    var rSlot = photoOrthoInputMode(map, cmp.right.key) === 'composite' ? 'composite' : slotKey;
    return ok((cmp.left.slots || {})[lSlot]) || ok((cmp.right.slots || {})[rSlot]);
  }
  var sets = photoOrthoVisibleSets();
  var i;
  for (i = 0; i < sets.length; i++) {
    if (ok(photoOrthoSlotPhotoId(map, sets[i], slotKey))) return true;
  }
  return false;
}

function photoOrthoSlideSteps() {
  var map = photoOrthoLoad();
  if (photoOrthoAllComposite(map)) return ['composite'];
  var all = PHOTO_ORTHO_SLOTS.map(function(s) { return s[0]; });
  if (!photoOrthoSlideSkipEmpty) return all;
  var filled = all.filter(function(k) { return photoOrthoSlotHasPhoto(map, k); });
  return filled.length ? filled : all;
}

function photoOrthoShowChrome(on) {
  try {
    document.body.classList.toggle('photo-ortho-show-open', !!on);
  } catch (e) { /* ignore */ }
}

function photoOrthoSlideshow() {
  var panel = g('photoOrthoPanel');
  if (panel && panel.hasAttribute('hidden')) photoOrthoToggle(true);
  photoOrthoSlideIdx = 0;
  photoOrthoSlidePaused = false;
  photoOrthoSlideHoldLeft = 0;
  var el = g('photoOrthoShow');
  if (!el) return;
  el.removeAttribute('hidden');
  photoOrthoShowChrome(true);
  photoOrthoSlidePaint();
}

function photoOrthoSlideClose() {
  photoOrthoSlideStopPlay();
  photoOrthoSlidePaused = false;
  photoOrthoSlideHoldLeft = 0;
  photoOrthoSlideHoldUntil = 0;
  var el = g('photoOrthoShow');
  if (el) el.setAttribute('hidden', '');
  photoOrthoShowChrome(false);
}

function photoOrthoSlideBack() {
  photoOrthoSlideClose();
  var sec = g('consultationSection');
  if (sec) sec.style.display = 'block';
  if (typeof switchConTab === 'function') switchConTab('photos');
  else {
    var pane = g('con-photos');
    if (pane) {
      pane.style.display = 'block';
      pane.classList.add('active');
    }
  }
  var main = g('photoMainContent');
  if (main) main.style.display = 'block';
  if (typeof photoOrthoToggle === 'function') photoOrthoToggle(true);
}

function photoSlideBack() {
  if (typeof setPhotoView === 'function') setPhotoView('grid');
}

function photoOrthoSlideSkipChange(on) {
  photoOrthoSlideSkipEmpty = !!on;
  photoOrthoSlideIdx = 0;
  if (photoOrthoSlidePaused) {
    photoOrthoSlideHoldLeft = 0;
    photoOrthoSlideMixPct = 0;
  }
  photoOrthoSlidePaint();
}

var photoOrthoSlidePlayGen = 0;
var photoOrthoSlideSpeed = 5;
var photoOrthoSlidePaused = false;
var photoOrthoSlideHoldUntil = 0;
var photoOrthoSlideHoldLeft = 0;

function photoOrthoSlideStopPlay() {
  photoOrthoSlidePlayGen++;
}

function photoOrthoSlideSyncPlayBtn() {
  var btn = g('photoOrthoPlayBtn');
  if (!btn) return;
  var key = photoOrthoSlidePaused ? 'media.ortho.play' : 'media.ortho.pause';
  btn.setAttribute('data-i18n', key);
  btn.textContent = mediaTr(key);
  btn.classList.toggle('is-paused', !!photoOrthoSlidePaused);
}

function photoOrthoSlideTogglePlay() {
  var show = g('photoOrthoShow');
  if (!show || show.hasAttribute('hidden')) return;
  if (photoOrthoSlideMode !== 'slider' && photoOrthoSlideMode !== 'fade') return;
  if (photoOrthoSlidePaused) {
    photoOrthoSlidePaused = false;
    photoOrthoSlideSyncPlayBtn();
    var left = photoOrthoSlideHoldLeft;
    photoOrthoSlideHoldLeft = 0;
    if (left > 0) photoOrthoSlidePlay(100, left);
    else photoOrthoSlidePlay(photoOrthoSlideMixPct);
    return;
  }
  photoOrthoSlidePaused = true;
  if (photoOrthoSlideHoldUntil > Date.now()) photoOrthoSlideHoldLeft = photoOrthoSlideHoldUntil - Date.now();
  else photoOrthoSlideHoldLeft = 0;
  photoOrthoSlideHoldUntil = 0;
  photoOrthoSlideStopPlay();
  photoOrthoSlideSyncPlayBtn();
}

function photoOrthoSlideDuration() {
  var n = Number(photoOrthoSlideSpeed);
  if (!isFinite(n)) n = 5;
  n = Math.max(1, Math.min(10, Math.round(n)));
  return Math.round(7000 / n);
}

function photoOrthoSlideSetSpeed(val) {
  var n = Number(val);
  photoOrthoSlideSpeed = isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : 5;
  var range = g('photoOrthoSlideSpeed');
  if (range && String(range.value) !== String(photoOrthoSlideSpeed)) range.value = String(photoOrthoSlideSpeed);
  var lab = g('photoOrthoSpeedVal');
  if (lab) lab.textContent = String(photoOrthoSlideSpeed);
}

function photoOrthoSlidePlay(fromPct, holdMs) {
  if (photoOrthoSlidePaused) return;
  if (holdMs == null) photoOrthoSlideHoldLeft = 0;
  var gen = ++photoOrthoSlidePlayGen;
  var show = g('photoOrthoShow');
  if (!show || show.hasAttribute('hidden')) return;
  if (photoOrthoSlideMode !== 'slider' && photoOrthoSlideMode !== 'fade') return;
  var mix = g('photoOrthoShowMix');
  if (!mix || mix.hasAttribute('hidden')) return;
  var origin = (fromPct == null) ? 0 : Number(fromPct);
  if (!isFinite(origin)) origin = 0;
  origin = Math.max(0, Math.min(100, origin));
  photoOrthoSlideSetMix(origin);
  photoOrthoSlideHoldUntil = 0;
  var start = Date.now();
  function afterMix() {
    if (gen !== photoOrthoSlidePlayGen || photoOrthoSlidePaused) return;
    var el2 = g('photoOrthoShow');
    if (!el2 || el2.hasAttribute('hidden')) return;
    if (photoOrthoSlideMode !== 'slider' && photoOrthoSlideMode !== 'fade') return;
    var hold = (holdMs != null && isFinite(Number(holdMs)))
      ? Math.max(0, Math.round(Number(holdMs)))
      : Math.round(Math.min(900, photoOrthoSlideDuration() * 0.45));
    photoOrthoSlideHoldUntil = Date.now() + hold;
    setTimeout(function() {
      if (gen !== photoOrthoSlidePlayGen || photoOrthoSlidePaused) return;
      photoOrthoSlideHoldUntil = 0;
      var el3 = g('photoOrthoShow');
      if (!el3 || el3.hasAttribute('hidden')) return;
      if (photoOrthoSlideMode !== 'slider' && photoOrthoSlideMode !== 'fade') return;
      if (photoOrthoSlideSteps().length > 1) photoOrthoSlideStep(1);
      else photoOrthoSlidePlay();
    }, hold);
  }
  function tick() {
    if (gen !== photoOrthoSlidePlayGen || photoOrthoSlidePaused) return;
    var el = g('photoOrthoShow');
    if (!el || el.hasAttribute('hidden')) return;
    if (photoOrthoSlideMode !== 'slider' && photoOrthoSlideMode !== 'fade') return;
    var dur = photoOrthoSlideDuration();
    var span = Math.max(40, Math.round(dur * (100 - origin) / 100));
    var t = Math.min(1, (Date.now() - start) / span);
    var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    photoOrthoSlideSetMix(Math.round(origin + (100 - origin) * e));
    if (t < 1) {
      setTimeout(tick, 40);
      return;
    }
    afterMix();
  }
  if (origin >= 100) afterMix();
  else setTimeout(tick, 40);
}

function photoOrthoSlideSetMode(mode) {
  var next = (mode === 'slider' || mode === 'fade') ? mode : 'pair';
  if (next === 'pair') {
    photoOrthoSlidePaused = false;
    photoOrthoSlideHoldLeft = 0;
  }
  photoOrthoSlideMode = next;
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
  if (photoOrthoSlidePaused) {
    photoOrthoSlideHoldLeft = 0;
    photoOrthoSlideMixPct = 0;
  }
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
  if (title) {
    title.textContent = slotKey === 'composite'
      ? mediaTr('media.ortho.compTile')
      : photoOrthoSlotLabel(slotKey);
  }
  if (step) {
    step.textContent = mediaTrRepl('media.ortho.step', {
      N: photoOrthoSlideIdx + 1,
      M: steps.length
    });
  }
  var vis = photoOrthoVisibleSets();
  var cmp = photoOrthoComparePair(map);
  var dual = vis.length > 1;
  var leftKey = cmp ? cmp.left.key : (vis[0] || 'before');
  var rightKey = cmp ? cmp.right.key : (dual ? (vis[1] || 'after') : '');
  var leftSlot = photoOrthoInputMode(map, leftKey) === 'composite' ? 'composite' : slotKey;
  var rightSlot = rightKey && photoOrthoInputMode(map, rightKey) === 'composite' ? 'composite' : slotKey;
  function sideId(view, key, slot) {
    if (view && view.slots) return view.slots[slot] || '';
    return photoOrthoSlotPhotoId(map, key, slot);
  }
  function sideXf(view, key, slot) {
    if (view) {
      var wrap = { xf: {} };
      wrap.xf[key] = view.xf || {};
      return photoOrthoXfGet(wrap, key, slot);
    }
    return photoOrthoXfGet(map, key, slot);
  }
  var beforeId = sideId(cmp && cmp.left, leftKey, leftSlot);
  var afterId = rightKey ? sideId(cmp && cmp.right, rightKey, rightSlot) : '';
  var beforeXf = sideXf(cmp && cmp.left, leftKey, leftSlot);
  var afterXf = rightKey ? sideXf(cmp && cmp.right, rightKey, rightSlot) : { rot: 0, flipH: false, flipV: false };
  var before = g('photoOrthoShowBefore');
  var after = g('photoOrthoShowAfter');
  if (before) before.innerHTML = photoOrthoFrameHtml(beforeId, beforeXf);
  if (after) after.innerHTML = dual ? photoOrthoFrameHtml(afterId, afterXf) : '';
  var bd = photoOrthoSlideDate(beforeId);
  var ad = photoOrthoSlideDate(afterId);
  var beforeDate = g('photoOrthoShowBeforeDate');
  var afterDate = g('photoOrthoShowAfterDate');
  if (beforeDate) beforeDate.textContent = bd;
  if (afterDate) afterDate.textContent = ad;
  var leftTitle = el.querySelector('.ortho-show-pane:first-child h3');
  var rightTitle = el.querySelector('.ortho-show-pane:last-child h3');
  if (leftTitle) leftTitle.textContent = cmp ? photoOrthoCompareCaption(cmp.left) : photoOrthoSetLabel(leftKey);
  if (rightTitle) rightTitle.textContent = cmp ? photoOrthoCompareCaption(cmp.right) : (rightKey ? photoOrthoSetLabel(rightKey) : '');
  var mixBeforeDate = g('photoOrthoMixBeforeDate');
  var mixAfterDate = g('photoOrthoMixAfterDate');
  var leftCap = cmp ? photoOrthoCompareCaption(cmp.left) : photoOrthoSetLabel(leftKey);
  var rightCap = cmp ? photoOrthoCompareCaption(cmp.right) : (rightKey ? photoOrthoSetLabel(rightKey) : '');
  if (mixBeforeDate) mixBeforeDate.textContent = (bd ? leftCap + ' · ' + bd : leftCap);
  if (mixAfterDate) mixAfterDate.textContent = rightKey ? (ad ? rightCap + ' · ' + ad : rightCap) : '';
  var mixBefore = g('photoOrthoMixBefore');
  var mixAfter = g('photoOrthoMixAfter');
  if (mixBefore) mixBefore.innerHTML = photoOrthoFrameHtml(beforeId, beforeXf);
  if (mixAfter) mixAfter.innerHTML = dual ? photoOrthoFrameHtml(afterId, afterXf) : '';
  var pair = g('photoOrthoShowPair');
  var mix = g('photoOrthoShowMix');
  var isMix = dual && (photoOrthoSlideMode === 'slider' || photoOrthoSlideMode === 'fade');
  if (pair) {
    pair.classList.toggle('is-single', !dual);
    if (isMix) pair.setAttribute('hidden', '');
    else pair.removeAttribute('hidden');
  }
  var afterPane = pair && pair.querySelector('.ortho-show-pane:last-child');
  if (afterPane) afterPane.hidden = !dual;
  if (mix) {
    if (isMix) mix.removeAttribute('hidden');
    else mix.setAttribute('hidden', '');
    mix.classList.toggle('is-slider', photoOrthoSlideMode === 'slider');
    mix.classList.toggle('is-fade', photoOrthoSlideMode === 'fade');
    mix.style.setProperty('--ortho-mix', photoOrthoSlideMixPct + '%');
  }
  var skip = g('photoOrthoSlideSkip');
  if (skip) {
    skip.checked = !!photoOrthoSlideSkipEmpty;
    var skipLab = skip.closest ? skip.closest('.ortho-show-skip') : skip.parentNode;
    if (skipLab) skipLab.hidden = photoOrthoAllComposite(map);
  }
  var modes = { pair: 'photoOrthoModePair', slider: 'photoOrthoModeSlider', fade: 'photoOrthoModeFade' };
  Object.keys(modes).forEach(function(k) {
    var b = g(modes[k]);
    if (b) {
      b.classList.toggle('is-on', photoOrthoSlideMode === k);
      b.hidden = !dual && k !== 'pair';
    }
  });
  var speedWrap = g('photoOrthoSpeedWrap');
  if (speedWrap) speedWrap.classList.toggle('is-on', !!isMix);
  photoOrthoSlideSetSpeed(photoOrthoSlideSpeed);
  var playBtn = g('photoOrthoPlayBtn');
  if (playBtn) playBtn.classList.toggle('is-on', !!isMix);
  photoOrthoSlideSyncPlayBtn();
  var oneStep = steps.length <= 1;
  document.querySelectorAll('#photoOrthoShow .ortho-show-nav').forEach(function(nav) {
    nav.hidden = oneStep;
  });
  if (isMix && !photoOrthoSlidePaused) photoOrthoSlidePlay();
  else photoOrthoSlideStopPlay();
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
  function add(id) {
    var rec = photoOrthoFind(id);
    if (!rec || !rec.taken_date) return;
    var d = String(rec.taken_date).slice(0, 10);
    if (d && dates.indexOf(d) < 0) dates.push(d);
  }
  add(bag && bag.composite);
  PHOTO_ORTHO_SLOTS.forEach(function(slot) {
    add((bag && bag[slot[0]]) || '');
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
  if (photoOrthoInputMode(map, setKey) === 'composite') {
    var crec = photoOrthoFind(bag.composite);
    return !!(crec && photoOrthoIsImage(crec));
  }
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

function photoOrthoImageFromBlob(blob) {
  var obj = URL.createObjectURL(blob);
  return photoOrthoDecodeImg(obj, false).then(function(img) {
    img._orthoObjectUrl = obj;
    var ready = (img.decode && typeof img.decode === 'function') ? img.decode() : Promise.resolve();
    return ready.then(function() { return img; }, function() { return img; });
  }, function(err) {
    try { URL.revokeObjectURL(obj); } catch (e) {}
    throw err;
  });
}

function photoOrthoBitmapFromBlob(blob) {
  if (!blob || typeof createImageBitmap !== 'function') return photoOrthoImageFromBlob(blob);
  function shrink(bmp) {
    var w = bmp.width || 0;
    var h = bmp.height || 0;
    var edge = Math.max(w, h);
    if (!edge || edge <= 1400 || typeof bmp.close !== 'function') return Promise.resolve(bmp);
    var scale = 1400 / edge;
    return createImageBitmap(bmp, {
      resizeWidth: Math.max(1, Math.round(w * scale)),
      resizeHeight: Math.max(1, Math.round(h * scale)),
      resizeQuality: 'high'
    }).then(function(small) {
      try { bmp.close(); } catch (e) {}
      return small;
    }, function() { return bmp; });
  }
  return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function() {
    return createImageBitmap(blob);
  }).then(shrink).catch(function() {
    return photoOrthoImageFromBlob(blob);
  });
}

function photoOrthoStorageBlob(rec) {
  var path = rec && rec.file_path ? String(rec.file_path) : '';
  if (!path || typeof SB === 'undefined' || !SB || !SB.storage || typeof SB.storage.from !== 'function') {
    return Promise.reject(new Error('storage'));
  }
  var req;
  try { req = SB.storage.from(PHOTO_BUCKET).download(path); }
  catch (e) { return Promise.reject(e); }
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, 8000);
    Promise.resolve(req).then(function(r) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (r && r.error) { reject(r.error); return; }
      var blob = r && r.data ? r.data : r;
      if (!blob || typeof blob.size !== 'number') { reject(new Error('storage')); return; }
      resolve(blob);
    }, function(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function photoOrthoLoadImg(rec) {
  var url = photoBareUrl(rec) || photoDisplayUrl(rec);
  if (!url && !(rec && rec.file_path)) return Promise.resolve(null);
  if (url && url.indexOf('data:') === 0) return photoOrthoDecodeImg(url, false);
  return photoOrthoStorageBlob(rec).catch(function() {
    if (!url) throw new Error('nourl');
    return fetch(url, { mode: 'cors', credentials: 'omit' }).then(function(res) {
      if (!res.ok) throw new Error('http');
      return res.blob();
    });
  }).then(function(blob) {
    return photoOrthoBitmapFromBlob(blob);
  }).catch(function() {
    if (!url) return null;
    return photoOrthoDecodeImg(photoDisplayUrl(rec) || url, true).catch(function() { return null; });
  });
}

function photoOrthoReleaseImages(imgs) {
  Object.keys(imgs || {}).forEach(function(id) {
    var im = imgs[id];
    if (!im) return;
    if (im._orthoObjectUrl) {
      try { URL.revokeObjectURL(im._orthoObjectUrl); } catch (e) {}
      im._orthoObjectUrl = '';
    }
    if (typeof im.close === 'function') {
      try { im.close(); } catch (e2) {}
    }
  });
}

function photoOrthoCollectImages(map, views) {
  var seen = {};
  function addBag(bag) {
    PHOTO_ORTHO_SLOTS.forEach(function(slot) {
      var id = bag && bag[slot[0]];
      if (id) seen[String(id)] = true;
    });
    if (bag && bag.composite) seen[String(bag.composite)] = true;
  }
  if (views && views.length) views.forEach(function(view) { addBag(view && view.slots); });
  else photoOrthoKnownSets().forEach(function(setKey) { addBag((map && map[setKey]) || {}); });
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

function photoOrthoEnsureWrite(handle) {
  if (!handle) return Promise.resolve(false);
  if (typeof handle.queryPermission !== 'function') return Promise.resolve(true);
  return Promise.resolve(handle.queryPermission({ mode: 'readwrite' })).then(function(state) {
    if (state === 'granted') return true;
    if (typeof handle.requestPermission !== 'function') return state === 'granted';
    return handle.requestPermission({ mode: 'readwrite' }).then(function(next) {
      return next === 'granted';
    });
  }).catch(function() { return false; });
}

function photoOrthoWriteHandle(handle, blob) {
  return photoOrthoEnsureWrite(handle).then(function(ok) {
    if (!ok) throw new Error('permission');
    return handle.createWritable();
  }).then(function(stream) {
    return stream.write(blob).then(function() { return stream.close(); });
  });
}

function photoOrthoWriteOrDownload(handle, blob, name) {
  if (handle && typeof handle.createWritable === 'function') {
    return photoOrthoWriteHandle(handle, blob).catch(function() {
      photoOrthoDownloadBlob(blob, name);
    });
  }
  photoOrthoDownloadBlob(blob, name);
  return Promise.resolve();
}

function photoOrthoWriteDirFile(dir, name, blob) {
  return photoOrthoEnsureWrite(dir).then(function(ok) {
    if (!ok || !dir || typeof dir.getFileHandle !== 'function') throw new Error('permission');
    return dir.getFileHandle(name, { create: true });
  }).then(function(fh) {
    return photoOrthoWriteHandle(fh, blob);
  }).catch(function() {
    photoOrthoDownloadBlob(blob, name);
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

function photoOrthoFitImage(ctx, img, x, y, w, h, xf) {
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  xf = xf || { rot: 0, flipH: false, flipV: false };
  var rot = ((xf.rot % 360) + 360) % 360;
  var swap = rot === 90 || rot === 270;
  var boxW = swap ? ih : iw;
  var boxH = swap ? iw : ih;
  var s = Math.min(w / boxW, h / boxH);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  ctx.scale(xf.flipH ? -1 : 1, xf.flipV ? -1 : 1);
  ctx.drawImage(img, -(iw * s) / 2, -(ih * s) / 2, iw * s, ih * s);
  ctx.restore();
}

function photoOrthoDrawXfMap(setKey, xfBag) {
  var live = photoOrthoLoad();
  if (!xfBag) return live;
  var wrap = { xf: {}, input: live.input || {} };
  wrap.xf[setKey] = xfBag;
  return wrap;
}

function photoOrthoDrawCompositeSet(setKey, bag, imgs, xfBag) {
  var xfMap = photoOrthoDrawXfMap(setKey, xfBag);
  var img = imgs[String((bag && bag.composite) || '')] || null;
  var cell = 1600;
  if (img) {
    var side = Math.max(img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0);
    if (side > 400) cell = Math.min(2400, side);
  }
  var pad = Math.round(cell * 0.06);
  var titleH = Math.round(cell * 0.12);
  var w = pad * 2 + cell;
  var h = pad + titleH + cell + pad;
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
  ctx.font = '700 ' + Math.round(titleH * 0.42) + 'px ' + font;
  ctx.fillText(photoOrthoSetLabel(setKey) + ' · ' + mediaTr('media.ortho.compTile'), pad, pad);
  ctx.font = '600 ' + Math.round(titleH * 0.28) + 'px ' + font;
  ctx.fillStyle = '#475569';
  var sub = [meta.name, meta.no !== '—' ? meta.no : ''].filter(Boolean).join('  ·  ');
  ctx.fillText(sub, pad, pad + Math.round(titleH * 0.5));
  var x = pad;
  var y = pad + titleH;
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, cell, cell * 0.75, 12);
  else ctx.rect(x, y, cell, cell * 0.75);
  ctx.clip();
  ctx.fillStyle = img ? '#0f172a' : '#f8fafc';
  ctx.fillRect(x, y, cell, cell * 0.75);
  if (img) photoOrthoFitImage(ctx, img, x, y, cell, cell * 0.75, photoOrthoXfGet(xfMap, setKey, 'composite'));
  ctx.restore();
  return canvas;
}

function photoOrthoDrawSet(setKey, bag, imgs, xfBag) {
  var xfMap = photoOrthoDrawXfMap(setKey, xfBag);
  if (photoOrthoInputMode(xfMap, setKey) === 'composite') {
    return photoOrthoDrawCompositeSet(setKey, bag, imgs, xfBag);
  }
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
  cell = Math.max(900, Math.min(1000, cell));
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
    if (img) photoOrthoFitImage(ctx, img, x, y, cell, cell, photoOrthoXfGet(xfMap, setKey, slot[0]));
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
  var dual = !!(beforeCanvas && afterCanvas);
  var colW = dual ? Math.floor((w - pad * 2 - gutter) / 2) : (w - pad * 2);
  var colH = h - pad - (pad + headerH);
  var colY = pad + headerH;
  function place(src, colX) {
    if (!src) return;
    var s = Math.min(colW / src.width, colH / src.height);
    var dw = src.width * s;
    var dh = src.height * s;
    ctx.drawImage(src, colX + (colW - dw) / 2, colY + (colH - dh) / 2, dw, dh);
  }
  if (dual) {
    place(beforeCanvas, pad);
    place(afterCanvas, pad + colW + gutter);
  } else {
    place(beforeCanvas || afterCanvas, pad);
  }
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
      var setKey = String(k).split(':')[0];
      var setLabel = photoOrthoSetLabel(setKey);
      if (String(k).indexOf(':') > 0) setLabel += ' ' + String(k).split(':').slice(1).join(':');
      return photoUploadOne(file, {
        category: 'Scanned Document',
        caption: mediaTrRepl('media.ortho.chartCaption', { SET: setLabel }),
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

function photoOrthoViewOfSet(map, setKey) {
  var date = '';
  if (setKey === 'before' || setKey === 'after') {
    date = map.setMeta && map.setMeta[setKey] && map.setMeta[setKey].date;
  } else if (setKey === 'progress') date = map.progressDate;
  var fallback = (setKey === 'after' || setKey === 'progress') ? setKey : 'before';
  return photoOrthoResolveVisitView(map, date || '', fallback);
}

function photoOrthoViewFilled(map, view) {
  if (!view) return false;
  var bag = view.slots || {};
  if (photoOrthoInputMode(map, view.key) === 'composite') {
    var crec = photoOrthoFind(bag.composite);
    return !!(crec && photoOrthoIsImage(crec));
  }
  var i, rec;
  for (i = 0; i < PHOTO_ORTHO_SLOTS.length; i++) {
    rec = photoOrthoFind(bag[PHOTO_ORTHO_SLOTS[i][0]]);
    if (rec && photoOrthoIsImage(rec)) return true;
  }
  return false;
}

function photoOrthoExportViews(map) {
  map = map || photoOrthoLoad();
  var list = [];
  var cmp = photoOrthoComparePair(map);
  if (cmp) list = [cmp.left, cmp.right];
  else photoOrthoVisibleSets().forEach(function(k) { list.push(photoOrthoViewOfSet(map, k)); });
  var filled = list.filter(function(v) { return photoOrthoViewFilled(map, v); });
  if (filled.length) return filled;
  return photoOrthoKnownSets().map(function(k) { return photoOrthoViewOfSet(map, k); })
    .filter(function(v) { return photoOrthoViewFilled(map, v); });
}

function photoOrthoExportBlobKey(views, view, i) {
  var date = String((view && view.date) || '').slice(0, 10);
  var key = (view && view.key) ? view.key : 'set';
  if (date) key += ':' + date;
  var n = 0;
  var j;
  for (j = 0; j < i; j++) {
    var other = views[j];
    var odate = String((other && other.date) || '').slice(0, 10);
    var okey = (other && other.key) ? other.key : 'set';
    if (odate) okey += ':' + odate;
    if (okey === key) n++;
  }
  if (n) key += '#' + i;
  return key;
}

function photoOrthoExportFileName(view) {
  var date = String((view && view.date) || '').slice(0, 10);
  var key = (view && view.key) ? view.key : 'set';
  return photoOrthoFileBase() + '-' + key + (date ? '-' + date : '') + '.png';
}

function photoOrthoViewsHavePixels(views, imgs) {
  var want = 0;
  var got = 0;
  (views || []).forEach(function(view) {
    var bag = (view && view.slots) || {};
    var mode = photoOrthoInputMode(photoOrthoLoad(), view.key);
    var slots = mode === 'composite' ? ['composite'] : PHOTO_ORTHO_SLOTS.map(function(s) { return s[0]; });
    slots.forEach(function(slot) {
      var id = bag[slot];
      if (!id || !photoOrthoFind(id) || !photoOrthoIsImage(photoOrthoFind(id))) return;
      want++;
      if (imgs && imgs[String(id)]) got++;
    });
  });
  return got > 0 || !want;
}

function photoOrthoHideExportOffer() {
  var host = g('photoOrthoExportReady');
  if (!host) return;
  if (host._orthoUrls) {
    host._orthoUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
  }
  host._orthoUrls = [];
  host.hidden = true;
  host.innerHTML = '';
}

function photoOrthoOfferDownloads(items, hintKey) {
  var host = g('photoOrthoExportReady');
  if (!host) {
    host = document.createElement('div');
    host.id = 'photoOrthoExportReady';
    host.className = 'ortho-export-ready';
    var tools = document.querySelector('.ortho-board-export');
    if (tools && tools.parentNode) tools.parentNode.insertBefore(host, tools.nextSibling);
    else {
      var panel = g('photoOrthoPanel');
      if (panel) panel.appendChild(host);
      else return;
    }
  }
  if (host._orthoUrls) {
    host._orthoUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
  }
  host._orthoUrls = [];
  host.hidden = false;
  host.innerHTML = '<span>' + esc(mediaTr(hintKey || 'media.ortho.compositeReady')) + '</span>';
  (items || []).forEach(function(item) {
    if (!item || !item.blob) return;
    var url = URL.createObjectURL(item.blob);
    host._orthoUrls.push(url);
    var a = document.createElement('a');
    a.href = url;
    a.download = item.name || 'ortho.png';
    a.className = 'xray-btn';
    a.textContent = item.name || 'ortho.png';
    host.appendChild(a);
    photoOrthoDownloadBlob(item.blob, item.name);
  });
}

function photoOrthoBuildPdfBlob(map) {
  var views = photoOrthoExportViews(map);
  var held = null;
  return photoOrthoCollectImages(map, views).then(function(imgs) {
    held = imgs;
    var left = views[0] ? photoOrthoDrawSet(views[0].key, views[0].slots || {}, imgs, views[0].xf) : null;
    var right = views[1] ? photoOrthoDrawSet(views[1].key, views[1].slots || {}, imgs, views[1].xf) : null;
    var page = photoOrthoDrawPdfPage(left, right);
    return photoOrthoToBlob(page, 'image/jpeg', 0.92).then(function(jpegBlob) {
      return jpegBlob.arrayBuffer().then(function(buf) {
        return photoOrthoJpegPageToPdf({
          w: page.width,
          h: page.height,
          jpeg: new Uint8Array(buf)
        });
      });
    });
  }).then(function(pdf) {
    photoOrthoReleaseImages(held);
    return pdf;
  }, function(err) {
    photoOrthoReleaseImages(held);
    throw err;
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
  if (!photoOrthoExportSets(map).length) {
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

function photoOrthoExportSets(map) {
  var seen = {};
  var keys = [];
  photoOrthoExportViews(map).forEach(function(view) {
    if (!view || !view.key || seen[view.key]) return;
    seen[view.key] = true;
    keys.push(view.key);
  });
  return keys;
}

function photoOrthoComposite() {
  var map = photoOrthoLoad();
  var views = photoOrthoExportViews(map);
  if (!views.length) {
    mediaNotify(mediaTr('media.ortho.noPins'), 'error');
    return;
  }
  var names = {};
  var keys = [];
  var usedNames = {};
  views.forEach(function(view, i) {
    var key = photoOrthoExportBlobKey(views, view, i);
    var name = photoOrthoExportFileName(view);
    if (usedNames[name]) name = name.replace(/\.png$/, '-' + i + '.png');
    usedNames[name] = true;
    keys.push(key);
    names[key] = name;
    view._exportKey = key;
  });
  photoOrthoHideExportOffer();
  photoOrthoSetBusy('photoOrthoCompBtn', true);
  photoOrthoProgress(true, mediaTr('media.ortho.preparing'));
  var held = null;
  photoOrthoCollectImages(map, views).then(function(imgs) {
    held = imgs;
    if (!photoOrthoViewsHavePixels(views, imgs)) throw new Error('photo');
    var blobs = {};
    var chain = Promise.resolve();
    views.forEach(function(view) {
      chain = chain.then(function() {
        var canvas = photoOrthoDrawSet(view.key, view.slots || {}, imgs, view.xf);
        return photoOrthoToBlob(canvas, 'image/png').then(function(blob) {
          blobs[view._exportKey] = blob;
        });
      });
    });
    return chain.then(function() {
      photoOrthoReleaseImages(held);
      held = null;
      return blobs;
    });
  }).then(function(blobs) {
    var items = keys.map(function(k) { return { name: names[k], blob: blobs[k] }; });
    photoOrthoOfferDownloads(items);
    mediaNotify(mediaTrRepl('media.ortho.compositeOk', { N: String(views.length) }), 'info');
    var box = g('photoOrthoSaveChart');
    if (box && !box.checked) return;
    return photoOrthoSaveCompositesToChart(blobs, names).then(function(acc) {
      if (acc && acc.n) mediaNotify(mediaTrRepl('media.ortho.chartOk', { N: String(acc.n) }), 'info');
    }, function() {});
  }).catch(function(err) {
    if (photoOrthoIsAbort(err)) mediaNotify(mediaTr('media.ortho.exportCancel'));
    else mediaNotify(mediaTrRepl('media.ortho.exportFail', { MSG: (err && err.message) || String(err) }), 'error');
  }).then(function() {
    if (held) photoOrthoReleaseImages(held);
    photoOrthoProgress(false);
    photoOrthoSetBusy('photoOrthoCompBtn', false);
  });
}

function photoOrthoExportPdf() {
  var map = photoOrthoLoad();
  if (!photoOrthoExportSets(map).length) {
    mediaNotify(mediaTr('media.ortho.noPins'), 'error');
    return;
  }
  var name = photoOrthoFileBase() + '.pdf';
  photoOrthoHideExportOffer();
  photoOrthoSetBusy('photoOrthoPdfBtn', true);
  photoOrthoBuildPdfBlob(map).then(function(pdf) {
    photoOrthoOfferDownloads([{ name: name, blob: pdf }], 'media.ortho.pdfReady');
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
