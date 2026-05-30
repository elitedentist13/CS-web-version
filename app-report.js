// ════════════════════════════════════════════════════════════════
// app-report.js — Report module
// Tables used: bills, patients
// Notes:
// - Doctor-level reports require doctor recorded on bills; currently not present.
// - Charts use Chart.js if available.
// ════════════════════════════════════════════════════════════════

var REPORT = (function () {
  // Default landing: Daily Summary (Daily view)
  var _tab = 'dailySummary';
  var _reportInitialized = false;
  var _rows = [];
  var _chart = null;
  var _dailySummaryView = 'daily'; // 'daily' | 'monthly'
  var _dailySummaryDetailMode = false; // normal | detail transaction
  var _dailySummaryDate = null; // YYYY-MM-DD
  var _dailySummaryMonth = null; // YYYY-MM
  var _drDailyDate = null; // YYYY-MM-DD
  var _drDailyDoctorId = null;
  var _drDailyMode = 'simple'; // simple | detail | treatmentStats
  var _drDailyDoctors = [];
  var _drMonthlyMonth = null; // YYYY-MM
  var _drMonthlyDoctorId = null;
  var _drMonthlyMode = 'simple'; // simple | detail | treatmentStats
  var _reportTabsWired = false;
  var _auditFilterItem = '';
  var _auditFilterUser = '';
  var _auditAllRows = [];
  var _auditSelectedId = null;
  var _auditTableMissing = false;
  var _patientDirToolsWired = false;

  function g(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tr(key) {
    return typeof t === 'function' ? t(key) : key;
  }

  function trRepl(key, pairs) {
    var s = tr(key);
    if (!pairs) return s;
    for (var k in pairs) {
      if (Object.prototype.hasOwnProperty.call(pairs, k)) {
        s = s.split('{' + k + '}').join(String(pairs[k]));
      }
    }
    return s;
  }

  function dispPayMethod(m) {
    if (typeof window.dispPayMethod === 'function') return window.dispPayMethod(m);
    var v = String(m == null ? '' : m).trim();
    if (!v || /^unknown$/i.test(v)) return tr('report.unknown');
    return v;
  }

  var REPORT_CHART_TYPE_PAIRS = [
    ['bar', 'report.chartType.bar'],
    ['line', 'report.chartType.line'],
    ['pie', 'report.chartType.pie']
  ];

  function refreshReportChartTypeSelect() {
    var sel = g('rptChartType');
    if (!sel) return;
    var prev = sel.value || 'bar';
    sel.innerHTML = REPORT_CHART_TYPE_PAIRS.map(function (p) {
      return '<option value="' + esc(p[0]) + '">' + esc(tr(p[1])) + '</option>';
    }).join('');
    var has = false;
    var i;
    for (i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : 'bar';
  }

  function reportPayMethodKey(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || /^unknown$/i.test(s)) return '';
    return s;
  }

  function todayISO() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(iso, delta) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function setHeader(title, hint) {
    if (g('rptTitle')) g('rptTitle').textContent = title || '—';
    var clinicLbl = (typeof currentClinicLabel !== 'undefined' && currentClinicLabel)
        ? currentClinicLabel
        : '';
    var fullHint = hint || '';
    if (clinicLbl) {
      fullHint = (fullHint ? fullHint + ' · ' : '') + tr('report.hintClinicPrefix') + ' ' + clinicLbl;
    }
    if (g('rptHint')) g('rptHint').textContent = fullHint || '—';
  }

  function reportClinicTag() {
    var sel = g('reportClinicSelect');
    var sid = sel ? String(sel.value || '').trim() : '';
    if (!sid) return '';
    if (typeof clinicRecordFromId === 'function') {
      var rec = clinicRecordFromId(sid);
      if (rec) {
        var code = String(rec.clinic_code || '').trim();
        return code || String(rec.id || '').trim();
      }
    }
    return sid;
  }

  function reportClinicId() {
    var sel = g('reportClinicSelect');
    var sid = sel ? String(sel.value || '').trim() : '';
    return sid || '';
  }

  function isReportAllClinicsSelected() {
    return !reportClinicId();
  }

  function clinicCodeFromStoredTag(tagOrId) {
    var t = String(tagOrId || '').trim();
    if (!t) return '';
    if (typeof APP_CLINICS !== 'undefined' && APP_CLINICS && APP_CLINICS.length) {
      for (var i = 0; i < APP_CLINICS.length; i++) {
        var c = APP_CLINICS[i];
        if (String(c.id || '') === t) return String(c.clinic_code || '').trim() || t;
        if (String(c.clinic_code || '').trim() === t) return String(c.clinic_code || '').trim();
      }
    }
    return t;
  }

  function uniqIds(arr) {
    var seen = {};
    var out = [];
    (arr || []).forEach(function (id) {
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function excludeVoidBills(bills) {
    return (bills || []).filter(function (b) { return !(b && b.voided_at); });
  }

  async function filterBillsForReportClinic(bills) {
    var tag = reportClinicTag();
    if (!tag || !bills || !bills.length) return bills || [];

    var patientIds = uniqIds(bills.map(function (b) { return b.patient_id; }));
    var apptIds = uniqIds(bills.map(function (b) { return b.appointment_id; }));

    var pmap = {};
    if (patientIds.length) {
      var field = typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined'
        ? PATIENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
      var pr = await SB.from('patients').select('id,' + field).in('id', patientIds);
      if (pr.error) throw new Error(pr.error.message);
      (pr.data || []).forEach(function (p) {
        pmap[p.id] = String(p[field] || '').trim();
      });
    }

    var amap = {};
    if (apptIds.length) {
      var af = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
        ? APPOINTMENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
      var ar = await SB.from('appointments').select('id,' + af).in('id', apptIds);
      if (ar.error) throw new Error(ar.error.message);
      (ar.data || []).forEach(function (a) {
        amap[a.id] = String(a[af] || '').trim();
      });
    }

    return bills.filter(function (b) {
      if (b.patient_id && pmap[b.patient_id] !== undefined) {
        return pmap[b.patient_id] === tag;
      }
      if (b.appointment_id && amap[b.appointment_id] !== undefined) {
        return amap[b.appointment_id] === tag;
      }
      return false;
    });
  }

  function setDefaultDates() {
    var to = todayISO();
    var from = addDays(to, -30);
    if (g('rptFrom') && !g('rptFrom').value) g('rptFrom').value = from;
    if (g('rptTo') && !g('rptTo').value) g('rptTo').value = to;
  }

  function setDateInputs(fromIso, toIso) {
    if (g('rptFrom')) g('rptFrom').value = fromIso;
    if (g('rptTo')) g('rptTo').value = toIso;
  }

  function showPatientDirTools(show) {
    var box = g('rptPatientDirTools');
    if (!box) return;
    box.style.display = show ? 'flex' : 'none';
  }

  function wirePatientDirToolsOnce() {
    if (_patientDirToolsWired) return;
    _patientDirToolsWired = true;
    ['rptPatientDirSearch', 'rptPatientDirSortBy', 'rptPatientDirSortDir'].forEach(function (id) {
      var el = g(id);
      if (!el) return;
      var evt = id === 'rptPatientDirSearch' ? 'input' : 'change';
      el.addEventListener(evt, function () {
        if (_reportInitialized && _tab === 'patientDir') refresh();
      });
    });
  }

  function patientDirFilterQuery() {
    var q = g('rptPatientDirSearch') ? String(g('rptPatientDirSearch').value || '').trim() : '';
    return q.toLowerCase();
  }

  function patientDirSortKey() {
    return g('rptPatientDirSortBy') ? String(g('rptPatientDirSortBy').value || 'patient_no') : 'patient_no';
  }

  function patientDirSortDir() {
    var dir = g('rptPatientDirSortDir') ? String(g('rptPatientDirSortDir').value || 'asc') : 'asc';
    return dir === 'desc' ? -1 : 1;
  }

  function patientDirRowMatchesQuery(r, q) {
    if (!q) return true;
    var fields = [
      r.patient_no, r.full_name, r.chinese_name, r.phone,
      r.clinic_tag, r.dob, r.hkid, r.email, r.sex,
      r.address, r.alerts, r.remarks
    ];
    for (var i = 0; i < fields.length; i++) {
      if (String(fields[i] || '').toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }

  function cmpPatientDirValues(a, b, key) {
    var av = String(a[key] || '').trim();
    var bv = String(b[key] || '').trim();
    if (key === 'patient_no') {
      var an = parseInt(av, 10);
      var bn = parseInt(bv, 10);
      if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
    }
    if (key === 'dob') {
      if (av === bv) return 0;
      return av < bv ? -1 : 1;
    }
    return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
  }

  function applyPatientDirFilterSort(rows) {
    var q = patientDirFilterQuery();
    var key = patientDirSortKey();
    var dir = patientDirSortDir();
    var out = (rows || []).filter(function (r) {
      return patientDirRowMatchesQuery(r, q);
    });
    out.sort(function (a, b) {
      return cmpPatientDirValues(a, b, key) * dir;
    });
    return out;
  }

  function iso(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseDateToLocal(isoLike) {
    // Accepts "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS..." and returns a local Date at midnight.
    var s = String(isoLike || '').slice(0, 10);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return new Date();
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function startOfWeekMonday(d) {
    // returns new Date at local midnight Monday
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = x.getDay(); // 0 Sun..6 Sat
    var diff = (day === 0 ? -6 : 1) - day; // to Monday
    x.setDate(x.getDate() + diff);
    return x;
  }

  function endOfWeekSundayFromMonday(mon) {
    var x = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate());
    x.setDate(x.getDate() + 6);
    return x;
  }

  function firstDayOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function lastDayOfMonth(d) {
    // last day of d's month
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  function applyPresetDatesForTab(tabKey) {
    var fromEl = g('rptFrom');
    var toEl = g('rptTo');
    if (!fromEl || !toEl) return;

    var now = new Date();

    if (tabKey === 'dailyIncome') {
      // last Friday -> coming Thursday (Fri..Thu window)
      var day = now.getDay(); // 0 Sun..6 Sat
      var lastFri = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var offsetToFri = (day - 5 + 7) % 7;
      lastFri.setDate(lastFri.getDate() - offsetToFri);

      var comingThu = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var offsetToThu = (4 - day + 7) % 7;
      comingThu.setDate(comingThu.getDate() + offsetToThu);

      // If today is Fri/Sat, comingThu should be next week's Thu (offsetToThu yields 6/5 already)
      // If today is Sun..Thu, comingThu is this week's Thu.
      fromEl.value = iso(lastFri);
      toEl.value = iso(comingThu);
      return;
    }

    if (tabKey === 'dailySummary') {
      // Default to today (single day)
      var t = todayISO();
      setDateInputs(t, t);
      return;
    }

    if (tabKey === 'auditTrail') {
      var firstA = firstDayOfMonth(now);
      fromEl.value = iso(firstA);
      toEl.value = iso(now);
      return;
    }

    if (tabKey === 'drDaily') {
      var td = todayISO();
      setDateInputs(td, td);
      return;
    }

    if (tabKey === 'weeklyIncome') {
      // latest 4 blocks: Fri → Thu repeating 7-day blocks
      // Determine the current block start (most recent Friday <= today)
      var dayW = now.getDay(); // 0 Sun..6 Sat
      var blockStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var offsetToFri = (dayW - 5 + 7) % 7; // days since Friday
      blockStart.setDate(blockStart.getDate() - offsetToFri);

      var fromW = new Date(blockStart.getFullYear(), blockStart.getMonth(), blockStart.getDate());
      fromW.setDate(fromW.getDate() - 21); // include 3 previous blocks

      var toW = new Date(blockStart.getFullYear(), blockStart.getMonth(), blockStart.getDate());
      toW.setDate(toW.getDate() + 6); // Thu end of current block

      fromEl.value = iso(fromW);
      toEl.value = iso(toW);
      return;
    }

    if (tabKey === 'monthlyIncome') {
      // recent 4 months: current month and 3 prior months
      var firstCur = firstDayOfMonth(now);
      var fromM = new Date(firstCur.getFullYear(), firstCur.getMonth() - 3, 1);
      var toM = lastDayOfMonth(now);
      fromEl.value = iso(fromM);
      toEl.value = iso(toM);
      return;
    }
  }

  function parseBillItems(itemsJson) {
    try {
      var arr = JSON.parse(itemsJson || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function renderTable(columns, rows) {
    var wrap = g('rptTableWrap');
    if (!wrap) return;
    if (!rows || !rows.length) {
      wrap.innerHTML = '<div style="padding:12px;color:#888;">' + esc(tr('report.noData')) + '</div>';
      return;
    }

    var th = 'padding:10px 12px;background:#f0f7ff;color:#0d6efd;' +
      'font-size:12px;font-weight:900;border-bottom:2px solid #dde8f5;text-align:left;';
    var td = 'padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;';

    var html = '<div style="overflow:auto;max-height:520px;">' +
      '<table style="width:100%;border-collapse:collapse;min-width:640px;">' +
      '<thead><tr>' +
      columns.map(function (c) { return '<th style="' + th + '">' + esc(c.label) + '</th>'; }).join('') +
      '</tr></thead><tbody>';

    rows.forEach(function (r) {
      html += '<tr onmouseover="this.style.background=\'#f5f9ff\'" onmouseout="this.style.background=\'#fff\'">';
      columns.forEach(function (c) {
        var v = r[c.key];
        var cell;
        if (c.key === 'chinese_name' && v) {
          cell = '<span class="patient-dir-name-cn">' + esc(v) + '</span>';
        } else {
          cell = esc(v === null || v === undefined ? '' : v);
        }
        html += '<td style="' + td + '">' + cell + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  function setChartNote(msg) {
    if (g('rptChartNote')) g('rptChartNote').textContent = msg || '—';
  }

  function destroyChart() {
    if (_chart) {
      try { _chart.destroy(); } catch (e) {}
      _chart = null;
    }
  }

  function renderChartFromRows(labelKey, valueKey) {
    var canvas = g('rptChart');
    if (!canvas) return;

    destroyChart();

    if (typeof Chart === 'undefined') {
      setChartNote(tr('report.chart.jsMissing'));
      return;
    }

    if (!_rows || !_rows.length) {
      setChartNote(tr('report.chart.noDataChart'));
      return;
    }

    var type = (g('rptChartType') && g('rptChartType').value) ? g('rptChartType').value : 'bar';
    var labels = _rows.map(function (r) { return String(r[labelKey] || ''); });
    var values = _rows.map(function (r) { return Number(r[valueKey] || 0); });
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : tr('report.chart.fallbackTitle');
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : '';
    var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : '';
    var clinic = (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) ? currentClinicLabel : '';
    var doctor = (typeof currentDoctorName !== 'undefined' && currentDoctorName) ? currentDoctorName : '';
    var genAt = new Date().toLocaleString(typeof appUiLocale === 'function' ? appUiLocale() : 'en-HK');

    _chart = new Chart(canvas, {
      type: type === 'trend line' ? 'line' : type,
      data: {
        labels: labels,
        datasets: [{
          label: valueKey,
          data: values,
          backgroundColor: [
            '#0d6efd', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
            '#06b6d4', '#10b981', '#fb7185', '#a3e635', '#64748b'
          ],
          borderColor: '#0d6efd',
          borderWidth: 2,
          tension: 0.25
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: type !== 'bar' ? true : false },
          title: {
            display: true,
            text: [
              title,
              (from && to) ? trRepl('report.chartLine.dateRange', { FROM: from, TO: to }) : '',
              clinic ? trRepl('report.chartLine.clinic', { X: clinic }) : '',
              doctor ? trRepl('report.chartLine.doctor', { X: doctor }) : '',
              trRepl('report.chartLine.generated', { AT: genAt })
            ].filter(Boolean),
            color: '#0d6efd',
            font: { weight: 'bold', size: 12 }
          }
        },
        scales: (type === 'pie') ? {} : {
          y: { beginAtZero: true }
        }
      }
    });

    setChartNote(tr('report.chart.renderedFromTable'));
  }

  function openPrintWindow(title, bodyHtml, extraCss) {
    var w = window.open('', '_blank', 'width=980,height=720,scrollbars=1,resizable=1');
    if (!w) {
      alert(tr('report.print.popupBlocked'));
      return null;
    }
    var css =
      'body{font-family:Arial,sans-serif;padding:18px;color:#111;}' +
      'h1{font-size:18px;margin:0 0 12px;color:#0d6efd;}' +
      '@media print{body{padding:0}}' +
      (extraCss || '');
    w.document.write(
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>' + esc(title) + '</title>' +
      '<style>' + css + '</style>' +
      '</head><body>' +
      bodyHtml +
      '<script>window.onload=function(){setTimeout(function(){window.print();},200);};<\/script>' +
      '</body></html>'
    );
    w.document.close();
    return w;
  }

  function printTable() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : tr('report.fallback.reportTable');
    // Print the current table region (best effort)
    var html =
      '<h1>' + esc(title) + esc(tr('report.print.emTable')) + '</h1>' +
      '<div>' + wrap.innerHTML + '</div>';
    openPrintWindow(title + tr('report.print.winTable'), html, 'table{width:100%;border-collapse:collapse;}');
  }

  function printChart() {
    var canvas = g('rptChart');
    if (!canvas) return;
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : tr('report.fallback.reportChart');
    try {
      var dataUrl = canvas.toDataURL('image/png', 1.0);
      var html =
        '<h1>' + esc(title) + esc(tr('report.print.emChart')) + '</h1>' +
        '<div style="margin-top:10px;">' +
          '<img src="' + dataUrl + '" style="max-width:100%;height:auto;border:1px solid #eee;border-radius:10px;">' +
        '</div>';
      openPrintWindow(title + tr('report.print.winChart'), html);
    } catch (e) {
      alert(tr('report.print.chartFail') + ' ' + e.message);
    }
  }

  function printDailySummary() {
    var body = g('rptDailySummaryBody');
    if (!body) return;
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : tr('report.fallback.dailySummary');
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : todayISO();
    var viewLabel = _dailySummaryView === 'monthly'
      ? trRepl('report.ds.viewMonthly', { M: monthKeyOf(from) })
      : trRepl('report.ds.viewDaily', { D: from });
    var clinic = (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) ? currentClinicLabel : '';
    var doctor = (typeof currentDoctorName !== 'undefined' && currentDoctorName) ? currentDoctorName : '';
    var header =
      '<h1>' + esc(title) + ' — ' + esc(viewLabel) + '</h1>' +
      '<div style="color:#666;font-size:12px;margin-bottom:12px;">' +
        (clinic ? (esc(tr('report.hintClinicPrefix')) + ' ' + esc(clinic) + ' &nbsp;|&nbsp; ') : '') +
        (doctor ? (esc(tr('report.dr.labelDoctor')) + ': ' + esc(doctor) + ' &nbsp;|&nbsp; ') : '') +
        esc(tr('report.print.genPrefix')) + ' ' + esc(new Date().toLocaleString(typeof appUiLocale === 'function' ? appUiLocale() : 'en-HK')) +
      '</div>';
    var isDetailPrint = !!_dailySummaryDetailMode;
    var printWrap = document.createElement('div');
    printWrap.innerHTML = body.innerHTML;
    // Expand all scroll-limited containers so print includes full Daily Summary content.
    var nodes = printWrap.querySelectorAll('*');
    nodes.forEach(function (el) {
      if (!el || !el.style) return;
      if (el.style.maxHeight) el.style.maxHeight = 'none';
      if (el.style.height) el.style.height = 'auto';
      if (el.style.overflow) el.style.overflow = 'visible';
      if (el.style.overflowX) el.style.overflowX = 'visible';
      if (el.style.overflowY) el.style.overflowY = 'visible';
      if (el.style.position === 'sticky') {
        el.style.position = 'static';
        el.style.top = 'auto';
      }
    });
    printWrap.querySelectorAll('table').forEach(function (tb) {
      tb.style.width = '100%';
      tb.style.minWidth = '0';
      tb.style.tableLayout = 'fixed';
    });
    var detailPrintCss = '';
    if (isDetailPrint) {
      detailPrintCss =
        '@page{size:landscape;margin:8mm;}' +
        'body{font-size:10px;}' +
        'h1{font-size:14px;margin:0 0 8px;}' +
        'table{width:100%!important;table-layout:fixed;border-collapse:collapse;}' +
        'th,td{font-size:9px!important;line-height:1.2!important;padding:4px!important;word-break:break-word;vertical-align:top;}' +
        'th{background:#f3f7ff!important;color:#0d6efd!important;}' +
        '*{box-shadow:none!important;}';
    }
    openPrintWindow(title + ' - ' + viewLabel, header + printWrap.innerHTML,
      'table{width:100%;border-collapse:collapse;table-layout:fixed;}th,td{word-break:break-word;}' + detailPrintCss);
  }

  function magnifyChart() {
    var canvas = g('rptChart');
    if (!canvas) return;
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : tr('report.fallback.reportChart');
    var w = window.open('', '_blank', 'width=1200,height=850,scrollbars=1,resizable=1');
    if (!w) {
      alert(tr('report.print.popupBlockedView'));
      return;
    }
    var dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png', 1.0);
    } catch (e) {
      alert(tr('report.print.magnifyFail') + ' ' + e.message);
      return;
    }
    w.document.write(
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>' + esc(title) + ' - Chart</title>' +
      '<style>' +
        'body{margin:0;background:#0b1220;color:#fff;font-family:Arial,sans-serif;}' +
        '.top{display:flex;justify-content:space-between;align-items:center;gap:12px;' +
        'padding:12px 16px;background:#111827;position:sticky;top:0;}' +
        '.t{font-weight:900;}' +
        'button{background:#ef4444;color:#fff;border:none;border-radius:10px;' +
        'padding:8px 12px;font-weight:900;cursor:pointer;}' +
        '.wrap{padding:16px;display:flex;justify-content:center;align-items:center;}' +
        'img{width:96vw;max-height:86vh;height:auto;object-fit:contain;background:#fff;border-radius:14px;}' +
      '</style>' +
      '</head><body>' +
        '<div class="top">' +
          '<div class="t">🔍 ' + esc(title) + '</div>' +
          '<button onclick="window.close()">' + esc(tr('report.btn.close')) + '</button>' +
        '</div>' +
        '<div class="wrap">' +
          '<img src="' + dataUrl + '" alt="' + esc(tr('report.alt.chart')) + '">' +
        '</div>' +
      '</body></html>'
    );
    w.document.close();
    try { w.focus(); } catch (e) {}
  }

  async function loadBills(from, to) {
    // expects global SB
    var res = await SB.from('bills')
      .select('id,bill_date,bill_type,total,amount_paid,balance,items,status,created_at,patient_id,appointment_id,voided_at')
      .gte('bill_date', from)
      .lte('bill_date', to)
      .order('bill_date', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return filterBillsForReportClinic(excludeVoidBills(res.data || []));
  }

  async function loadPatients() {
    var q = SB.from('patients')
      .select(
        'patient_no,full_name,chinese_name,phone_number,dob,hkid,' +
        'email,address,sex,medical_alerts,remarks,' +
        PATIENT_CLINIC_TAG_FIELD
      )
      .order('patient_no', { ascending: true })
      .limit(2000);
    var tag = reportClinicTag();
    if (tag) q = q.eq(PATIENT_CLINIC_TAG_FIELD, tag);
    var res = await q;
    if (res.error) throw new Error(res.error.message);
    return res.data || [];
  }

  function exportCSV() {
    if (!_rows || !_rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var keys = Object.keys(_rows[0] || {});
    if (!keys.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var csv = keys.join(',') + '\n' + _rows.map(function (r) {
      return keys.map(function (k) {
        var v = (r[k] === null || r[k] === undefined) ? '' : r[k];
        return '"' + String(v).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (_tab || 'report') + '_' + todayISO() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function groupSumBy(rows, keyFn, valueFn) {
    var map = {};
    rows.forEach(function (r) {
      var k = keyFn(r);
      map[k] = (map[k] || 0) + (valueFn(r) || 0);
    });
    return Object.keys(map).sort().map(function (k) { return { key: k, value: map[k] }; });
  }

  async function loadBillsLite(from, to) {
    var selectFull = 'id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,doctor_id,doctor_name,doctor_tag,appointment_id,created_at,clinic_tag,voided_at';
    var selectNoDoctor = 'id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,appointment_id,created_at,clinic_tag,voided_at';
    var selectLegacy = 'id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,appointment_id,created_at,voided_at';
    var res = await SB.from('bills')
      .select(selectFull)
      .gte('bill_date', from)
      .lte('bill_date', to)
      .order('bill_date', { ascending: true })
      .order('created_at', { ascending: true });
    if (res.error) {
      var m = String(res.error.message || '').toLowerCase();
      if (m.indexOf('doctor_id') >= 0 || m.indexOf('doctor_name') >= 0 || m.indexOf('doctor_tag') >= 0) {
        res = await SB.from('bills')
          .select(selectNoDoctor)
          .gte('bill_date', from)
          .lte('bill_date', to)
          .order('bill_date', { ascending: true })
          .order('created_at', { ascending: true });
        if (res.error) {
          var m2 = String(res.error.message || '').toLowerCase();
          if (m2.indexOf('clinic_tag') >= 0) {
            res = await SB.from('bills')
              .select(selectLegacy)
              .gte('bill_date', from)
              .lte('bill_date', to)
              .order('bill_date', { ascending: true })
              .order('created_at', { ascending: true });
          }
        }
      } else if (m.indexOf('clinic_tag') >= 0) {
        res = await SB.from('bills')
          .select('id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,doctor_id,doctor_name,doctor_tag,appointment_id,created_at,voided_at')
          .gte('bill_date', from)
          .lte('bill_date', to)
          .order('bill_date', { ascending: true })
          .order('created_at', { ascending: true });
      }
    }
    if (res.error) throw new Error(res.error.message);
    return filterBillsForReportClinic(excludeVoidBills(res.data || []));
  }

  async function loadPatientsByIds(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return [];
    var pField = (typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined' && PATIENT_CLINIC_TAG_FIELD)
      ? PATIENT_CLINIC_TAG_FIELD
      : 'clinic_tag';
    var res = await SB.from('patients')
      .select('id,patient_no,full_name,chinese_name,' + pField)
      .in('id', ids);
    if (res.error) throw new Error(res.error.message);
    return res.data || [];
  }

  async function loadDoctorsForReport() {
    var res = await SB.from('doctors')
      .select('id,doctor_code,english_name,chinese_name,is_active')
      .eq('is_active', true)
      .order('doctor_code', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return res.data || [];
  }

  async function loadTreatmentsByDay(dayIso) {
    var fromTs = String(dayIso || todayISO()) + 'T00:00:00';
    var toTs = String(dayIso || todayISO()) + 'T23:59:59';
    var q = SB.from('treatments')
      .select('id,patient_id,dentist_name,doctor_id,doctor_name,doctor_tag,notes,created_at')
      .gte('created_at', fromTs)
      .lte('created_at', toTs)
      .order('created_at', { ascending: true });
    var tag = reportClinicTag();
    var tf = typeof TREATMENT_CLINIC_TAG_FIELD !== 'undefined'
      ? TREATMENT_CLINIC_TAG_FIELD
      : 'clinic_tag';
    if (tag) q = q.eq(tf, tag);
    var res = await q;
    if (res.error) {
      var m = String(res.error.message || '').toLowerCase();
      if (m.indexOf('doctor_id') >= 0 || m.indexOf('doctor_name') >= 0 || m.indexOf('doctor_tag') >= 0) {
        var q2 = SB.from('treatments')
          .select('id,patient_id,dentist_name,notes,created_at')
          .gte('created_at', fromTs)
          .lte('created_at', toTs)
          .order('created_at', { ascending: true });
        if (tag) q2 = q2.eq(tf, tag);
        res = await q2;
      }
    }
    if (res.error) throw new Error(res.error.message);
    return res.data || [];
  }

  function sumByKey(rows, key, valueKey) {
    var map = {};
    rows.forEach(function (r) {
      var k = reportPayMethodKey(r[key]);
      map[k] = (map[k] || 0) + Number(r[valueKey] || 0);
    });
    return Object.keys(map).sort().map(function (k) { return { key: k, value: map[k] }; });
  }

  function downloadCSV(filename, columns, rows) {
    if (!rows || !rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var keys = columns.map(function (c) { return c.key; });
    var header = columns.map(function (c) { return c.label; }).join(',');
    var csv = header + '\n' + rows.map(function (r) {
      return keys.map(function (k) {
        var v = (r[k] === null || r[k] === undefined) ? '' : r[k];
        return '"' + String(v).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showChartColumn(show) {
    var grid = g('rptMainGrid');
    var col = g('rptChartCol');
    if (!grid || !col) return;
    if (show) {
      grid.style.gridTemplateColumns = '1fr 360px';
      col.style.display = 'block';
    } else {
      grid.style.gridTemplateColumns = '1fr';
      col.style.display = 'none';
    }
  }

  function renderDailySummaryDaily(transactions, totalsByMethod, grandTotal) {
    var body = g('rptDailySummaryBody');
    if (!body) return;

    var th = 'padding:10px 10px;background:#f0f7ff;color:#0d6efd;font-size:12px;font-weight:900;border-bottom:2px solid #dde8f5;text-align:left;';
    var td = 'padding:9px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:middle;';

    var summaryBlocks = totalsByMethod.map(function (x) {
      return '<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;min-width:150px;">' +
        '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(dispPayMethod(x.key)) + '</div>' +
        '<div style="font-size:16px;font-weight:900;color:#0d6efd;margin-top:4px;">' + fmtHK(Number(x.value || 0)) + '</div>' +
      '</div>';
    }).join('');

    var showClinicCol = isReportAllClinicsSelected();
    var rowsHtml = transactions.map(function (t) {
      return '<tr>' +
        '<td style="' + td + '">' + esc(t.patient_no) + '</td>' +
        '<td style="' + td + '">' + esc(t.patient_chinese) + '</td>' +
        '<td style="' + td + '">' + esc(t.patient_name) + '</td>' +
        (showClinicCol ? ('<td style="' + td + '">' + esc(t.clinic_tag || '') + '</td>') : '') +
        '<td style="' + td + '">' + esc(dispPayMethod(t.payment_method)) + '</td>' +
        '<td style="' + td + 'text-align:right;font-weight:900;">' + fmtHK(Number(t.amount)) + '</td>' +
        '<td style="' + td + '">' + esc(t.remarks) + '</td>' +
      '</tr>';
    }).join('');

    body.innerHTML =
      '<div style="border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff;">' +
        '<div style="overflow:auto;max-height:520px;">' +
          '<table style="width:100%;border-collapse:collapse;min-width:860px;">' +
            '<thead><tr>' +
              '<th style="' + th + 'width:120px;">' + esc(tr('report.col.patientNo')) + '</th>' +
              '<th style="' + th + 'width:160px;">' + esc(tr('report.col.chinese')) + '</th>' +
              '<th style="' + th + '">' + esc(tr('report.ds.col.english')) + '</th>' +
              (showClinicCol ? ('<th style="' + th + 'width:130px;">' + esc(tr('report.col.clinicTag')) + '</th>') : '') +
              '<th style="' + th + 'width:150px;">' + esc(tr('report.ds.col.payment')) + '</th>' +
              '<th style="' + th + 'width:120px;text-align:right;">' + esc(tr('report.ds.col.amount')) + '</th>' +
              '<th style="' + th + 'width:220px;">' + esc(tr('report.col.remarks')) + '</th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;">' +
        '<div style="flex:1;min-width:240px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;">' +
          '<div style="font-size:12px;color:#7c2d12;font-weight:900;">' + esc(tr('report.ds.dailyGrandTotal')) + '</div>' +
          '<div style="font-size:22px;font-weight:900;color:#c2410c;margin-top:4px;">' + fmtHK(Number(grandTotal || 0)) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;">' +
          summaryBlocks +
        '</div>' +
      '</div>';
  }

  function renderDailySummaryMonthly(dayCards, monthTotalsByMethod, monthGrandTotal) {
    var body = g('rptDailySummaryBody');
    if (!body) return;

    var dayCount = dayCards.length;
    var txCount = 0;
    dayCards.forEach(function (c) { txCount += (c.rows || []).length; });

    var chips = monthTotalsByMethod.map(function (x) {
      return '<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 10px;background:#f8fbff;border:1px solid #e5edf8;border-radius:10px;">' +
        '<div style="font-weight:900;color:#4b5563;font-size:12px;">' + esc(dispPayMethod(x.key)) + '</div>' +
        '<div style="font-weight:900;color:#0d6efd;font-size:12px;">' + fmtHK(Number(x.value || 0)) + '</div>' +
      '</div>';
    }).join('');

    if (!chips) {
      chips = '<div style="padding:10px 0;color:#94a3b8;font-size:12px;">' + esc(tr('report.ds.monthly.noMethodTotals')) + '</div>';
    }

    var cardsHtml = dayCards.map(function (c) {
      var methodMiniMap = {};
      (c.rows || []).forEach(function (t) {
        var k = reportPayMethodKey(t.payment_method);
        methodMiniMap[k] = (methodMiniMap[k] || 0) + Number(t.amount || 0);
      });

      var methodMini = Object.keys(methodMiniMap).sort().map(function (k) {
        return '<span style="display:inline-flex;align-items:center;gap:6px;background:#eef6ff;color:#0d6efd;border:1px solid #d9eaff;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;">' +
          '<span>' + esc(dispPayMethod(k)) + '</span><span style="color:#1f2937;">' + fmtHK(Number(methodMiniMap[k] || 0)) + '</span>' +
        '</span>';
      }).join('');

      var showClinicCol = isReportAllClinicsSelected();
      var gridCols = showClinicCol
        ? 'minmax(90px,110px) minmax(200px,1fr) minmax(110px,130px) minmax(120px,140px) minmax(100px,120px)'
        : 'minmax(90px,110px) minmax(220px,1fr) minmax(120px,140px) minmax(100px,120px)';
      var rows = c.rows.map(function (t) {
        return '<div style="display:grid;grid-template-columns:' + gridCols + ';gap:10px;align-items:start;padding:10px 0;border-bottom:1px dashed #e6edf5;">' +
          '<div style="font-weight:900;color:#0d6efd;font-size:12px;">' + esc(t.patient_no || '-') + '</div>' +
          '<div style="min-width:0;">' +
            '<div style="font-size:13px;font-weight:900;color:#1f2937;line-height:1.35;">' + esc(t.patient_chinese || '') + (t.patient_name ? (' / ' + esc(t.patient_name)) : '') + '</div>' +
            (t.remarks ? '<div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.35;">' + esc(t.remarks) + '</div>' : '') +
          '</div>' +
          (showClinicCol ? ('<div style="color:#334155;font-weight:900;font-size:12px;">' + esc(t.clinic_tag || '') + '</div>') : '') +
          '<div style="color:#475569;font-weight:900;font-size:12px;">' + esc(dispPayMethod(t.payment_method)) + '</div>' +
          '<div style="text-align:right;font-weight:900;color:#0f172a;font-size:12px;">' + fmtHK(Number(t.amount || 0)) + '</div>' +
        '</div>';
      }).join('');

      return '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:14px;padding:12px 14px;margin-bottom:12px;box-shadow:0 3px 10px rgba(15,23,42,.04);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid #edf2f7;">' +
          '<div style="font-weight:900;color:#0d6efd;font-size:14px;">' + esc(c.date) + '</div>' +
          '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(trRepl('report.ds.monthly.txCount', { N: String((c.rows || []).length) })) + '</div>' +
            '<div style="font-size:14px;font-weight:900;color:#0f172a;">' + fmtHK(Number(c.total || 0)) + '</div>' +
          '</div>' +
        '</div>' +
        (methodMini ? '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 4px 0;">' + methodMini + '</div>' : '') +
        '<div style="margin-top:2px;">' + rows + '</div>' +
      '</div>';
    }).join('');

    if (!cardsHtml) {
      cardsHtml = '<div style="background:#fff;border:1px dashed #d7e2f0;border-radius:12px;padding:22px;text-align:center;color:#64748b;">' + esc(tr('report.ds.monthly.noBillingTx')) + '</div>';
    }

    body.innerHTML =
      '<div style="max-height:640px;overflow:auto;padding-right:2px;">' +
        '<div style="background:linear-gradient(135deg,#0d6efd,#2b8fff);border-radius:14px;padding:12px 14px;color:#fff;margin-bottom:12px;box-shadow:0 5px 14px rgba(13,110,253,.25);">' +
          '<div style="font-size:12px;font-weight:800;opacity:.9;">' + esc(tr('report.ds.monthly.overviewTitle')) + '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
            '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:8px 10px;min-width:130px;">' +
              '<div style="font-size:11px;font-weight:700;opacity:.9;">' + esc(tr('report.ds.monthly.daysWithBills')) + '</div>' +
              '<div style="margin-top:2px;font-size:18px;font-weight:900;">' + dayCount + '</div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:8px 10px;min-width:130px;">' +
              '<div style="font-size:11px;font-weight:700;opacity:.9;">' + esc(tr('report.ds.monthly.transactions')) + '</div>' +
              '<div style="margin-top:2px;font-size:18px;font-weight:900;">' + txCount + '</div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:8px 10px;min-width:180px;">' +
              '<div style="font-size:11px;font-weight:700;opacity:.9;">' + esc(tr('report.ds.monthly.monthGrandTotal')) + '</div>' +
              '<div style="margin-top:2px;font-size:18px;font-weight:900;">' + fmtHK(Number(monthGrandTotal || 0)) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;padding:10px 12px;margin-bottom:12px;">' +
          '<div style="font-size:12px;font-weight:900;color:#0d6efd;margin-bottom:8px;">' + esc(tr('report.ds.monthly.paymentTotalsTitle')) + '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">' + chips + '</div>' +
        '</div>' +
        cardsHtml +
      '</div>';
  }

  function treatmentEntriesHtml(itemsJson) {
    var items = parseBillItems(itemsJson);
    if (!items.length) {
      return {
        count: 0,
        html: '<div style="font-size:11px;color:#94a3b8;">' + esc(tr('report.treat.emptyLineItems')) + '</div>'
      };
    }
    var html = items.map(function (it, idx) {
      var desc = String(it && it.desc ? it.desc : tr('report.treat.defaultName'));
      var qty = Number(it && it.qty ? it.qty : 0);
      var price = Number(it && it.price ? it.price : 0);
      var lineTotal = qty * price;
      return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;padding:4px 6px;margin-bottom:4px;background:#f8fbff;border:1px solid #e5edf8;border-radius:8px;">' +
        '<div style="min-width:0;font-size:11px;color:#0f172a;line-height:1.35;"><span style="font-weight:900;color:#0d6efd;">#' + (idx + 1) + '</span> ' + esc(desc) + '</div>' +
        '<div style="flex-shrink:0;font-size:11px;color:#475569;font-weight:800;white-space:nowrap;">' +
          i18nRepl(t('common.fmtHkdQtyLine'), { QTY: qty, UNIT: fmtHK(price), TOTAL: fmtHK(lineTotal) }) +
        '</div>' +
      '</div>';
    }).join('');
    return { count: items.length, html: html };
  }

  function detailTxRowHtml(t, isCompact, showClinicCol) {
    var tx = treatmentEntriesHtml(t.treatment_items);
    var bal = Number(t.bill_balance || 0);
    var balColor = bal > 0 ? '#dc2626' : '#16a34a';
    var nameLine = esc(t.patient_chinese || '') + (t.patient_name ? (' / ' + esc(t.patient_name)) : '');
    return '<tr>' +
      '<td style="width:10%;padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#334155;vertical-align:top;word-break:break-word;">' + esc(t.bill_date || '') + '</td>' +
      '<td style="width:20%;padding:10px 8px;border-bottom:1px solid #eef2f7;vertical-align:top;word-break:break-word;">' +
        '<div style="font-size:12px;color:#0d6efd;font-weight:900;">' + esc(t.patient_no || '-') + '</div>' +
        '<div style="font-size:12px;color:#0f172a;font-weight:900;line-height:1.35;margin-top:2px;">' + nameLine + '</div>' +
      '</td>' +
      '<td style="width:14%;padding:10px 8px;border-bottom:1px solid #eef2f7;vertical-align:top;word-break:break-word;">' +
        '<div style="font-size:12px;color:#475569;font-weight:900;">' + esc(dispPayMethod(t.payment_method)) + '</div>' +
        (t.remarks ? '<div style="font-size:11px;color:#64748b;line-height:1.35;margin-top:4px;">' + esc(t.remarks) + '</div>' : '') +
      '</td>' +
      (showClinicCol
        ? ('<td style="width:9%;padding:10px 8px;border-bottom:1px solid #eef2f7;vertical-align:top;word-break:break-word;">' +
            '<div style="font-size:12px;color:#334155;font-weight:900;">' + esc(t.clinic_tag || '') + '</div>' +
          '</td>')
        : '') +
      '<td style="width:30%;padding:10px 8px;border-bottom:1px solid #eef2f7;vertical-align:top;word-break:break-word;">' +
        '<div style="font-size:11px;color:#64748b;font-weight:800;margin-bottom:5px;">' + esc(trRepl('report.ds.detail.treatmentEntriesCount', { N: String(tx.count) })) + '</div>' +
        tx.html +
      '</td>' +
      '<td style="width:9%;padding:10px 12px;border-bottom:1px solid #eef2f7;border-left:1px solid #edf2f7;text-align:right;font-size:12px;font-weight:900;vertical-align:top;color:#0f172a;white-space:nowrap;">' + fmtHK(Number(t.bill_total || 0)) + '</td>' +
      '<td style="width:9%;padding:10px 12px;border-bottom:1px solid #eef2f7;border-left:1px solid #edf2f7;text-align:right;font-size:12px;font-weight:900;vertical-align:top;color:#0369a1;white-space:nowrap;">' + fmtHK(Number(t.bill_paid || 0)) + '</td>' +
      '<td style="width:8%;padding:10px 12px;border-bottom:1px solid #eef2f7;border-left:1px solid #edf2f7;text-align:right;font-size:12px;font-weight:900;vertical-align:top;color:' + balColor + ';white-space:nowrap;">' + fmtHK(bal) + '</td>' +
    '</tr>';
  }

  function renderDailySummaryDetailDaily(transactions, totalsByMethod, grandTotal) {
    var body = g('rptDailySummaryBody');
    if (!body) return;
    var totalTreatments = 0;
    var outstanding = 0;
    transactions.forEach(function (t) {
      totalTreatments += treatmentEntriesHtml(t.treatment_items).count;
      outstanding += Number(t.bill_balance || 0);
    });
    var methodPills = totalsByMethod.map(function (x) {
      return '<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:#eef6ff;border:1px solid #d9eaff;border-radius:999px;font-size:11px;font-weight:900;color:#0d6efd;">' +
        esc(dispPayMethod(x.key)) + ': ' + fmtHK(Number(x.value || 0)) +
      '</span>';
    }).join('');

    var showClinicCol = isReportAllClinicsSelected();
    var rowsHtml = transactions.map(function (t) { return detailTxRowHtml(t, false, showClinicCol); }).join('');
    if (!rowsHtml) {
      rowsHtml = '<tr><td colspan="' + (showClinicCol ? '8' : '7') + '" style="padding:20px;text-align:center;color:#64748b;">' + esc(tr('report.ds.detail.noDetailedTx')) + '</td></tr>';
    }

    body.innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
        '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:150px;">' +
          '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(tr('report.ds.detail.kpiTotalBills')) + '</div>' +
          '<div style="font-size:18px;color:#0d6efd;font-weight:900;margin-top:2px;">' + transactions.length + '</div>' +
        '</div>' +
        '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:150px;">' +
          '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(tr('report.ds.detail.kpiTreatmentEntries')) + '</div>' +
          '<div style="font-size:18px;color:#0d6efd;font-weight:900;margin-top:2px;">' + totalTreatments + '</div>' +
        '</div>' +
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;min-width:190px;">' +
          '<div style="font-size:11px;color:#7c2d12;font-weight:800;">' + esc(tr('report.ds.detail.kpiBillTotal')) + '</div>' +
          '<div style="font-size:18px;color:#c2410c;font-weight:900;margin-top:2px;">' + fmtHK(Number(grandTotal || 0)) + '</div>' +
        '</div>' +
        '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;min-width:210px;">' +
          '<div style="font-size:11px;color:#991b1b;font-weight:800;">' + esc(tr('report.ds.detail.kpiRemainingBalance')) + '</div>' +
          '<div style="font-size:18px;color:#dc2626;font-weight:900;margin-top:2px;">' + fmtHK(Number(outstanding || 0)) + '</div>' +
        '</div>' +
      '</div>' +
      (methodPills ? ('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' + methodPills + '</div>') : '') +
      '<div style="border:1px solid #dfe9f5;border-radius:12px;overflow:hidden;background:#fff;">' +
        '<div style="overflow:auto;max-height:560px;">' +
          '<table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;">' +
            '<thead>' +
              '<tr>' +
                '<th style="width:10%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.ds.detail.thBillDate')) + '</th>' +
                '<th style="width:20%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.ds.detail.thPatient')) + '</th>' +
                '<th style="width:14%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.ds.detail.thPaymentNotes')) + '</th>' +
                (showClinicCol ? ('<th style="width:9%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.col.clinicTag')) + '</th>') : '') +
                '<th style="width:30%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.ds.detail.thTreatmentDetails')) + '</th>' +
                '<th style="width:9%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 12px;border-bottom:2px solid #dde8f5;border-left:1px solid #dde8f5;text-align:right;">' + esc(tr('report.ds.detail.thBill')) + '</th>' +
                '<th style="width:9%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 12px;border-bottom:2px solid #dde8f5;border-left:1px solid #dde8f5;text-align:right;">' + esc(tr('report.ds.detail.thPaid')) + '</th>' +
                '<th style="width:8%;position:sticky;top:0;background:#f0f7ff;color:#dc2626;font-size:11px;font-weight:900;padding:10px 12px;border-bottom:2px solid #fecaca;border-left:1px solid #fecaca;text-align:right;">' + esc(tr('report.ds.detail.thRemaining')) + '</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function renderDailySummaryDetailMonthly(dayCards, monthTotalsByMethod, monthGrandTotal) {
    var body = g('rptDailySummaryBody');
    if (!body) return;
    var showClinicCol = isReportAllClinicsSelected();

    var totalBills = 0;
    var totalTreatments = 0;
    var totalOutstanding = 0;
    dayCards.forEach(function (c) {
      (c.rows || []).forEach(function (t) {
        totalBills += 1;
        totalOutstanding += Number(t.bill_balance || 0);
        totalTreatments += treatmentEntriesHtml(t.treatment_items).count;
      });
    });

    var methodSummary = monthTotalsByMethod.map(function (x) {
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #eef2f7;">' +
        '<div style="font-size:12px;color:#475569;font-weight:900;">' + esc(dispPayMethod(x.key)) + '</div>' +
        '<div style="font-size:12px;color:#0d6efd;font-weight:900;">' + fmtHK(Number(x.value || 0)) + '</div>' +
      '</div>';
    }).join('');
    if (!methodSummary) {
      methodSummary = '<div style="font-size:12px;color:#94a3b8;">' + esc(tr('report.ds.detail.monthlyNoMethods')) + '</div>';
    }

    var sectionsHtml = dayCards.map(function (c) {
      var rowsHtml = (c.rows || []).map(function (t) { return detailTxRowHtml(t, true, showClinicCol); }).join('');
      if (!rowsHtml) {
        rowsHtml = '<tr><td colspan="' + (showClinicCol ? '8' : '7') + '" style="padding:14px;color:#64748b;text-align:center;">' + esc(tr('report.ds.detail.monthlyNoDetailRows')) + '</td></tr>';
      }
      return '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 8px rgba(15,23,42,.04);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#f8fbff;border-bottom:1px solid #e6edf5;">' +
          '<div style="font-size:13px;font-weight:900;color:#0d6efd;">' + esc(c.date) + '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(trRepl('report.ds.detail.monthlyBillsCount', { N: String((c.rows || []).length) })) + '</div>' +
            '<div style="font-size:13px;color:#0f172a;font-weight:900;">' + fmtHK(Number(c.total || 0)) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="overflow:auto;">' +
          '<table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;">' +
            '<thead>' +
              '<tr>' +
                '<th style="width:10%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.ds.detail.thBillDate')) + '</th>' +
                '<th style="width:20%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.ds.detail.thPatient')) + '</th>' +
                '<th style="width:14%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.ds.detail.thPaymentNotes')) + '</th>' +
                (showClinicCol ? ('<th style="width:9%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.col.clinicTag')) + '</th>') : '') +
                '<th style="width:30%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">' + esc(tr('report.ds.detail.thTreatmentDetails')) + '</th>' +
                '<th style="width:9%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 12px;border-bottom:2px solid #dde8f5;border-left:1px solid #dde8f5;text-align:right;">' + esc(tr('report.ds.detail.thBill')) + '</th>' +
                '<th style="width:9%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 12px;border-bottom:2px solid #dde8f5;border-left:1px solid #dde8f5;text-align:right;">' + esc(tr('report.ds.detail.thPaid')) + '</th>' +
                '<th style="width:8%;background:#f0f7ff;color:#dc2626;font-size:11px;font-weight:900;padding:9px 12px;border-bottom:2px solid #fecaca;border-left:1px solid #fecaca;text-align:right;">' + esc(tr('report.ds.detail.thRemaining')) + '</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
    }).join('');

    if (!sectionsHtml) {
      sectionsHtml = '<div style="background:#fff;border:1px dashed #d7e2f0;border-radius:12px;padding:22px;text-align:center;color:#64748b;">' + esc(tr('report.ds.detail.monthlyEmptySections')) + '</div>';
    }

    body.innerHTML =
      '<div style="max-height:640px;overflow:auto;padding-right:2px;">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:140px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(tr('report.ds.detail.monthlyKpiDays')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0d6efd;font-weight:900;">' + dayCards.length + '</div>' +
          '</div>' +
          '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:140px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(tr('report.ds.detail.monthlyKpiBills')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0d6efd;font-weight:900;">' + totalBills + '</div>' +
          '</div>' +
          '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:160px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(tr('report.ds.detail.monthlyKpiTreatEntries')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0d6efd;font-weight:900;">' + totalTreatments + '</div>' +
          '</div>' +
          '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;min-width:180px;">' +
            '<div style="font-size:11px;color:#7c2d12;font-weight:800;">' + esc(tr('report.ds.detail.monthlyKpiBillTotal')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#c2410c;font-weight:900;">' + fmtHK(Number(monthGrandTotal || 0)) + '</div>' +
          '</div>' +
          '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;min-width:200px;">' +
            '<div style="font-size:11px;color:#991b1b;font-weight:800;">' + esc(tr('report.ds.detail.monthlyKpiRemaining')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#dc2626;font-weight:900;">' + fmtHK(Number(totalOutstanding || 0)) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;padding:10px 12px;margin-bottom:12px;">' +
          '<div style="font-size:12px;font-weight:900;color:#0d6efd;margin-bottom:8px;">' + esc(tr('report.ds.monthly.paymentTotalsTitle')) + '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">' + methodSummary + '</div>' +
        '</div>' +
        sectionsHtml +
      '</div>';
  }

  function monthKeyOf(isoDate) {
    return String(isoDate || '').slice(0, 7);
  }

  var MONTH_SHORT_KEYS = [
    'report.month.jan', 'report.month.feb', 'report.month.mar', 'report.month.apr',
    'report.month.may', 'report.month.jun', 'report.month.jul', 'report.month.aug',
    'report.month.sep', 'report.month.oct', 'report.month.nov', 'report.month.dec'
  ];

  function monthShortLabel(monthIdx) {
    return tr(MONTH_SHORT_KEYS[monthIdx] || MONTH_SHORT_KEYS[0]);
  }

  function monthOptionsHTML(selectedYYYYMM) {
    var now = new Date();
    var year = now.getFullYear();
    var opts = MONTH_SHORT_KEYS.map(function (key, idx) {
      var mm = String(idx + 1).padStart(2, '0');
      var v = year + '-' + mm;
      var sel = (v === selectedYYYYMM) ? ' selected' : '';
      var label = trRepl('report.month.optionLabel', { M: monthShortLabel(idx), Y: String(year) });
      return '<option value="' + esc(v) + '"' + sel + '>' + esc(label) + '</option>';
    }).join('');
    return opts;
  }

  function drDisplayName(d) {
    if (!d) return '';
    if (typeof doctorDisplayName === 'function') return doctorDisplayName(d);
    return d.display_name || d.english_name || d.chinese_name || d.doctor_code || '';
  }

  function drOptionsHTML(selectedId) {
    if (!_drDailyDoctors.length) {
      return '<option value="">' + esc(tr('report.dr.noDoctorsOption')) + '</option>';
    }
    return _drDailyDoctors.map(function (d) {
      var id = d.id || '';
      var shown = drDisplayName(d) || tr('report.dr.doctorFallback');
      var sel = (id === selectedId) ? ' selected' : '';
      return '<option value="' + esc(id) + '"' + sel + '>' + esc(shown) + '</option>';
    }).join('');
  }

  function normName(v) {
    return String(v || '').trim().toLowerCase();
  }

  function doctorNameVariants(d) {
    var set = {};
    [d && d.display_name, d && d.english_name, d && d.chinese_name].forEach(function (v) {
      var n = normName(v);
      if (n) set[n] = true;
    });
    return set;
  }

  function monthEndISO(yyyyMm) {
    var s = String(yyyyMm || '');
    var m = /^(\d{4})-(\d{2})$/.exec(s);
    if (!m) return todayISO();
    var d = new Date(+m[1], +m[2], 0);
    return iso(d);
  }

  function doctorTagOf(d) {
    if (!d) return '';
    return String(d.doctor_code || '').trim();
  }

  function doctorTextVariants(d) {
    var set = {};
    [d && d.display_name, d && d.english_name, d && d.chinese_name, doctorTagOf(d),
      d && d.doctor_code ? ('[' + d.doctor_code + '] ' + (d.english_name || d.chinese_name || '')) : ''].forEach(function (v) {
      var n = normName(v);
      if (n) set[n] = true;
    });
    return set;
  }

  function billMatchesDoctor(b, d) {
    if (!b || !d) return false;
    if (b.doctor_id && d.id && String(b.doctor_id) === String(d.id)) return true;
    var variants = doctorTextVariants(d);
    var nTag = normName(b.doctor_tag);
    var nName = normName(b.doctor_name);
    return !!(variants[nTag] || variants[nName]);
  }

  function treatmentMatchesDoctor(t, d) {
    if (!t || !d) return false;
    if (t.doctor_id && d.id && String(t.doctor_id) === String(d.id)) return true;
    var variants = doctorTextVariants(d);
    var nTag = normName(t.doctor_tag);
    var nName = normName(t.doctor_name);
    var nDentist = normName(t.dentist_name);
    return !!(variants[nTag] || variants[nName] || variants[nDentist]);
  }

  function renderDrDailyShell() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;
    var day = _drDailyDate || (g('rptFrom') && g('rptFrom').value) || todayISO();
    _drDailyDate = day;

    if (!_drDailyDoctorId && _drDailyDoctors.length) {
      _drDailyDoctorId = _drDailyDoctors[0].id;
    }

    wrap.innerHTML =
      '<div style="padding:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(tr('report.dr.labelDoctor')) + '</div>' +
            '<select id="drDailyDoctorPick" onchange="REPORT.setDrDailyDoctor(this.value)" ' +
              'style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;min-width:220px;">' +
              drOptionsHTML(_drDailyDoctorId) +
            '</select>' +
            '<span style="width:1px;height:22px;background:#e5e7eb;display:inline-block;"></span>' +
            '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(tr('report.ds.labelDate')) + '</div>' +
            '<input type="date" id="drDailyDayPick" value="' + esc(day) + '" ' +
              'onchange="REPORT.setDrDailyDate(this.value)" ' +
              'style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;">' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drDailyMode === 'simple' ? 'var(--primary)' : '#64748b') + ';" onclick="REPORT.setDrDailyMode(\'simple\')">' + esc(tr('report.dr.modeSimple')) + '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drDailyMode === 'detail' ? '#0d6efd' : '#64748b') + ';display:inline-flex;align-items:center;gap:8px;" onclick="REPORT.toggleDrDailyDetail()">' +
              '<span>' + esc(tr('report.ds.btnDetailTx')) + '</span>' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:2px 8px;border-radius:999px;background:' + (_drDailyMode === 'detail' ? '#22c55e' : '#cbd5e1') + ';color:' + (_drDailyMode === 'detail' ? '#052e16' : '#334155') + ';font-size:11px;font-weight:900;">' + esc(_drDailyMode === 'detail' ? tr('report.ds.on') : tr('report.ds.off')) + '</span>' +
            '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drDailyMode === 'treatmentStats' ? '#7c3aed' : '#64748b') + ';" onclick="REPORT.setDrDailyMode(\'treatmentStats\')">' + esc(tr('report.dr.modeTreatmentStats')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div id="rptDrDailyBody" style="min-height:220px;"></div>' +
      '</div>';
  }

  async function buildDrDaily() {
    if (!_drDailyDoctors.length) {
      _drDailyDoctors = await loadDoctorsForReport();
    }
    if (!_drDailyDoctorId && _drDailyDoctors.length) {
      _drDailyDoctorId = _drDailyDoctors[0].id;
    }

    renderDrDailyShell();

    var body = g('rptDrDailyBody');
    if (!body) return;
    if (!_drDailyDoctorId) {
      body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noDoctorMsg')) + '</div>';
      _rows = [];
      return;
    }

    var day = _drDailyDate || todayISO();
    setDateInputs(day, day);

    var dr = _drDailyDoctors.find(function (d) { return d.id === _drDailyDoctorId; }) || null;

    var bills = await loadBillsLite(day, day);
    var treatments = await loadTreatmentsByDay(day);

    var treatmentsMatched = treatments.filter(function (t) {
      return treatmentMatchesDoctor(t, dr);
    });

    var tByPatient = {};
    treatmentsMatched.forEach(function (t) {
      var k = t.patient_id || '';
      if (!k) return;
      if (!tByPatient[k]) tByPatient[k] = [];
      tByPatient[k].push(t);
    });

    var directBills = bills.filter(function (b) { return billMatchesDoctor(b, dr); });
    var legacyBills = bills.filter(function (b) {
      if (billMatchesDoctor(b, dr)) return false;
      return !!tByPatient[b.patient_id];
    });
    var byBillId = {};
    directBills.concat(legacyBills).forEach(function (b) {
      var k = b.id || (String(b.patient_id || '') + '|' + String(b.created_at || '') + '|' + String(b.total || ''));
      byBillId[k] = b;
    });
    var filteredBills = Object.keys(byBillId).map(function (k) { return byBillId[k]; });
    var patientIds = filteredBills.map(function (b) { return b.patient_id; }).filter(Boolean);
    var pts = await loadPatientsByIds(patientIds);
    var pmap = {};
    pts.forEach(function (p) { pmap[p.id] = p; });

    var tx = filteredBills.map(function (b) {
      var paid = Number(b.amount_paid || 0);
      var total = Number(b.total || 0);
      var bal = (b.balance === null || b.balance === undefined) ? (total - paid) : Number(b.balance || 0);
      var p = pmap[b.patient_id] || {};
      return {
        bill_id: b.id || '',
        bill_date: b.bill_date || day,
        patient_no: b.patient_no || (p.patient_no || ''),
        patient_chinese: p.chinese_name || '',
        patient_name: (p.full_name || b.patient_name || ''),
        payment_method: reportPayMethodKey(b.bill_type),
        amount: total.toFixed(2),
        bill_total: total,
        bill_paid: paid,
        bill_balance: bal,
        treatment_items: b.items || '[]',
        remarks: b.notes || '',
        doctor_tag: b.doctor_tag || b.doctor_name || doctorTagOf(dr) || '',
        dr_treatments: tByPatient[b.patient_id] || []
      };
    });

    _rows = tx;
    var totals = sumByKey(tx, 'payment_method', 'amount');
    var grand = tx.reduce(function (acc, r) { return acc + Number(r.amount || 0); }, 0);

    if (_drDailyMode === 'detail') {
      body.innerHTML = '';
      var temp = document.createElement('div');
      temp.id = 'rptDailySummaryBody';
      body.appendChild(temp);
      renderDailySummaryDetailDaily(tx, totals, grand);
      return;
    }

    if (_drDailyMode === 'treatmentStats') {
      var byItem = {};
      var grandFreq = 0;
      var grandAmt = 0;
      tx.forEach(function (r) {
        var items = parseBillItems(r.treatment_items);
        items.forEach(function (it) {
          var qty = Number(it && it.qty ? it.qty : 0);
          var price = Number(it && it.price ? it.price : 0);
          var name = String(it && it.desc ? it.desc : tr('report.treat.defaultName'));
          var amt = qty * price;
          if (!byItem[name]) byItem[name] = { item_name: name, frequency: 0, amount_num: 0 };
          byItem[name].frequency += qty;
          byItem[name].amount_num += amt;
          grandFreq += qty;
          grandAmt += amt;
        });
      });
      var rows = Object.keys(byItem).map(function (k) {
        return {
          item_name: byItem[k].item_name,
          frequency: byItem[k].frequency,
          amount: byItem[k].amount_num.toFixed(2)
        };
      }).sort(function (a, b) {
        return Number(b.amount || 0) - Number(a.amount || 0);
      });
      if (!rows.length) {
        body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noBilledDay')) + '</div>';
        return;
      }
      var th = 'padding:10px 10px;background:#f3f0ff;color:#6d28d9;font-size:12px;font-weight:900;border-bottom:2px solid #e9ddff;text-align:left;';
      var td = 'padding:9px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top;';
      var rowsHtml = rows.map(function (r) {
        return '<tr>' +
          '<td style="' + td + 'font-weight:900;color:#0f172a;">' + esc(r.item_name) + '</td>' +
          '<td style="' + td + 'text-align:right;">' + esc(String(r.frequency || 0)) + '</td>' +
          '<td style="' + td + 'text-align:right;font-weight:900;">' + fmtHK(Number(r.amount)) + '</td>' +
        '</tr>';
      }).join('');
      body.innerHTML =
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="background:#f3f0ff;border:1px solid #e9ddff;border-radius:12px;padding:10px 12px;min-width:220px;">' +
            '<div style="font-size:11px;color:#6d28d9;font-weight:900;">' + esc(tr('report.drStats.todayItemGrandTotal')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#4c1d95;font-weight:900;">' + fmtHK(grandAmt) + '</div>' +
          '</div>' +
          '<div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:10px 12px;min-width:220px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:900;">' + esc(tr('report.drStats.todayTotalFreq')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0f172a;font-weight:900;">' + grandFreq + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="border:1px solid #e9ddff;border-radius:12px;overflow:hidden;background:#fff;">' +
          '<div style="overflow:auto;max-height:560px;">' +
            '<table style="width:100%;border-collapse:collapse;table-layout:fixed;">' +
              '<thead><tr>' +
                '<th style="' + th + '">' + esc(tr('report.drStats.thTreatmentItem')) + '</th>' +
                '<th style="' + th + 'width:160px;text-align:right;">' + esc(tr('report.drStats.thFrequency')) + '</th>' +
                '<th style="' + th + 'width:220px;text-align:right;">' + esc(tr('report.drStats.thTotalAmount')) + '</th>' +
              '</tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
      _rows = rows;
      return;
    }

    body.innerHTML = '';
    var temp2 = document.createElement('div');
    temp2.id = 'rptDailySummaryBody';
    body.appendChild(temp2);
    renderDailySummaryDaily(tx, totals, grand);
  }

  function renderDrMonthlyShell() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;
    var month = _drMonthlyMonth || monthKeyOf(todayISO());
    _drMonthlyMonth = month;
    if (!_drMonthlyDoctorId && _drDailyDoctorId) {
      _drMonthlyDoctorId = _drDailyDoctorId;
    }
    if (!_drMonthlyDoctorId && _drDailyDoctors.length) {
      _drMonthlyDoctorId = _drDailyDoctors[0].id;
    }
    wrap.innerHTML =
      '<div style="padding:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(tr('report.dr.labelDoctor')) + '</div>' +
            '<select onchange="REPORT.setDrMonthlyDoctor(this.value)" style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;min-width:220px;">' +
              drOptionsHTML(_drMonthlyDoctorId) +
            '</select>' +
            '<span style="width:1px;height:22px;background:#e5e7eb;display:inline-block;"></span>' +
            '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(tr('report.ds.labelMonth')) + '</div>' +
            '<select onchange="REPORT.setDrMonthlyMonth(this.value)" style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;min-width:150px;">' +
              monthOptionsHTML(month) +
            '</select>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drMonthlyMode === 'simple' ? 'var(--primary)' : '#64748b') + ';" onclick="REPORT.setDrMonthlyMode(\'simple\')">' + esc(tr('report.dr.modeSimple')) + '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drMonthlyMode === 'detail' ? '#0d6efd' : '#64748b') + ';display:inline-flex;align-items:center;gap:8px;" onclick="REPORT.toggleDrMonthlyDetail()">' +
              '<span>' + esc(tr('report.ds.btnDetailTx')) + '</span>' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:2px 8px;border-radius:999px;background:' + (_drMonthlyMode === 'detail' ? '#22c55e' : '#cbd5e1') + ';color:' + (_drMonthlyMode === 'detail' ? '#052e16' : '#334155') + ';font-size:11px;font-weight:900;">' + esc(_drMonthlyMode === 'detail' ? tr('report.ds.on') : tr('report.ds.off')) + '</span>' +
            '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drMonthlyMode === 'treatmentStats' ? '#7c3aed' : '#64748b') + ';" onclick="REPORT.setDrMonthlyMode(\'treatmentStats\')">' + esc(tr('report.dr.modeTreatmentStats')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div id="rptDrMonthlyBody" style="min-height:220px;"></div>' +
      '</div>';
  }

  async function buildDrMonthly() {
    if (!_drDailyDoctors.length) {
      _drDailyDoctors = await loadDoctorsForReport();
    }
    renderDrMonthlyShell();

    var body = g('rptDrMonthlyBody');
    if (!body) return;
    if (!_drMonthlyDoctorId) {
      body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noDoctorMsg')) + '</div>';
      _rows = [];
      return;
    }

    var month = _drMonthlyMonth || monthKeyOf(todayISO());
    var from = month + '-01';
    var to = monthEndISO(month);
    setDateInputs(from, to);

    var dr = _drDailyDoctors.find(function (d) { return d.id === _drMonthlyDoctorId; }) || null;
    var bills = await loadBillsLite(from, to);
    var filtered = bills.filter(function (b) { return billMatchesDoctor(b, dr); });

    if (!filtered.length) {
      body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noBilledMonth')) + '</div>';
      _rows = [];
      return;
    }

    // ───────────────────────────────────────────────────────
    // MODE: Treatment Statistics (monthly)
    // ───────────────────────────────────────────────────────
    if (_drMonthlyMode === 'treatmentStats') {
      var byItem = {};
      var grandItems = 0;
      var grandIncome = 0;
      filtered.forEach(function (b) {
        parseBillItems(b.items).forEach(function (it) {
          var name = String(it && it.desc ? it.desc : tr('report.treat.defaultName'));
          var qty = Number(it && it.qty ? it.qty : 0);
          var price = Number(it && it.price ? it.price : 0);
          var amt = qty * price;
          if (!byItem[name]) byItem[name] = { item: name, freq: 0, income: 0 };
          byItem[name].freq += qty;
          byItem[name].income += amt;
          grandItems += qty;
          grandIncome += amt;
        });
      });

      var rows = Object.keys(byItem).map(function (k) { return byItem[k]; })
        .sort(function (a, b) { return b.income - a.income; });

      if (!rows.length) {
        body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noBilledTreatmentMonth')) + '</div>';
        _rows = [];
        return;
      }

      _rows = rows.map(function (r) {
        return { item: r.item, frequency: r.freq, income: r.income.toFixed(2) };
      });

      var th = 'padding:10px 12px;background:#f3f0ff;color:#6d28d9;font-size:12px;font-weight:900;border-bottom:2px solid #e9ddff;text-align:left;';
      var td = 'padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:middle;';
      var rowsHtml = _rows.map(function (r) {
        return '<tr>' +
          '<td style="' + td + 'font-weight:900;color:#0f172a;">' + esc(r.item) + '</td>' +
          '<td style="' + td + 'text-align:right;">' + esc(String(r.frequency || 0)) + '</td>' +
          '<td style="' + td + 'text-align:right;font-weight:900;color:#6d28d9;">' + fmtHK(Number(r.income)) + '</td>' +
        '</tr>';
      }).join('');

      body.innerHTML =
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="background:#f3f0ff;border:1px solid #e9ddff;border-radius:12px;padding:10px 12px;min-width:220px;">' +
            '<div style="font-size:11px;color:#6d28d9;font-weight:900;">' + esc(tr('report.drStats.monthItemGrand')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#4c1d95;font-weight:900;">' + fmtHK(grandIncome) + '</div>' +
          '</div>' +
          '<div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:10px 12px;min-width:220px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:900;">' + esc(tr('report.drStats.monthTotalFreq')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0f172a;font-weight:900;">' + grandItems + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="border:1px solid #e9ddff;border-radius:12px;overflow:hidden;background:#fff;">' +
          '<div style="overflow:auto;max-height:560px;">' +
            '<table style="width:100%;border-collapse:collapse;min-width:720px;">' +
              '<thead><tr>' +
                '<th style="' + th + '">' + esc(tr('report.drStats.thTreatmentItem')) + '</th>' +
                '<th style="' + th + 'text-align:right;width:160px;">' + esc(tr('report.drStats.thFrequency')) + '</th>' +
                '<th style="' + th + 'text-align:right;width:200px;">' + esc(tr('report.drStats.thTotalIncome')) + '</th>' +
              '</tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
      return;
    }

    // Build transaction rows for Detail mode (reuse existing renderer)
    if (_drMonthlyMode === 'detail') {
      var patientIds = filtered.map(function (b) { return b.patient_id; }).filter(Boolean);
      var pts = await loadPatientsByIds(patientIds);
      var pmap = {};
      pts.forEach(function (p) { pmap[p.id] = p; });

      var tx = filtered.map(function (b) {
        var paid = Number(b.amount_paid || 0);
        var total = Number(b.total || 0);
        var bal = (b.balance === null || b.balance === undefined) ? (total - paid) : Number(b.balance || 0);
        var p = pmap[b.patient_id] || {};
        return {
          bill_id: b.id || '',
          bill_date: b.bill_date || '',
          patient_no: b.patient_no || (p.patient_no || ''),
          patient_chinese: p.chinese_name || '',
          patient_name: (p.full_name || b.patient_name || ''),
          payment_method: reportPayMethodKey(b.bill_type),
          amount: total.toFixed(2),
          bill_total: total,
          bill_paid: paid,
          bill_balance: bal,
          treatment_items: b.items || '[]',
          remarks: b.notes || ''
        };
      });

      _rows = tx;
      var totals = sumByKey(tx, 'payment_method', 'amount');
      var grand = tx.reduce(function (acc, r) { return acc + Number(r.amount || 0); }, 0);

      body.innerHTML = '';
      var temp = document.createElement('div');
      temp.id = 'rptDailySummaryBody';
      body.appendChild(temp);
      renderDailySummaryDetailDaily(tx, totals, grand);
      return;
    }

    var byDay = {};
    var total = 0;
    var paid = 0;
    var bal = 0;
    filtered.forEach(function (b) {
      var day = b.bill_date || from;
      var t = Number(b.total || 0);
      var p = Number(b.amount_paid || 0);
      var r = (b.balance === null || b.balance === undefined) ? (t - p) : Number(b.balance || 0);
      if (!byDay[day]) byDay[day] = { date: day, bills: 0, total: 0, paid: 0, balance: 0 };
      byDay[day].bills += 1;
      byDay[day].total += t;
      byDay[day].paid += p;
      byDay[day].balance += r;
      total += t;
      paid += p;
      bal += r;
    });

    _rows = Object.keys(byDay).sort().map(function (k) {
      var r = byDay[k];
      return {
        date: r.date,
        bills: String(r.bills),
        total: r.total.toFixed(2),
        paid: r.paid.toFixed(2),
        balance: r.balance.toFixed(2)
      };
    });

    var th = 'padding:10px 10px;background:#f0f7ff;color:#0d6efd;font-size:12px;font-weight:900;border-bottom:2px solid #dde8f5;text-align:left;';
    var td = 'padding:9px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top;';
    var rowsHtml = _rows.map(function (r) {
      return '<tr>' +
        '<td style="' + td + '">' + esc(r.date) + '</td>' +
        '<td style="' + td + 'text-align:right;">' + esc(r.bills) + '</td>' +
        '<td style="' + td + 'text-align:right;font-weight:900;">' + fmtHK(Number(r.total)) + '</td>' +
        '<td style="' + td + 'text-align:right;">' + fmtHK(Number(r.paid)) + '</td>' +
        '<td style="' + td + 'text-align:right;color:' + (Number(r.balance) > 0 ? '#dc2626' : '#16a34a') + ';">' + fmtHK(Number(r.balance)) + '</td>' +
      '</tr>';
    }).join('');

    body.innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
        '<div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:12px;padding:10px 12px;min-width:180px;">' +
          '<div style="font-size:11px;color:#155e75;font-weight:800;">' + esc(tr('report.drMonthly.kpiTotalBilled')) + '</div>' +
          '<div style="margin-top:2px;font-size:18px;color:#0e7490;font-weight:900;">' + fmtHK(total) + '</div>' +
        '</div>' +
        '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:10px 12px;min-width:180px;">' +
          '<div style="font-size:11px;color:#166534;font-weight:800;">' + esc(tr('report.drMonthly.kpiTotalPaid')) + '</div>' +
          '<div style="margin-top:2px;font-size:18px;color:#15803d;font-weight:900;">' + fmtHK(paid) + '</div>' +
        '</div>' +
        '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;min-width:180px;">' +
          '<div style="font-size:11px;color:#991b1b;font-weight:800;">' + esc(tr('report.drMonthly.kpiOutstanding')) + '</div>' +
          '<div style="margin-top:2px;font-size:18px;color:#dc2626;font-weight:900;">' + fmtHK(bal) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:auto;max-height:560px;background:#fff;">' +
        '<table style="width:100%;border-collapse:collapse;">' +
          '<thead><tr>' +
            '<th style="' + th + '">' + esc(tr('report.col.date')) + '</th>' +
            '<th style="' + th + 'text-align:right;">' + esc(tr('report.col.billCount')) + '</th>' +
            '<th style="' + th + 'text-align:right;">' + esc(tr('report.col.billed')) + '</th>' +
            '<th style="' + th + 'text-align:right;">' + esc(tr('report.col.paid')) + '</th>' +
            '<th style="' + th + 'text-align:right;">' + esc(tr('report.col.balance')) + '</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>';
  }

  async function buildDailySummary() {
    var from = g('rptFrom') ? g('rptFrom').value : todayISO();
    var to = g('rptTo') ? g('rptTo').value : todayISO();

    // Daily view uses a single selected date (from)
    if (_dailySummaryView === 'daily') {
      var day = _dailySummaryDate || from || todayISO();
      // Keep inputs aligned
      setDateInputs(day, day);
      var bills = await loadBillsLite(day, day);
      var patientIds = bills.map(function (b) { return b.patient_id; }).filter(Boolean);
      var pts = await loadPatientsByIds(patientIds);
      var pmap = {};
      pts.forEach(function (p) { pmap[p.id] = p; });

      var tx = bills.map(function (b) {
        var paid = Number(b.amount_paid || 0);
        var total = Number(b.total || 0);
        var bal = (b.balance === null || b.balance === undefined) ? (total - paid) : Number(b.balance || 0);
        var ref = String(b.id || '').trim();
        if (!ref) {
          var ct = String(b.created_at || '').replace(/\D/g, '');
          ref = ct ? ('TX-' + ct.slice(-10)) : 'N/A';
        }
        var p = pmap[b.patient_id] || {};
        var pClinicField = (typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined' && PATIENT_CLINIC_TAG_FIELD)
          ? PATIENT_CLINIC_TAG_FIELD
          : 'clinic_tag';
        var clinicTag = String(b.clinic_tag || p[pClinicField] || '').trim();
        return {
          bill_id: b.id || '',
          bill_ref: ref,
          bill_date: b.bill_date || day,
          patient_no: b.patient_no || (p.patient_no || ''),
          patient_chinese: p.chinese_name || '',
          patient_name: (p.full_name || b.patient_name || ''),
          payment_method: reportPayMethodKey(b.bill_type),
          amount: total.toFixed(2),
          bill_total: total,
          bill_paid: paid,
          bill_balance: bal,
          clinic_tag: clinicTag,
          clinic_code: clinicCodeFromStoredTag(clinicTag),
          treatment_items: b.items || '[]',
          remarks: b.notes || ''
        };
      });

      var totals = sumByKey(tx, 'payment_method', 'amount');
      var grand = tx.reduce(function (acc, r) { return acc + Number(r.amount || 0); }, 0);

      // expose for exportCSV
      _rows = tx;
      if (_dailySummaryDetailMode) {
        renderDailySummaryDetailDaily(tx, totals, grand);
      } else {
        renderDailySummaryDaily(tx, totals, grand);
      }
      return;
    }

    // Monthly view uses the month of "from"
    var monthKey = _dailySummaryMonth || monthKeyOf(from || todayISO()) || monthKeyOf(todayISO());
    var base = parseDateToLocal(monthKey + '-01');
    var first = firstDayOfMonth(base);
    var last = lastDayOfMonth(base);
    var fromM = iso(first);
    var toM = iso(last);
    setDateInputs(fromM, toM);

    var billsM = await loadBillsLite(fromM, toM);
    var patientIdsM = billsM.map(function (b) { return b.patient_id; }).filter(Boolean);
    var ptsM = await loadPatientsByIds(patientIdsM);
    var pmapM = {};
    ptsM.forEach(function (p) { pmapM[p.id] = p; });

    // group by bill_date
    var groups = {};
    var order = [];
    billsM.forEach(function (b) {
      var d = String(b.bill_date || '');
      if (!groups[d]) { groups[d] = []; order.push(d); }
      groups[d].push(b);
    });
    order.sort(); // 1st -> last

    var monthAllTx = [];
    var dayCards = order.map(function (d) {
      var rows = (groups[d] || []).map(function (b) {
        var paid = Number(b.amount_paid || 0);
        var total = Number(b.total || 0);
        var bal = (b.balance === null || b.balance === undefined) ? (total - paid) : Number(b.balance || 0);
        var ref = String(b.id || '').trim();
        if (!ref) {
          var ct = String(b.created_at || '').replace(/\D/g, '');
          ref = ct ? ('TX-' + ct.slice(-10)) : 'N/A';
        }
        var p = pmapM[b.patient_id] || {};
        var pClinicField = (typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined' && PATIENT_CLINIC_TAG_FIELD)
          ? PATIENT_CLINIC_TAG_FIELD
          : 'clinic_tag';
        var clinicTag = String(b.clinic_tag || p[pClinicField] || '').trim();
        var txRow = {
          bill_id: b.id || '',
          bill_ref: ref,
          bill_date: b.bill_date || d,
          patient_no: b.patient_no || (p.patient_no || ''),
          patient_chinese: p.chinese_name || '',
          patient_name: (p.full_name || b.patient_name || ''),
          payment_method: reportPayMethodKey(b.bill_type),
          amount: total.toFixed(2),
          bill_total: total,
          bill_paid: paid,
          bill_balance: bal,
          clinic_tag: clinicTag,
          clinic_code: clinicCodeFromStoredTag(clinicTag),
          treatment_items: b.items || '[]',
          remarks: b.notes || ''
        };
        monthAllTx.push(txRow);
        return txRow;
      });
      var total = rows.reduce(function (acc, r) { return acc + Number(r.amount || 0); }, 0);
      return { date: d, total: total, rows: rows };
    });

    var totalsByMethodM = sumByKey(monthAllTx, 'payment_method', 'amount');
    var grandM = monthAllTx.reduce(function (acc, r) { return acc + Number(r.amount || 0); }, 0);

    _rows = monthAllTx;
    if (_dailySummaryDetailMode) {
      renderDailySummaryDetailMonthly(dayCards, totalsByMethodM, grandM);
    } else {
      renderDailySummaryMonthly(dayCards, totalsByMethodM, grandM);
    }
  }

  function renderDailySummaryShell() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;

    var today = todayISO();
    var dailyDate = _dailySummaryDate || (g('rptFrom') && g('rptFrom').value) || today;
    _dailySummaryDate = dailyDate;

    var curMonth = _dailySummaryMonth || monthKeyOf((g('rptFrom') && g('rptFrom').value) || today) || monthKeyOf(today);
    _dailySummaryMonth = curMonth;

    var pickerHtml = '';
    if (_dailySummaryView === 'daily') {
      pickerHtml =
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(tr('report.ds.labelDate')) + '</div>' +
          '<input type="date" id="dsDayPick" value="' + esc(dailyDate) + '" ' +
            'onchange="REPORT.setDailySummaryDate(this.value)" ' +
            'style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;">' +
        '</div>';
    } else {
      pickerHtml =
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(tr('report.ds.labelMonth')) + '</div>' +
          '<select id="dsMonthPick" onchange="REPORT.setDailySummaryMonth(this.value)" ' +
            'style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;">' +
            monthOptionsHTML(curMonth) +
          '</select>' +
        '</div>';
    }

    wrap.innerHTML =
      '<div style="padding:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_dailySummaryView === 'daily' ? 'var(--primary)' : 'var(--gray)') + ';" ' +
              'onclick="REPORT.setDailySummaryView(\'daily\')">' + esc(tr('report.ds.btnDaily')) + '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_dailySummaryView === 'monthly' ? 'var(--primary)' : 'var(--gray)') + ';" ' +
              'onclick="REPORT.setDailySummaryView(\'monthly\')">' + esc(tr('report.ds.btnMonthly')) + '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_dailySummaryDetailMode ? '#0d6efd' : '#64748b') + ';display:inline-flex;align-items:center;gap:8px;" ' +
              'onclick="REPORT.toggleDailySummaryDetail()">' +
              '<span>' + esc(tr('report.ds.btnDetailTx')) + '</span>' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:2px 8px;border-radius:999px;background:' + (_dailySummaryDetailMode ? '#22c55e' : '#cbd5e1') + ';color:' + (_dailySummaryDetailMode ? '#052e16' : '#334155') + ';font-size:11px;font-weight:900;">' + esc(_dailySummaryDetailMode ? tr('report.ds.on') : tr('report.ds.off')) + '</span>' +
            '</button>' +
            '<span style="width:1px;height:22px;background:#e5e7eb;display:inline-block;"></span>' +
            pickerHtml +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:#22c55e;" onclick="REPORT.printDailySummary()">' + esc(tr('report.ds.btnPrint')) + '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:#64748b;" onclick="REPORT.exportDailySummaryExcel()">' + esc(tr('report.ds.btnExportCsv')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div id="rptDailySummaryBody" style="min-height:200px;"></div>' +
      '</div>';
  }

  function auditFmtLocale() {
    return (typeof appUiLocale === 'function') ? appUiLocale() : 'en-HK';
  }

  function auditFmtServerDate(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  function auditFmtTime(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(auditFmtLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function auditDistinctValues(rows, key) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function(r) {
      var v = String(r[key] || '').trim();
      if (!v || seen[v]) return;
      seen[v] = 1;
      out.push(v);
    });
    out.sort();
    return out;
  }

  function renderAuditTrailShell() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div id="rptAuditShell">' +
        '<div class="rpt-audit-filters" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:10px 12px;background:#f8fafc;border:1px solid #e8eef5;border-radius:10px;margin-bottom:12px;">' +
          '<div><div style="font-size:11px;font-weight:800;color:#555;margin-bottom:4px;" data-i18n="report.audit.filterItem"></div>' +
            '<select id="rptAuditItemFilter" style="padding:7px 10px;border:1px solid #ddd;border-radius:8px;min-width:220px;"></select></div>' +
          '<div><div style="font-size:11px;font-weight:800;color:#555;margin-bottom:4px;" data-i18n="report.audit.filterUser"></div>' +
            '<select id="rptAuditUserFilter" style="padding:7px 10px;border:1px solid #ddd;border-radius:8px;min-width:160px;"></select></div>' +
          '<div style="margin-left:auto;font-size:11px;color:#64748b;text-align:right;" id="rptAuditFilterSummary">—</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:12px;align-items:stretch;">' +
          '<div id="rptAuditList" style="border:1px solid #eee;border-radius:10px;overflow:hidden;min-height:320px;">' +
            '<div style="padding:12px;color:#888;">' + esc(tr('report.loading')) + '</div>' +
          '</div>' +
          '<div id="rptAuditDetail" style="border:1px solid #eee;border-radius:10px;background:#fafcff;min-height:320px;">' +
            '<div style="padding:14px;color:#888;font-size:12px;" data-i18n="report.audit.detailPlaceholder"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(wrap);
    var itemSel = g('rptAuditItemFilter');
    var userSel = g('rptAuditUserFilter');
    if (itemSel) {
      itemSel.onchange = function() {
        _auditFilterItem = itemSel.value || '';
        renderAuditTrailList();
        updateAuditFilterSummary();
      };
    }
    if (userSel) {
      userSel.onchange = function() {
        _auditFilterUser = userSel.value || '';
        renderAuditTrailList();
        updateAuditFilterSummary();
      };
    }
  }

  function updateAuditFilterSummary() {
    var el = g('rptAuditFilterSummary');
    if (!el) return;
    var clinic = reportClinicTag() || tr('report.audit.allClinics');
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : '';
    var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : '';
    var item = _auditFilterItem || tr('report.audit.allItems');
    var user = _auditFilterUser || tr('report.audit.allUsers');
    el.innerHTML =
      esc(clinic) + '<br>' +
      esc(from) + ' – ' + esc(to) + '<br>' +
      esc(item) + '<br>' +
      esc(user);
  }

  function fillAuditFilterSelects() {
    var itemSel = g('rptAuditItemFilter');
    var userSel = g('rptAuditUserFilter');
    var items = auditDistinctValues(_auditAllRows, 'audit_item');
    var users = auditDistinctValues(_auditAllRows, 'user_id');
    if (itemSel) {
      var ih = '<option value="">' + esc(tr('report.audit.allItems')) + '</option>';
      items.forEach(function(it) {
        ih += '<option value="' + esc(it) + '">' + esc(it) + '</option>';
      });
      itemSel.innerHTML = ih;
      itemSel.value = _auditFilterItem || '';
    }
    if (userSel) {
      var uh = '<option value="">' + esc(tr('report.audit.allUsers')) + '</option>';
      users.forEach(function(uid) {
        var label = uid;
        (_auditAllRows || []).some(function(r) {
          if (r.user_id === uid && r.user_name) {
            label = r.user_name + ' (' + uid + ')';
            return true;
          }
          return false;
        });
        uh += '<option value="' + esc(uid) + '">' + esc(label) + '</option>';
      });
      userSel.innerHTML = uh;
      userSel.value = _auditFilterUser || '';
    }
    updateAuditFilterSummary();
  }

  function filteredAuditRows() {
    return (_auditAllRows || []).filter(function(r) {
      if (_auditFilterItem && r.audit_item !== _auditFilterItem) return false;
      if (_auditFilterUser && r.user_id !== _auditFilterUser) return false;
      return true;
    });
  }

  function renderAuditDetail(row) {
    var panel = g('rptAuditDetail');
    if (!panel) return;
    if (!row) {
      panel.innerHTML = '<div style="padding:14px;color:#888;font-size:12px;">' + esc(tr('report.audit.detailPlaceholder')) + '</div>';
      return;
    }
    var detail = row.changes_detail || '';
    if (!detail && row.payload) {
      try {
        detail = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload, null, 2);
      } catch (eJson) {
        detail = String(row.payload);
      }
    }
    panel.innerHTML =
      '<div style="padding:12px 14px;border-bottom:1px solid #e8eef5;background:#f0f7ff;">' +
        '<div style="font-size:13px;font-weight:900;color:#0d6efd;">' + esc(row.audit_item || '') + '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:4px;">' +
          esc(auditFmtServerDate(row.created_at)) + ' ' + esc(auditFmtTime(row.created_at)) +
          (row.user_name || row.user_id ? ' · ' + esc(row.user_name || row.user_id) : '') +
        '</div>' +
      '</div>' +
      '<pre style="margin:0;padding:12px 14px;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;font-family:Consolas,Monaco,monospace;">' +
        esc(detail || tr('report.audit.noDetail')) +
      '</pre>';
  }

  function selectAuditRow(id) {
    _auditSelectedId = id || null;
    var row = null;
    (_auditAllRows || []).some(function(r) {
      if (r.id === id) {
        row = r;
        return true;
      }
      return false;
    });
    renderAuditTrailList();
    renderAuditDetail(row);
  }

  function renderAuditTrailList() {
    var list = g('rptAuditList');
    if (!list) return;
    if (_auditTableMissing) {
      list.innerHTML = '<div style="padding:16px;color:#b45309;font-size:13px;line-height:1.5;">' +
        esc(tr('report.audit.tableMissing')) + '</div>';
      return;
    }
    var rows = filteredAuditRows();
    _rows = rows.map(function(r) {
      return {
        id: r.id,
        audit_date: auditFmtServerDate(r.created_at),
        audit_time: auditFmtTime(r.created_at),
        server_date: auditFmtServerDate(r.created_at),
        computer: r.client_host || '',
        clinic: r.clinic_tag || '',
        user: r.user_name || r.user_id || '',
        audit_item: r.audit_item || ''
      };
    });
    if (!rows.length) {
      list.innerHTML = '<div style="padding:16px;color:#888;">' + esc(tr('report.noData')) + '</div>';
      renderAuditDetail(null);
      return;
    }
    var th = 'padding:8px 10px;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;border-bottom:2px solid #dde8f5;text-align:left;white-space:nowrap;';
    var td = 'padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;vertical-align:top;';
    var html = '<div style="overflow:auto;max-height:480px;"><table style="width:100%;border-collapse:collapse;min-width:720px;"><thead><tr>' +
      '<th style="' + th + '">' + esc(tr('report.audit.col.time')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.audit.col.serverDate')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.audit.col.computer')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.audit.col.clinic')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.audit.col.user')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.audit.col.item')) + '</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function(r) {
      var sel = (_auditSelectedId === r.id);
      var bg = sel ? '#dbeafe' : '#fff';
      html += '<tr data-audit-id="' + esc(String(r.id)) + '" style="cursor:pointer;background:' + bg + ';" onclick="REPORT.selectAuditRow(this.getAttribute(\'data-audit-id\'))">' +
        '<td style="' + td + '">' + esc(auditFmtTime(r.created_at)) + '</td>' +
        '<td style="' + td + '">' + esc(auditFmtServerDate(r.created_at)) + '</td>' +
        '<td style="' + td + '">' + esc(r.client_host || '') + '</td>' +
        '<td style="' + td + '">' + esc(r.clinic_tag || '') + '</td>' +
        '<td style="' + td + '">' + esc(r.user_name || r.user_id || '') + '</td>' +
        '<td style="' + td + '">' + esc(r.audit_item || '') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    list.innerHTML = html;
    if (!_auditSelectedId && rows.length) {
      selectAuditRow(rows[0].id);
    } else {
      var active = null;
      rows.some(function(r) {
        if (r.id === _auditSelectedId) {
          active = r;
          return true;
        }
        return false;
      });
      renderAuditDetail(active);
    }
  }

  async function loadAuditTrail() {
    _auditTableMissing = false;
    _auditAllRows = [];
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : todayISO();
    var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : todayISO();
    var clinic = reportClinicTag();
    var q = SB.from('audit_trail')
      .select('*')
      .gte('created_at', from + 'T00:00:00')
      .lte('created_at', to + 'T23:59:59.999')
      .order('created_at', { ascending: false })
      .limit(3000);
    if (clinic) q = q.eq('clinic_tag', clinic);
    var res = await q;
    if (res.error) {
      var msg = (res.error.message || '').toLowerCase();
      if (msg.indexOf('does not exist') >= 0 || msg.indexOf('not found') >= 0 || msg.indexOf('404') >= 0) {
        _auditTableMissing = true;
        return;
      }
      throw new Error(res.error.message || tr('report.error.loadingDataNote'));
    }
    _auditAllRows = res.data || [];
    fillAuditFilterSelects();
    renderAuditTrailList();
  }

  async function refresh() {
    setDefaultDates();
    var from = g('rptFrom') ? g('rptFrom').value : todayISO();
    var to = g('rptTo') ? g('rptTo').value : todayISO();

    // clear + loading placeholders
    _rows = [];
    destroyChart();
    if (g('rptTableWrap')) {
      g('rptTableWrap').innerHTML = '<div style="padding:12px;color:#888;">' + esc(tr('report.loading')) + '</div>';
    }
    setChartNote(tr('report.loading'));

    try {
      if (_tab === 'auditTrail') {
        showPatientDirTools(false);
        setHeader(tr('report.title.auditTrail'), tr('report.hint.auditTrail'));
        showChartColumn(false);
        destroyChart();
        setChartNote(tr('report.chart.disabledAuditTrail'));
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
        var gridA = g('rptMainGrid');
        var colA = g('rptChartCol');
        if (gridA) gridA.style.gridTemplateColumns = '1fr';
        if (colA) colA.style.display = 'none';
        renderAuditTrailShell();
        await loadAuditTrail();
        return;
      }

      if (_tab === 'dailySummary') {
        showPatientDirTools(false);
        setHeader(tr('report.title.dailySummary'), tr('report.hint.dailySummary'));

        // Charts not used for this subtab
        showChartColumn(false);
        destroyChart();
        setChartNote(tr('report.chart.disabledDailySummary'));

        // Hide print buttons (keep Output CSV)
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = 'none';
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';

        renderDailySummaryShell();
        await buildDailySummary();
        return;
      }

      if (_tab === 'patientDir') {
        wirePatientDirToolsOnce();
        showPatientDirTools(true);
        // Admin-only gate
        if (typeof currentRole !== 'undefined' && currentRole !== 'admin') {
          showPatientDirTools(false);
          setHeader(tr('report.title.patientDir'), tr('report.hint.patientDirAdmin'));
          _rows = [];
          renderTable([{ key: 'note', label: tr('report.col.info') }], [{ note: tr('report.patientDir.adminOnlyNote') }]);
          // Hide chart + print buttons
          if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = 'none';
          if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
          var gridD = g('rptMainGrid');
          var colD = g('rptChartCol');
          if (gridD) gridD.style.gridTemplateColumns = '1fr';
          if (colD) colD.style.display = 'none';
          destroyChart();
          setChartNote(tr('report.chart.disabledGenericTab'));
          return;
        }

        setHeader(tr('report.title.patientDir'), tr('report.hint.patientDir'));

        // Hide print buttons for this tab
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = 'none';
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';

        var pts = await loadPatients();
        var mappedRows = pts.map(function (p) {
          return {
            patient_no: p.patient_no || '',
            full_name: p.full_name || '',
            chinese_name: p.chinese_name || '',
            phone: p.phone_number || '',
            clinic_tag: p[PATIENT_CLINIC_TAG_FIELD] || '',
            dob: p.dob || '',
            hkid: p.hkid || '',
            email: p.email || '',
            sex: p.sex || '',
            address: p.address || '',
            alerts: p.medical_alerts || '',
            remarks: p.remarks || ''
          };
        });
        _rows = applyPatientDirFilterSort(mappedRows);
        renderTable([
          { key: 'patient_no', label: tr('report.col.patientNo') },
          { key: 'full_name', label: tr('report.col.name') },
          { key: 'chinese_name', label: tr('report.col.chinese') },
          { key: 'phone', label: tr('report.col.phone') },
          { key: 'clinic_tag', label: tr('report.col.clinicTag') },
          { key: 'dob', label: tr('report.col.dob') },
          { key: 'hkid', label: tr('report.col.hkid') },
          { key: 'email', label: tr('report.col.email') },
          { key: 'sex', label: tr('report.col.sex') },
          { key: 'address', label: tr('report.col.address') },
          { key: 'alerts', label: tr('report.col.alerts') },
          { key: 'remarks', label: tr('report.col.remarks') }
        ], _rows);
        // Disable charts for patient directory
        var grid = g('rptMainGrid');
        var col = g('rptChartCol');
        if (grid) grid.style.gridTemplateColumns = '1fr';
        if (col) col.style.display = 'none';
        destroyChart();
        setChartNote(tr('report.chart.disabledPatientDir'));
        return;
      }

      // Ensure chart column visible for other tabs
      showPatientDirTools(false);
      var grid2 = g('rptMainGrid');
      var col2 = g('rptChartCol');
      if (grid2) grid2.style.gridTemplateColumns = '1fr 360px';
      if (col2) col2.style.display = 'block';

      // Show print buttons on other tabs
      if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
      if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = '';

      var bills = await loadBills(from, to);

      if (_tab === 'dailyIncome') {
        setHeader(tr('report.title.dailyIncome'), tr('report.hint.dailyIncome'));
        var grouped = groupSumBy(bills, function (b) { return b.bill_date || ''; }, function (b) { return Number(b.total || 0); });
        _rows = grouped.map(function (g) { return { date: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'date', label: tr('report.col.date') }, { key: 'total', label: tr('report.col.totalHkd') }], _rows);
        renderChartFromRows('date', 'total');
        return;
      }

      if (_tab === 'weeklyIncome') {
        setHeader(tr('report.title.weeklyIncome'), tr('report.hint.weeklyIncome'));
        var groupedW = groupSumBy(bills, function (b) {
          var d = parseDateToLocal(b.bill_date || todayISO());
          var day = d.getDay(); // 0 Sun..6 Sat (local)
          var diffToFri = (day - 5 + 7) % 7; // days since Friday
          d.setDate(d.getDate() - diffToFri);
          // Use local YYYY-MM-DD to avoid timezone shifting (Fri -> Thu in UTC)
          return iso(d); // block start (Friday)
        }, function (b) { return Number(b.total || 0); });
        _rows = groupedW.map(function (g) { return { week_start: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'week_start', label: tr('report.col.weekStart') }, { key: 'total', label: tr('report.col.totalHkd') }], _rows);
        renderChartFromRows('week_start', 'total');
        return;
      }

      if (_tab === 'monthlyIncome') {
        setHeader(tr('report.title.monthlyIncome'), tr('report.hint.monthlyIncome'));
        var groupedM = groupSumBy(bills, function (b) { return String(b.bill_date || '').slice(0, 7); }, function (b) { return Number(b.total || 0); });
        _rows = groupedM.map(function (g) { return { month: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'month', label: tr('report.col.month') }, { key: 'total', label: tr('report.col.totalHkd') }], _rows);
        renderChartFromRows('month', 'total');
        return;
      }

      if (_tab === 'payStats') {
        setHeader(tr('report.title.payStats'), tr('report.hint.payStats'));
        var groupedP = groupSumBy(bills, function (b) { return reportPayMethodKey(b.bill_type); }, function (b) { return Number(b.total || 0); });
        _rows = groupedP.map(function (g) { return { method: dispPayMethod(g.key), total: g.value.toFixed(2) }; });
        renderTable([{ key: 'method', label: tr('report.col.paymentMethod') }, { key: 'total', label: tr('report.col.totalHkd') }], _rows);
        renderChartFromRows('method', 'total');
        return;
      }

      if (_tab === 'txStats') {
        setHeader(tr('report.title.txStats'), tr('report.hint.txStats'));
        var items = [];
        bills.forEach(function (b) {
          parseBillItems(b.items).forEach(function (it) {
            items.push({
              desc: it.desc || tr('report.unknown'),
              qty: Number(it.qty || 0),
              amount: Number(it.qty || 0) * Number(it.price || 0)
            });
          });
        });
        var byDesc = {};
        items.forEach(function (it) {
          var k = it.desc;
          if (!byDesc[k]) byDesc[k] = { item: k, qty: 0, amount: 0 };
          byDesc[k].qty += it.qty;
          byDesc[k].amount += it.amount;
        });
        _rows = Object.keys(byDesc)
          .map(function (k) { return byDesc[k]; })
          .sort(function (a, b) { return b.amount - a.amount; })
          .slice(0, 40)
          .map(function (r) {
            return { item: r.item, qty: r.qty, amount: r.amount.toFixed(2) };
          });
        renderTable(
          [{ key: 'item', label: tr('report.col.item') }, { key: 'qty', label: tr('report.col.qty') }, { key: 'amount', label: tr('report.col.amountHkd') }],
          _rows
        );
        renderChartFromRows('item', 'amount');
        return;
      }

      if (_tab === 'drDaily') {
        setHeader(tr('report.title.drDaily'), tr('report.hint.drDaily'));
        showChartColumn(false);
        destroyChart();
        setChartNote(tr('report.chart.disabledDrDaily'));
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        await buildDrDaily();
        return;
      }

      if (_tab === 'drMonthly') {
        setHeader(tr('report.title.drMonthly'), tr('report.hint.drMonthly'));
        showChartColumn(false);
        destroyChart();
        setChartNote(tr('report.chart.disabledDrMonthly'));
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        await buildDrMonthly();
        return;
      }

      // fallback
      setHeader(tr('report.title.default'), tr('report.hint.default'));
      setChartNote('—');
    } catch (e) {
      renderTable([{ key: 'err', label: tr('report.col.error') }], [{ err: e.message }]);
      setChartNote(tr('report.error.loadingDataNote'));
    }
  }

  function switchTab(key) {
    // Admin-only tab gate
    if (key === 'patientDir' && typeof currentRole !== 'undefined' && currentRole !== 'admin') {
      alert(tr('report.alert.patientDirAdminOnly'));
      key = 'dailyIncome';
    }
    _tab = key;
    if (key === 'drDaily') _drDailyMode = 'simple';
    if (key === 'drMonthly') _drMonthlyMode = 'simple';

    // highlight left buttons (reuse cfg-nav-item style)
    document.querySelectorAll('#reportSection [data-rpt]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-rpt') === key);
    });

    // Apply preset date ranges for key tabs so they load
    // with useful defaults immediately on open.
    applyPresetDatesForTab(key);
    refresh();
  }

  function wireReportTabButtons() {
    if (_reportTabsWired) return;
    var section = g('reportSection');
    if (!section) return;
    section.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-rpt]') : null;
      if (!btn) return;
      var key = btn.getAttribute('data-rpt');
      if (!key) return;
      e.preventDefault();
      switchTab(key);
    });
    _reportTabsWired = true;
  }

  function init() {
    if (typeof initReportModuleClinic === 'function') initReportModuleClinic();
    refreshReportChartTypeSelect();
    wireReportTabButtons();
    setDefaultDates();
    switchTab(_tab);
    _reportInitialized = true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    refreshReportChartTypeSelect();
  });

  document.addEventListener('app-lang-change', function () {
    refreshReportChartTypeSelect();
    var sec = g('reportSection');
    if (sec && typeof applyI18nInRoot === 'function') {
      if (_reportInitialized || sec.style.display !== 'none') {
        applyI18nInRoot(sec);
      }
    }
    if (_reportInitialized) refresh();
  });

  return {
    init: init,
    isInitialized: function () { return _reportInitialized; },
    switchTab: switchTab,
    refresh: refresh,
    printTable: printTable,
    printChart: printChart,
    magnifyChart: magnifyChart,
    exportCSV: exportCSV,
    selectAuditRow: selectAuditRow,
    setDailySummaryView: function (v) {
      _dailySummaryView = (v === 'monthly') ? 'monthly' : 'daily';
      if (_tab === 'dailySummary') refresh();
    },
    setDailySummaryDetailMode: function (on) {
      _dailySummaryDetailMode = !!on;
      if (_tab === 'dailySummary') refresh();
    },
    toggleDailySummaryDetail: function () {
      _dailySummaryDetailMode = !_dailySummaryDetailMode;
      if (_tab === 'dailySummary') refresh();
    },
    setDailySummaryDate: function (d) {
      _dailySummaryDate = String(d || '').slice(0, 10) || todayISO();
      if (_tab === 'dailySummary') refresh();
    },
    setDailySummaryMonth: function (yyyyMm) {
      _dailySummaryMonth = String(yyyyMm || '').slice(0, 7) || monthKeyOf(todayISO());
      if (_tab === 'dailySummary') refresh();
    },
    setDrDailyDoctor: function (doctorId) {
      _drDailyDoctorId = doctorId || null;
      if (_tab === 'drDaily') refresh();
    },
    setDrDailyDate: function (dayIso) {
      _drDailyDate = String(dayIso || '').slice(0, 10) || todayISO();
      if (_tab === 'drDaily') refresh();
    },
    setDrDailyMode: function (mode) {
      _drDailyMode = (mode === 'detail' || mode === 'treatmentStats') ? mode : 'simple';
      if (_tab === 'drDaily') refresh();
    },
    toggleDrDailyDetail: function () {
      _drDailyMode = (_drDailyMode === 'detail') ? 'simple' : 'detail';
      if (_tab === 'drDaily') refresh();
    },
    setDrMonthlyMode: function (mode) {
      _drMonthlyMode = (mode === 'detail' || mode === 'treatmentStats') ? mode : 'simple';
      if (_tab === 'drMonthly') refresh();
    },
    toggleDrMonthlyDetail: function () {
      _drMonthlyMode = (_drMonthlyMode === 'detail') ? 'simple' : 'detail';
      if (_tab === 'drMonthly') refresh();
    },
    setDrMonthlyDoctor: function (doctorId) {
      _drMonthlyDoctorId = doctorId || null;
      if (_tab === 'drMonthly') refresh();
    },
    setDrMonthlyMonth: function (yyyyMm) {
      _drMonthlyMonth = String(yyyyMm || '').slice(0, 7) || monthKeyOf(todayISO());
      if (_tab === 'drMonthly') refresh();
    },
    exportDailySummaryExcel: function () {
      var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : tr('report.fallback.dailySummary');
      var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : todayISO();
      var suffix = (_dailySummaryView === 'monthly') ? ('monthly_' + monthKeyOf(from)) : ('daily_' + from);
      downloadCSV('daily_summary_' + suffix + '.csv', [
        { key: 'patient_no', label: tr('report.csv.patientNo') },
        { key: 'patient_chinese', label: tr('report.csv.patientChinese') },
        { key: 'patient_name', label: tr('report.csv.patientEnglish') },
        { key: 'payment_method', label: tr('report.csv.paymentMethod') },
        { key: 'amount', label: tr('report.csv.amount') },
        { key: 'remarks', label: tr('report.csv.remarks') }
      ], _rows);
    },
    printDailySummary: printDailySummary,
    renderChart: function () {
      // re-render chart based on current tab’s inferred label/value keys
      if (_tab === 'dailyIncome') return renderChartFromRows('date', 'total');
      if (_tab === 'weeklyIncome') return renderChartFromRows('week_start', 'total');
      if (_tab === 'monthlyIncome') return renderChartFromRows('month', 'total');
      if (_tab === 'payStats') return renderChartFromRows('method', 'total');
      if (_tab === 'txStats') return renderChartFromRows('item', 'amount');
      setChartNote(tr('report.chart.noChartThisTab'));
    }
  };
})();
