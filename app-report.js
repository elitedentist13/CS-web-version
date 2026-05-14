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

  function g(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    if (g('rptHint')) g('rptHint').textContent = hint || '—';
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
      wrap.innerHTML = '<div style="padding:12px;color:#888;">No data.</div>';
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
        html += '<td style="' + td + '">' + esc(v === null || v === undefined ? '' : v) + '</td>';
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
      setChartNote('Chart.js not loaded.');
      return;
    }

    if (!_rows || !_rows.length) {
      setChartNote('No data to chart.');
      return;
    }

    var type = (g('rptChartType') && g('rptChartType').value) ? g('rptChartType').value : 'bar';
    var labels = _rows.map(function (r) { return String(r[labelKey] || ''); });
    var values = _rows.map(function (r) { return Number(r[valueKey] || 0); });
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : 'Report';
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : '';
    var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : '';
    var clinic = (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) ? currentClinicLabel : '';
    var doctor = (typeof currentDoctorName !== 'undefined' && currentDoctorName) ? currentDoctorName : '';
    var genAt = new Date().toLocaleString();

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
              (from && to) ? ('Date: ' + from + ' → ' + to) : '',
              clinic ? ('Clinic: ' + clinic) : '',
              doctor ? ('Doctor: ' + doctor) : '',
              'Generated: ' + genAt
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

    setChartNote('Graph rendered from table.');
  }

  function openPrintWindow(title, bodyHtml, extraCss) {
    var w = window.open('', '_blank', 'width=980,height=720,scrollbars=1,resizable=1');
    if (!w) {
      alert('Please allow popups to print.');
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
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : 'Report Table';
    // Print the current table region (best effort)
    var html =
      '<h1>' + esc(title) + ' — Table</h1>' +
      '<div>' + wrap.innerHTML + '</div>';
    openPrintWindow(title + ' - Table', html, 'table{width:100%;border-collapse:collapse;}');
  }

  function printChart() {
    var canvas = g('rptChart');
    if (!canvas) return;
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : 'Report Chart';
    try {
      var dataUrl = canvas.toDataURL('image/png', 1.0);
      var html =
        '<h1>' + esc(title) + ' — Chart</h1>' +
        '<div style="margin-top:10px;">' +
          '<img src="' + dataUrl + '" style="max-width:100%;height:auto;border:1px solid #eee;border-radius:10px;">' +
        '</div>';
      openPrintWindow(title + ' - Chart', html);
    } catch (e) {
      alert('Unable to print chart: ' + e.message);
    }
  }

  function printDailySummary() {
    var body = g('rptDailySummaryBody');
    if (!body) return;
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : 'Daily Summary';
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : todayISO();
    var viewLabel = _dailySummaryView === 'monthly' ? ('Monthly (' + monthKeyOf(from) + ')') : ('Daily (' + from + ')');
    var clinic = (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) ? currentClinicLabel : '';
    var doctor = (typeof currentDoctorName !== 'undefined' && currentDoctorName) ? currentDoctorName : '';
    var header =
      '<h1>' + esc(title) + ' — ' + esc(viewLabel) + '</h1>' +
      '<div style="color:#666;font-size:12px;margin-bottom:12px;">' +
        (clinic ? ('Clinic: ' + esc(clinic) + ' &nbsp;|&nbsp; ') : '') +
        (doctor ? ('Doctor: ' + esc(doctor) + ' &nbsp;|&nbsp; ') : '') +
        'Generated: ' + esc(new Date().toLocaleString()) +
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
    var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : 'Report Chart';
    var w = window.open('', '_blank', 'width=1200,height=850,scrollbars=1,resizable=1');
    if (!w) {
      alert('Please allow popups to view chart.');
      return;
    }
    var dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png', 1.0);
    } catch (e) {
      alert('Unable to magnify chart: ' + e.message);
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
          '<button onclick="window.close()">Close</button>' +
        '</div>' +
        '<div class="wrap">' +
          '<img src="' + dataUrl + '" alt="Chart">' +
        '</div>' +
      '</body></html>'
    );
    w.document.close();
    try { w.focus(); } catch (e) {}
  }

  async function loadBills(from, to) {
    // expects global SB
    var res = await SB.from('bills')
      .select('id,bill_date,bill_type,total,amount_paid,balance,items,status,created_at')
      .gte('bill_date', from)
      .lte('bill_date', to)
      .order('bill_date', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return res.data || [];
  }

  async function loadPatients() {
    var res = await SB.from('patients')
      .select('patient_no,full_name,chinese_name,phone_number,dob,hkid,email,address,sex,medical_alerts,remarks')
      .order('patient_no', { ascending: true })
      .limit(2000);
    if (res.error) throw new Error(res.error.message);
    return res.data || [];
  }

  function exportCSV() {
    if (!_rows || !_rows.length) {
      alert('No data to export.');
      return;
    }
    var keys = Object.keys(_rows[0] || {});
    if (!keys.length) {
      alert('No data to export.');
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
    a.download = (_tab || 'report') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
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
    var res = await SB.from('bills')
      .select('id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,doctor_id,doctor_name,doctor_tag,created_at')
      .gte('bill_date', from)
      .lte('bill_date', to)
      .order('bill_date', { ascending: true })
      .order('created_at', { ascending: true });
    if (res.error) {
      var m = String(res.error.message || '').toLowerCase();
      if (m.indexOf('doctor_id') >= 0 || m.indexOf('doctor_name') >= 0 || m.indexOf('doctor_tag') >= 0) {
        res = await SB.from('bills')
          .select('id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,created_at')
          .gte('bill_date', from)
          .lte('bill_date', to)
          .order('bill_date', { ascending: true })
          .order('created_at', { ascending: true });
      }
    }
    if (res.error) throw new Error(res.error.message);
    return res.data || [];
  }

  async function loadPatientsByIds(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return [];
    var res = await SB.from('patients')
      .select('id,patient_no,full_name,chinese_name')
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
    var res = await SB.from('treatments')
      .select('id,patient_id,dentist_name,doctor_id,doctor_name,doctor_tag,notes,created_at')
      .gte('created_at', fromTs)
      .lte('created_at', toTs)
      .order('created_at', { ascending: true });
    if (res.error) {
      var m = String(res.error.message || '').toLowerCase();
      if (m.indexOf('doctor_id') >= 0 || m.indexOf('doctor_name') >= 0 || m.indexOf('doctor_tag') >= 0) {
        res = await SB.from('treatments')
          .select('id,patient_id,dentist_name,notes,created_at')
          .gte('created_at', fromTs)
          .lte('created_at', toTs)
          .order('created_at', { ascending: true });
      }
    }
    if (res.error) throw new Error(res.error.message);
    return res.data || [];
  }

  function sumByKey(rows, key, valueKey) {
    var map = {};
    rows.forEach(function (r) {
      var k = r[key] || 'Unknown';
      map[k] = (map[k] || 0) + Number(r[valueKey] || 0);
    });
    return Object.keys(map).sort().map(function (k) { return { key: k, value: map[k] }; });
  }

  function downloadCSV(filename, columns, rows) {
    if (!rows || !rows.length) {
      alert('No data to export.');
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
        '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(x.key) + '</div>' +
        '<div style="font-size:16px;font-weight:900;color:#0d6efd;margin-top:4px;">HK$ ' + Number(x.value || 0).toFixed(2) + '</div>' +
      '</div>';
    }).join('');

    var rowsHtml = transactions.map(function (t) {
      return '<tr>' +
        '<td style="' + td + '">' + esc(t.patient_no) + '</td>' +
        '<td style="' + td + '">' + esc(t.patient_chinese) + '</td>' +
        '<td style="' + td + '">' + esc(t.patient_name) + '</td>' +
        '<td style="' + td + '">' + esc(t.payment_method) + '</td>' +
        '<td style="' + td + 'text-align:right;font-weight:900;">HK$ ' + esc(t.amount) + '</td>' +
        '<td style="' + td + '">' + esc(t.remarks) + '</td>' +
      '</tr>';
    }).join('');

    body.innerHTML =
      '<div style="border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff;">' +
        '<div style="overflow:auto;max-height:520px;">' +
          '<table style="width:100%;border-collapse:collapse;min-width:860px;">' +
            '<thead><tr>' +
              '<th style="' + th + 'width:120px;">Patient No</th>' +
              '<th style="' + th + 'width:160px;">Chinese</th>' +
              '<th style="' + th + '">English</th>' +
              '<th style="' + th + 'width:150px;">Payment</th>' +
              '<th style="' + th + 'width:120px;text-align:right;">Amount</th>' +
              '<th style="' + th + 'width:220px;">Remarks</th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;">' +
        '<div style="flex:1;min-width:240px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;">' +
          '<div style="font-size:12px;color:#7c2d12;font-weight:900;">Daily Grand Total</div>' +
          '<div style="font-size:22px;font-weight:900;color:#c2410c;margin-top:4px;">HK$ ' + Number(grandTotal || 0).toFixed(2) + '</div>' +
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
        '<div style="font-weight:900;color:#4b5563;font-size:12px;">' + esc(x.key) + '</div>' +
        '<div style="font-weight:900;color:#0d6efd;font-size:12px;">HK$ ' + Number(x.value || 0).toFixed(2) + '</div>' +
      '</div>';
    }).join('');

    if (!chips) {
      chips = '<div style="padding:10px 0;color:#94a3b8;font-size:12px;">No payment method totals for this month.</div>';
    }

    var cardsHtml = dayCards.map(function (c) {
      var methodMiniMap = {};
      (c.rows || []).forEach(function (t) {
        var k = t.payment_method || 'Unknown';
        methodMiniMap[k] = (methodMiniMap[k] || 0) + Number(t.amount || 0);
      });

      var methodMini = Object.keys(methodMiniMap).sort().map(function (k) {
        return '<span style="display:inline-flex;align-items:center;gap:6px;background:#eef6ff;color:#0d6efd;border:1px solid #d9eaff;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;">' +
          '<span>' + esc(k) + '</span><span style="color:#1f2937;">HK$ ' + Number(methodMiniMap[k] || 0).toFixed(2) + '</span>' +
        '</span>';
      }).join('');

      var rows = c.rows.map(function (t) {
        return '<div style="display:grid;grid-template-columns:minmax(90px,110px) minmax(220px,1fr) minmax(120px,140px) minmax(100px,120px);gap:10px;align-items:start;padding:10px 0;border-bottom:1px dashed #e6edf5;">' +
          '<div style="font-weight:900;color:#0d6efd;font-size:12px;">' + esc(t.patient_no || '-') + '</div>' +
          '<div style="min-width:0;">' +
            '<div style="font-size:13px;font-weight:900;color:#1f2937;line-height:1.35;">' + esc(t.patient_chinese || '') + (t.patient_name ? (' / ' + esc(t.patient_name)) : '') + '</div>' +
            (t.remarks ? '<div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.35;">' + esc(t.remarks) + '</div>' : '') +
          '</div>' +
          '<div style="color:#475569;font-weight:900;font-size:12px;">' + esc(t.payment_method || 'Unknown') + '</div>' +
          '<div style="text-align:right;font-weight:900;color:#0f172a;font-size:12px;">HK$ ' + Number(t.amount || 0).toFixed(2) + '</div>' +
        '</div>';
      }).join('');

      return '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:14px;padding:12px 14px;margin-bottom:12px;box-shadow:0 3px 10px rgba(15,23,42,.04);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid #edf2f7;">' +
          '<div style="font-weight:900;color:#0d6efd;font-size:14px;">' + esc(c.date) + '</div>' +
          '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">Transactions: ' + (c.rows || []).length + '</div>' +
            '<div style="font-size:14px;font-weight:900;color:#0f172a;">HK$ ' + Number(c.total || 0).toFixed(2) + '</div>' +
          '</div>' +
        '</div>' +
        (methodMini ? '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 4px 0;">' + methodMini + '</div>' : '') +
        '<div style="margin-top:2px;">' + rows + '</div>' +
      '</div>';
    }).join('');

    if (!cardsHtml) {
      cardsHtml = '<div style="background:#fff;border:1px dashed #d7e2f0;border-radius:12px;padding:22px;text-align:center;color:#64748b;">No billing transactions found for this month.</div>';
    }

    body.innerHTML =
      '<div style="max-height:640px;overflow:auto;padding-right:2px;">' +
        '<div style="background:linear-gradient(135deg,#0d6efd,#2b8fff);border-radius:14px;padding:12px 14px;color:#fff;margin-bottom:12px;box-shadow:0 5px 14px rgba(13,110,253,.25);">' +
          '<div style="font-size:12px;font-weight:800;opacity:.9;">Monthly Overview</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
            '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:8px 10px;min-width:130px;">' +
              '<div style="font-size:11px;font-weight:700;opacity:.9;">Days With Bills</div>' +
              '<div style="margin-top:2px;font-size:18px;font-weight:900;">' + dayCount + '</div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:8px 10px;min-width:130px;">' +
              '<div style="font-size:11px;font-weight:700;opacity:.9;">Transactions</div>' +
              '<div style="margin-top:2px;font-size:18px;font-weight:900;">' + txCount + '</div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:8px 10px;min-width:180px;">' +
              '<div style="font-size:11px;font-weight:700;opacity:.9;">Month Grand Total</div>' +
              '<div style="margin-top:2px;font-size:18px;font-weight:900;">HK$ ' + Number(monthGrandTotal || 0).toFixed(2) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;padding:10px 12px;margin-bottom:12px;">' +
          '<div style="font-size:12px;font-weight:900;color:#0d6efd;margin-bottom:8px;">Payment Method Totals</div>' +
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
        html: '<div style="font-size:11px;color:#94a3b8;">No treatment entries</div>'
      };
    }
    var html = items.map(function (it, idx) {
      var desc = String(it && it.desc ? it.desc : 'Treatment');
      var qty = Number(it && it.qty ? it.qty : 0);
      var price = Number(it && it.price ? it.price : 0);
      var lineTotal = qty * price;
      return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;padding:4px 6px;margin-bottom:4px;background:#f8fbff;border:1px solid #e5edf8;border-radius:8px;">' +
        '<div style="min-width:0;font-size:11px;color:#0f172a;line-height:1.35;"><span style="font-weight:900;color:#0d6efd;">#' + (idx + 1) + '</span> ' + esc(desc) + '</div>' +
        '<div style="flex-shrink:0;font-size:11px;color:#475569;font-weight:800;white-space:nowrap;">' +
          qty + ' x HK$ ' + price.toFixed(2) + ' = HK$ ' + lineTotal.toFixed(2) +
        '</div>' +
      '</div>';
    }).join('');
    return { count: items.length, html: html };
  }

  function detailTxRowHtml(t, isCompact) {
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
        '<div style="font-size:12px;color:#475569;font-weight:900;">' + esc(t.payment_method || 'Unknown') + '</div>' +
        (t.remarks ? '<div style="font-size:11px;color:#64748b;line-height:1.35;margin-top:4px;">' + esc(t.remarks) + '</div>' : '') +
      '</td>' +
      '<td style="width:30%;padding:10px 8px;border-bottom:1px solid #eef2f7;vertical-align:top;word-break:break-word;">' +
        '<div style="font-size:11px;color:#64748b;font-weight:800;margin-bottom:5px;">Treatment Entries: ' + tx.count + '</div>' +
        tx.html +
      '</td>' +
      '<td style="width:9%;padding:10px 12px;border-bottom:1px solid #eef2f7;border-left:1px solid #edf2f7;text-align:right;font-size:12px;font-weight:900;vertical-align:top;color:#0f172a;white-space:nowrap;">HK$ ' + Number(t.bill_total || 0).toFixed(2) + '</td>' +
      '<td style="width:9%;padding:10px 12px;border-bottom:1px solid #eef2f7;border-left:1px solid #edf2f7;text-align:right;font-size:12px;font-weight:900;vertical-align:top;color:#0369a1;white-space:nowrap;">HK$ ' + Number(t.bill_paid || 0).toFixed(2) + '</td>' +
      '<td style="width:8%;padding:10px 12px;border-bottom:1px solid #eef2f7;border-left:1px solid #edf2f7;text-align:right;font-size:12px;font-weight:900;vertical-align:top;color:' + balColor + ';white-space:nowrap;">HK$ ' + bal.toFixed(2) + '</td>' +
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
        esc(x.key) + ': HK$ ' + Number(x.value || 0).toFixed(2) +
      '</span>';
    }).join('');

    var rowsHtml = transactions.map(function (t) { return detailTxRowHtml(t, false); }).join('');
    if (!rowsHtml) {
      rowsHtml = '<tr><td colspan="7" style="padding:20px;text-align:center;color:#64748b;">No detailed transactions found.</td></tr>';
    }

    body.innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
        '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:150px;">' +
          '<div style="font-size:11px;color:#64748b;font-weight:800;">Total Bills</div>' +
          '<div style="font-size:18px;color:#0d6efd;font-weight:900;margin-top:2px;">' + transactions.length + '</div>' +
        '</div>' +
        '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:150px;">' +
          '<div style="font-size:11px;color:#64748b;font-weight:800;">Treatment Entries</div>' +
          '<div style="font-size:18px;color:#0d6efd;font-weight:900;margin-top:2px;">' + totalTreatments + '</div>' +
        '</div>' +
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;min-width:190px;">' +
          '<div style="font-size:11px;color:#7c2d12;font-weight:800;">Bill Total</div>' +
          '<div style="font-size:18px;color:#c2410c;font-weight:900;margin-top:2px;">HK$ ' + Number(grandTotal || 0).toFixed(2) + '</div>' +
        '</div>' +
        '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;min-width:210px;">' +
          '<div style="font-size:11px;color:#991b1b;font-weight:800;">Remaining Balance</div>' +
          '<div style="font-size:18px;color:#dc2626;font-weight:900;margin-top:2px;">HK$ ' + Number(outstanding || 0).toFixed(2) + '</div>' +
        '</div>' +
      '</div>' +
      (methodPills ? ('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' + methodPills + '</div>') : '') +
      '<div style="border:1px solid #dfe9f5;border-radius:12px;overflow:hidden;background:#fff;">' +
        '<div style="overflow:auto;max-height:560px;">' +
          '<table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;">' +
            '<thead>' +
              '<tr>' +
                '<th style="width:10%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">Bill Date</th>' +
                '<th style="width:20%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">Patient</th>' +
                '<th style="width:14%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">Payment / Notes</th>' +
                '<th style="width:30%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 8px;border-bottom:2px solid #dde8f5;text-align:left;">Treatment Details</th>' +
                '<th style="width:9%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 12px;border-bottom:2px solid #dde8f5;border-left:1px solid #dde8f5;text-align:right;">Bill</th>' +
                '<th style="width:9%;position:sticky;top:0;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:10px 12px;border-bottom:2px solid #dde8f5;border-left:1px solid #dde8f5;text-align:right;">Paid</th>' +
                '<th style="width:8%;position:sticky;top:0;background:#f0f7ff;color:#dc2626;font-size:11px;font-weight:900;padding:10px 12px;border-bottom:2px solid #fecaca;border-left:1px solid #fecaca;text-align:right;">Remaining</th>' +
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
        '<div style="font-size:12px;color:#475569;font-weight:900;">' + esc(x.key) + '</div>' +
        '<div style="font-size:12px;color:#0d6efd;font-weight:900;">HK$ ' + Number(x.value || 0).toFixed(2) + '</div>' +
      '</div>';
    }).join('');
    if (!methodSummary) {
      methodSummary = '<div style="font-size:12px;color:#94a3b8;">No payment methods for this month.</div>';
    }

    var sectionsHtml = dayCards.map(function (c) {
      var rowsHtml = (c.rows || []).map(function (t) { return detailTxRowHtml(t, true); }).join('');
      if (!rowsHtml) {
        rowsHtml = '<tr><td colspan="7" style="padding:14px;color:#64748b;text-align:center;">No detailed rows.</td></tr>';
      }
      return '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 8px rgba(15,23,42,.04);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#f8fbff;border-bottom:1px solid #e6edf5;">' +
          '<div style="font-size:13px;font-weight:900;color:#0d6efd;">' + esc(c.date) + '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">Bills: ' + (c.rows || []).length + '</div>' +
            '<div style="font-size:13px;color:#0f172a;font-weight:900;">HK$ ' + Number(c.total || 0).toFixed(2) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="overflow:auto;">' +
          '<table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;">' +
            '<thead>' +
              '<tr>' +
                '<th style="width:10%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">Bill Date</th>' +
                '<th style="width:20%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">Patient</th>' +
                '<th style="width:14%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">Payment / Notes</th>' +
                '<th style="width:30%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 8px;border-bottom:2px solid #dde8f5;text-align:left;">Treatment Details</th>' +
                '<th style="width:9%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 12px;border-bottom:2px solid #dde8f5;border-left:1px solid #dde8f5;text-align:right;">Bill</th>' +
                '<th style="width:9%;background:#f0f7ff;color:#0d6efd;font-size:11px;font-weight:900;padding:9px 12px;border-bottom:2px solid #dde8f5;border-left:1px solid #dde8f5;text-align:right;">Paid</th>' +
                '<th style="width:8%;background:#f0f7ff;color:#dc2626;font-size:11px;font-weight:900;padding:9px 12px;border-bottom:2px solid #fecaca;border-left:1px solid #fecaca;text-align:right;">Remaining</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
    }).join('');

    if (!sectionsHtml) {
      sectionsHtml = '<div style="background:#fff;border:1px dashed #d7e2f0;border-radius:12px;padding:22px;text-align:center;color:#64748b;">No detailed monthly transactions found.</div>';
    }

    body.innerHTML =
      '<div style="max-height:640px;overflow:auto;padding-right:2px;">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:140px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">Days</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0d6efd;font-weight:900;">' + dayCards.length + '</div>' +
          '</div>' +
          '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:140px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">Bills</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0d6efd;font-weight:900;">' + totalBills + '</div>' +
          '</div>' +
          '<div style="background:#f8fbff;border:1px solid #d9eaff;border-radius:12px;padding:10px 12px;min-width:160px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">Treatment Entries</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0d6efd;font-weight:900;">' + totalTreatments + '</div>' +
          '</div>' +
          '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;min-width:180px;">' +
            '<div style="font-size:11px;color:#7c2d12;font-weight:800;">Month Bill Total</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#c2410c;font-weight:900;">HK$ ' + Number(monthGrandTotal || 0).toFixed(2) + '</div>' +
          '</div>' +
          '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;min-width:200px;">' +
            '<div style="font-size:11px;color:#991b1b;font-weight:800;">Remaining Balance</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#dc2626;font-weight:900;">HK$ ' + Number(totalOutstanding || 0).toFixed(2) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;padding:10px 12px;margin-bottom:12px;">' +
          '<div style="font-size:12px;font-weight:900;color:#0d6efd;margin-bottom:8px;">Payment Method Totals</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">' + methodSummary + '</div>' +
        '</div>' +
        sectionsHtml +
      '</div>';
  }

  function monthKeyOf(isoDate) {
    return String(isoDate || '').slice(0, 7);
  }

  function monthOptionsHTML(selectedYYYYMM) {
    var now = new Date();
    var year = now.getFullYear();
    var months = [
      'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
    ];
    var opts = months.map(function (m, idx) {
      var mm = String(idx + 1).padStart(2, '0');
      var v = year + '-' + mm;
      var sel = (v === selectedYYYYMM) ? ' selected' : '';
      return '<option value="' + esc(v) + '"' + sel + '>' + esc(m + ' ' + year) + '</option>';
    }).join('');
    return opts;
  }

  function drDisplayName(d) {
    if (!d) return '';
    return d.display_name || d.english_name || d.chinese_name || d.doctor_code || '';
  }

  function drOptionsHTML(selectedId) {
    if (!_drDailyDoctors.length) {
      return '<option value="">(No doctors)</option>';
    }
    return _drDailyDoctors.map(function (d) {
      var id = d.id || '';
      var code = d.doctor_code ? ('[' + d.doctor_code + '] ') : '';
      var shown = drDisplayName(d) || 'Doctor';
      var sel = (id === selectedId) ? ' selected' : '';
      return '<option value="' + esc(id) + '"' + sel + '>' + esc(code + shown) + '</option>';
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
    var shown = drDisplayName(d);
    if (!shown) return '';
    return d.doctor_code ? ('[' + d.doctor_code + '] ' + shown) : shown;
  }

  function doctorTextVariants(d) {
    var set = {};
    [d && d.display_name, d && d.english_name, d && d.chinese_name, doctorTagOf(d)].forEach(function (v) {
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
            '<div style="font-size:12px;color:#555;font-weight:900;">Doctor</div>' +
            '<select id="drDailyDoctorPick" onchange="REPORT.setDrDailyDoctor(this.value)" ' +
              'style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;min-width:220px;">' +
              drOptionsHTML(_drDailyDoctorId) +
            '</select>' +
            '<span style="width:1px;height:22px;background:#e5e7eb;display:inline-block;"></span>' +
            '<div style="font-size:12px;color:#555;font-weight:900;">Date</div>' +
            '<input type="date" id="drDailyDayPick" value="' + esc(day) + '" ' +
              'onchange="REPORT.setDrDailyDate(this.value)" ' +
              'style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;">' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drDailyMode === 'simple' ? 'var(--primary)' : '#64748b') + ';" onclick="REPORT.setDrDailyMode(\'simple\')">Simple</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drDailyMode === 'detail' ? '#0d6efd' : '#64748b') + ';display:inline-flex;align-items:center;gap:8px;" onclick="REPORT.toggleDrDailyDetail()">' +
              '<span>Detail Transaction</span>' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:2px 8px;border-radius:999px;background:' + (_drDailyMode === 'detail' ? '#22c55e' : '#cbd5e1') + ';color:' + (_drDailyMode === 'detail' ? '#052e16' : '#334155') + ';font-size:11px;font-weight:900;">' + (_drDailyMode === 'detail' ? 'ON' : 'OFF') + '</span>' +
            '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drDailyMode === 'treatmentStats' ? '#7c3aed' : '#64748b') + ';" onclick="REPORT.setDrDailyMode(\'treatmentStats\')">Treatment Statistics</button>' +
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
      body.innerHTML = '<div style="padding:14px;color:#64748b;">No doctor available. Please configure doctors in Config.</div>';
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
        payment_method: b.bill_type || 'Unknown',
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
          var name = String(it && it.desc ? it.desc : 'Treatment');
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
        body.innerHTML = '<div style="padding:14px;color:#64748b;">No billed treatment items for selected doctor/day.</div>';
        return;
      }
      var th = 'padding:10px 10px;background:#f3f0ff;color:#6d28d9;font-size:12px;font-weight:900;border-bottom:2px solid #e9ddff;text-align:left;';
      var td = 'padding:9px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top;';
      var rowsHtml = rows.map(function (r) {
        return '<tr>' +
          '<td style="' + td + 'font-weight:900;color:#0f172a;">' + esc(r.item_name) + '</td>' +
          '<td style="' + td + 'text-align:right;">' + esc(String(r.frequency || 0)) + '</td>' +
          '<td style="' + td + 'text-align:right;font-weight:900;">HK$ ' + esc(r.amount) + '</td>' +
        '</tr>';
      }).join('');
      body.innerHTML =
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="background:#f3f0ff;border:1px solid #e9ddff;border-radius:12px;padding:10px 12px;min-width:220px;">' +
            '<div style="font-size:11px;color:#6d28d9;font-weight:900;">Today Item Grand Total</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#4c1d95;font-weight:900;">HK$ ' + grandAmt.toFixed(2) + '</div>' +
          '</div>' +
          '<div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:10px 12px;min-width:220px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:900;">Today Total Frequency</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0f172a;font-weight:900;">' + grandFreq + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="border:1px solid #e9ddff;border-radius:12px;overflow:hidden;background:#fff;">' +
          '<div style="overflow:auto;max-height:560px;">' +
            '<table style="width:100%;border-collapse:collapse;table-layout:fixed;">' +
              '<thead><tr>' +
                '<th style="' + th + '">Treatment Item</th>' +
                '<th style="' + th + 'width:160px;text-align:right;">Frequency</th>' +
                '<th style="' + th + 'width:220px;text-align:right;">Total Amount</th>' +
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
            '<div style="font-size:12px;color:#555;font-weight:900;">Doctor</div>' +
            '<select onchange="REPORT.setDrMonthlyDoctor(this.value)" style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;min-width:220px;">' +
              drOptionsHTML(_drMonthlyDoctorId) +
            '</select>' +
            '<span style="width:1px;height:22px;background:#e5e7eb;display:inline-block;"></span>' +
            '<div style="font-size:12px;color:#555;font-weight:900;">Month</div>' +
            '<select onchange="REPORT.setDrMonthlyMonth(this.value)" style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;min-width:150px;">' +
              monthOptionsHTML(month) +
            '</select>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drMonthlyMode === 'simple' ? 'var(--primary)' : '#64748b') + ';" onclick="REPORT.setDrMonthlyMode(\'simple\')">Simple</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drMonthlyMode === 'detail' ? '#0d6efd' : '#64748b') + ';display:inline-flex;align-items:center;gap:8px;" onclick="REPORT.toggleDrMonthlyDetail()">' +
              '<span>Detail Transaction</span>' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:2px 8px;border-radius:999px;background:' + (_drMonthlyMode === 'detail' ? '#22c55e' : '#cbd5e1') + ';color:' + (_drMonthlyMode === 'detail' ? '#052e16' : '#334155') + ';font-size:11px;font-weight:900;">' + (_drMonthlyMode === 'detail' ? 'ON' : 'OFF') + '</span>' +
            '</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_drMonthlyMode === 'treatmentStats' ? '#7c3aed' : '#64748b') + ';" onclick="REPORT.setDrMonthlyMode(\'treatmentStats\')">Treatment Statistics</button>' +
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
      body.innerHTML = '<div style="padding:14px;color:#64748b;">No doctor available. Please configure doctors in Config.</div>';
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
      body.innerHTML = '<div style="padding:14px;color:#64748b;">No billed records for selected doctor/month.</div>';
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
          var name = String(it && it.desc ? it.desc : 'Treatment');
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
        body.innerHTML = '<div style="padding:14px;color:#64748b;">No billed treatment items for selected doctor/month.</div>';
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
          '<td style="' + td + 'text-align:right;font-weight:900;color:#6d28d9;">HK$ ' + esc(r.income) + '</td>' +
        '</tr>';
      }).join('');

      body.innerHTML =
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="background:#f3f0ff;border:1px solid #e9ddff;border-radius:12px;padding:10px 12px;min-width:220px;">' +
            '<div style="font-size:11px;color:#6d28d9;font-weight:900;">Month Items Grand Total</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#4c1d95;font-weight:900;">HK$ ' + grandIncome.toFixed(2) + '</div>' +
          '</div>' +
          '<div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:10px 12px;min-width:220px;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:900;">Total Item Frequency</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#0f172a;font-weight:900;">' + grandItems + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="border:1px solid #e9ddff;border-radius:12px;overflow:hidden;background:#fff;">' +
          '<div style="overflow:auto;max-height:560px;">' +
            '<table style="width:100%;border-collapse:collapse;min-width:720px;">' +
              '<thead><tr>' +
                '<th style="' + th + '">Treatment Item</th>' +
                '<th style="' + th + 'text-align:right;width:160px;">Frequency</th>' +
                '<th style="' + th + 'text-align:right;width:200px;">Total Income</th>' +
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
          payment_method: b.bill_type || 'Unknown',
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
        '<td style="' + td + 'text-align:right;font-weight:900;">HK$ ' + esc(r.total) + '</td>' +
        '<td style="' + td + 'text-align:right;">HK$ ' + esc(r.paid) + '</td>' +
        '<td style="' + td + 'text-align:right;color:' + (Number(r.balance) > 0 ? '#dc2626' : '#16a34a') + ';">HK$ ' + esc(r.balance) + '</td>' +
      '</tr>';
    }).join('');

    body.innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
        '<div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:12px;padding:10px 12px;min-width:180px;">' +
          '<div style="font-size:11px;color:#155e75;font-weight:800;">Total Billed</div>' +
          '<div style="margin-top:2px;font-size:18px;color:#0e7490;font-weight:900;">HK$ ' + total.toFixed(2) + '</div>' +
        '</div>' +
        '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:10px 12px;min-width:180px;">' +
          '<div style="font-size:11px;color:#166534;font-weight:800;">Total Paid</div>' +
          '<div style="margin-top:2px;font-size:18px;color:#15803d;font-weight:900;">HK$ ' + paid.toFixed(2) + '</div>' +
        '</div>' +
        '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;min-width:180px;">' +
          '<div style="font-size:11px;color:#991b1b;font-weight:800;">Outstanding</div>' +
          '<div style="margin-top:2px;font-size:18px;color:#dc2626;font-weight:900;">HK$ ' + bal.toFixed(2) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:auto;max-height:560px;background:#fff;">' +
        '<table style="width:100%;border-collapse:collapse;">' +
          '<thead><tr>' +
            '<th style="' + th + '">Date</th>' +
            '<th style="' + th + 'text-align:right;">Bill Count</th>' +
            '<th style="' + th + 'text-align:right;">Billed</th>' +
            '<th style="' + th + 'text-align:right;">Paid</th>' +
            '<th style="' + th + 'text-align:right;">Balance</th>' +
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
        return {
          bill_id: b.id || '',
          bill_ref: ref,
          bill_date: b.bill_date || day,
          patient_no: b.patient_no || (p.patient_no || ''),
          patient_chinese: p.chinese_name || '',
          patient_name: (p.full_name || b.patient_name || ''),
          payment_method: b.bill_type || 'Unknown',
          amount: total.toFixed(2),
          bill_total: total,
          bill_paid: paid,
          bill_balance: bal,
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
        var txRow = {
          bill_id: b.id || '',
          bill_ref: ref,
          bill_date: b.bill_date || d,
          patient_no: b.patient_no || (p.patient_no || ''),
          patient_chinese: p.chinese_name || '',
          patient_name: (p.full_name || b.patient_name || ''),
          payment_method: b.bill_type || 'Unknown',
          amount: total.toFixed(2),
          bill_total: total,
          bill_paid: paid,
          bill_balance: bal,
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
          '<div style="font-size:12px;color:#555;font-weight:900;">Date</div>' +
          '<input type="date" id="dsDayPick" value="' + esc(dailyDate) + '" ' +
            'onchange="REPORT.setDailySummaryDate(this.value)" ' +
            'style="padding:7px 10px;border:1px solid #ddd;border-radius:10px;">' +
        '</div>';
    } else {
      pickerHtml =
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<div style="font-size:12px;color:#555;font-weight:900;">Month</div>' +
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
              'onclick="REPORT.setDailySummaryView(\'daily\')">Daily</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_dailySummaryView === 'monthly' ? 'var(--primary)' : 'var(--gray)') + ';" ' +
              'onclick="REPORT.setDailySummaryView(\'monthly\')">Monthly</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (_dailySummaryDetailMode ? '#0d6efd' : '#64748b') + ';display:inline-flex;align-items:center;gap:8px;" ' +
              'onclick="REPORT.toggleDailySummaryDetail()">' +
              '<span>Detail Transaction</span>' +
              '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:2px 8px;border-radius:999px;background:' + (_dailySummaryDetailMode ? '#22c55e' : '#cbd5e1') + ';color:' + (_dailySummaryDetailMode ? '#052e16' : '#334155') + ';font-size:11px;font-weight:900;">' + (_dailySummaryDetailMode ? 'ON' : 'OFF') + '</span>' +
            '</button>' +
            '<span style="width:1px;height:22px;background:#e5e7eb;display:inline-block;"></span>' +
            pickerHtml +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:#22c55e;" onclick="REPORT.printDailySummary()">🖨️ Print</button>' +
            '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:#64748b;" onclick="REPORT.exportDailySummaryExcel()">⬇ Output Excel (CSV)</button>' +
          '</div>' +
        '</div>' +
        '<div id="rptDailySummaryBody" style="min-height:200px;"></div>' +
      '</div>';
  }

  async function refresh() {
    setDefaultDates();
    var from = g('rptFrom') ? g('rptFrom').value : todayISO();
    var to = g('rptTo') ? g('rptTo').value : todayISO();

    // clear + loading placeholders
    _rows = [];
    destroyChart();
    if (g('rptTableWrap')) {
      g('rptTableWrap').innerHTML = '<div style="padding:12px;color:#888;">Loading…</div>';
    }
    setChartNote('Loading…');

    try {
      if (_tab === 'dailySummary') {
        setHeader('Daily Summary', 'Per-transaction daily view + monthly grouped cards. Uses bills + patients.');

        // Charts not used for this subtab
        showChartColumn(false);
        destroyChart();
        setChartNote('Charts are disabled for Daily Summary.');

        // Hide print buttons (keep Output CSV)
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = 'none';
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';

        renderDailySummaryShell();
        await buildDailySummary();
        return;
      }

      if (_tab === 'patientDir') {
        // Admin-only gate
        if (typeof currentRole !== 'undefined' && currentRole !== 'admin') {
          setHeader('Patient Directories', 'Admin access required.');
          _rows = [];
          renderTable([{ key: 'note', label: 'Info' }], [{ note: 'This report is admin-only.' }]);
          // Hide chart + print buttons
          if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = 'none';
          if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
          var gridD = g('rptMainGrid');
          var colD = g('rptChartCol');
          if (gridD) gridD.style.gridTemplateColumns = '1fr';
          if (colD) colD.style.display = 'none';
          destroyChart();
          setChartNote('Charts are disabled for this tab.');
          return;
        }

        setHeader('Patient Directories', 'From patients table (up to 2000 rows).');

        // Hide print buttons for this tab
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = 'none';
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';

        var pts = await loadPatients();
        _rows = pts.map(function (p) {
          return {
            patient_no: p.patient_no || '',
            full_name: p.full_name || '',
            chinese_name: p.chinese_name || '',
            phone: p.phone_number || '',
            dob: p.dob || '',
            hkid: p.hkid || '',
            email: p.email || '',
            sex: p.sex || '',
            address: p.address || '',
            alerts: p.medical_alerts || '',
            remarks: p.remarks || ''
          };
        });
        renderTable([
          { key: 'patient_no', label: 'Patient No' },
          { key: 'full_name', label: 'Name' },
          { key: 'chinese_name', label: 'Chinese' },
          { key: 'phone', label: 'Phone' },
          { key: 'dob', label: 'DOB' },
          { key: 'hkid', label: 'HKID' },
          { key: 'email', label: 'Email' },
          { key: 'sex', label: 'Sex' },
          { key: 'address', label: 'Address' },
          { key: 'alerts', label: 'Alerts' },
          { key: 'remarks', label: 'Remarks' }
        ], _rows);
        // Disable charts for patient directory
        var grid = g('rptMainGrid');
        var col = g('rptChartCol');
        if (grid) grid.style.gridTemplateColumns = '1fr';
        if (col) col.style.display = 'none';
        destroyChart();
        setChartNote('Charts are disabled for patient directories.');
        return;
      }

      // Ensure chart column visible for other tabs
      var grid2 = g('rptMainGrid');
      var col2 = g('rptChartCol');
      if (grid2) grid2.style.gridTemplateColumns = '1fr 360px';
      if (col2) col2.style.display = 'block';

      // Show print buttons on other tabs
      if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
      if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = '';

      var bills = await loadBills(from, to);

      if (_tab === 'dailyIncome') {
        setHeader('Daily Income', 'Sum of bills.total grouped by bill_date.');
        var grouped = groupSumBy(bills, function (b) { return b.bill_date || ''; }, function (b) { return Number(b.total || 0); });
        _rows = grouped.map(function (g) { return { date: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'date', label: 'Date' }, { key: 'total', label: 'Total (HK$)' }], _rows);
        renderChartFromRows('date', 'total');
        return;
      }

      if (_tab === 'weeklyIncome') {
        setHeader('Weekly Income', 'Grouped by Fri → Thu (7-day blocks).');
        var groupedW = groupSumBy(bills, function (b) {
          var d = parseDateToLocal(b.bill_date || todayISO());
          var day = d.getDay(); // 0 Sun..6 Sat (local)
          var diffToFri = (day - 5 + 7) % 7; // days since Friday
          d.setDate(d.getDate() - diffToFri);
          // Use local YYYY-MM-DD to avoid timezone shifting (Fri -> Thu in UTC)
          return iso(d); // block start (Friday)
        }, function (b) { return Number(b.total || 0); });
        _rows = groupedW.map(function (g) { return { week_start: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'week_start', label: 'Week Start' }, { key: 'total', label: 'Total (HK$)' }], _rows);
        renderChartFromRows('week_start', 'total');
        return;
      }

      if (_tab === 'monthlyIncome') {
        setHeader('Monthly Income', 'Grouped by YYYY-MM.');
        var groupedM = groupSumBy(bills, function (b) { return String(b.bill_date || '').slice(0, 7); }, function (b) { return Number(b.total || 0); });
        _rows = groupedM.map(function (g) { return { month: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'month', label: 'Month' }, { key: 'total', label: 'Total (HK$)' }], _rows);
        renderChartFromRows('month', 'total');
        return;
      }

      if (_tab === 'payStats') {
        setHeader('Payment Method Statistics', 'Sum of bills.total grouped by bill_type.');
        var groupedP = groupSumBy(bills, function (b) { return b.bill_type || 'Unknown'; }, function (b) { return Number(b.total || 0); });
        _rows = groupedP.map(function (g) { return { method: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'method', label: 'Payment Method' }, { key: 'total', label: 'Total (HK$)' }], _rows);
        renderChartFromRows('method', 'total');
        return;
      }

      if (_tab === 'txStats') {
        setHeader('Treatment Items Statistics', 'Aggregated from bills.items (desc, qty, price).');
        var items = [];
        bills.forEach(function (b) {
          parseBillItems(b.items).forEach(function (it) {
            items.push({
              desc: it.desc || 'Unknown',
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
          [{ key: 'item', label: 'Item' }, { key: 'qty', label: 'Qty' }, { key: 'amount', label: 'Amount (HK$)' }],
          _rows
        );
        renderChartFromRows('item', 'amount');
        return;
      }

      if (_tab === 'drDaily') {
        setHeader('Drs Daily', 'Choose doctor + day. Simple, Detail Transaction, or Treatment Statistics view.');
        showChartColumn(false);
        destroyChart();
        setChartNote('Charts are disabled for Drs Daily.');
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        await buildDrDaily();
        return;
      }

      if (_tab === 'drMonthly') {
        setHeader('Drs Monthly', 'Choose doctor + month. Uses bill Doctor Tag/ID/name.');
        showChartColumn(false);
        destroyChart();
        setChartNote('Charts are disabled for Drs Monthly.');
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        await buildDrMonthly();
        return;
      }

      // fallback
      setHeader('Reports', 'Select a tab.');
      setChartNote('—');
    } catch (e) {
      renderTable([{ key: 'err', label: 'Error' }], [{ err: e.message }]);
      setChartNote('Error loading data.');
    }
  }

  function switchTab(key) {
    // Admin-only tab gate
    if (key === 'patientDir' && typeof currentRole !== 'undefined' && currentRole !== 'admin') {
      alert('Patient directory report is admin-only.');
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
    wireReportTabButtons();
    setDefaultDates();
    switchTab(_tab);
  }

  return {
    init: init,
    switchTab: switchTab,
    refresh: refresh,
    printTable: printTable,
    printChart: printChart,
    magnifyChart: magnifyChart,
    exportCSV: exportCSV,
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
      var title = (g('rptTitle') && g('rptTitle').textContent) ? g('rptTitle').textContent : 'DailySummary';
      var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : todayISO();
      var suffix = (_dailySummaryView === 'monthly') ? ('monthly_' + monthKeyOf(from)) : ('daily_' + from);
      downloadCSV('daily_summary_' + suffix + '.csv', [
        { key: 'patient_no', label: 'Patient No' },
        { key: 'patient_chinese', label: 'Patient Chinese Name' },
        { key: 'patient_name', label: 'Patient English Name' },
        { key: 'payment_method', label: 'Payment Method' },
        { key: 'amount', label: 'Amount' },
        { key: 'remarks', label: 'Remarks' }
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
      setChartNote('No chart for this tab.');
    }
  };
})();

