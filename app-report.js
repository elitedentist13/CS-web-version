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
  var _dailySummaryAllClinicsLayout = 'byDoctor'; // 'byDoctor' | 'altogether' (ALL clinics only)
  var _dailySummaryDate = null; // YYYY-MM-DD
  var _dailySummaryMonth = null; // YYYY-MM
  var _drDailyDate = null; // YYYY-MM-DD
  var _drDailyDoctorId = null;
  var _drDailyMode = 'simple'; // simple | detail | treatmentStats
  var _drDailyDoctors = [];
  var _drMonthlyMonth = null; // YYYY-MM
  var _drMonthlyDoctorId = null;
  var _drMonthlyMode = 'simple'; // simple | detail | treatmentStats
  var _drMonthlyIncomeExport = null; // { meta, rows } for Clinic Income CSV layout
  var _drDailyIncomeExport = null; // { meta, rows } for Dr Daily Doctor Income Report
  var _dailySummaryIncomeExport = null; // { meta, rows } for Daily Summary monthly Clinic Income layout
  var _clinicIncomeDetailExport = null; // { meta, rows } for Clinic Income detail transaction layout
  var _monthlyIncomeFromMonth = null; // YYYY-MM
  var _monthlyIncomeToMonth = null; // YYYY-MM
  var _monthlyIncomeLastAnchor = 'to'; // 'from' | 'to' — which side stays when clamping to max span
  var _monthlyIncomeToolsWired = false;
  var MONTHLY_INCOME_MAX_MONTHS = 24;
  var MONTHLY_INCOME_DEFAULT_MONTHS = 6;
  var _reportTabsWired = false;
  var _reportDateInputsWired = false;
  var _auditFilterItem = '';
  var _auditFilterUser = '';
  var _auditAllRows = [];
  var _auditSelectedId = null;
  var _auditTableMissing = false;
  var _auditTrailDataLoaded = false;
  var _auditSubTab = 'voidBills'; // 'log' | 'voidBills'
  var _voidBillRows = [];
  var _voidBillSelectedId = null;
  var _voidBillSearchPatient = '';
  var _voidBillSearchUser = '';
  var _voidBillSearchDoctor = '';
  var _voidBillSearchClinic = '';
  var VOID_BILL_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
  var _voidBillPageIndex = 0;
  var _voidBillPageSize = 25;
  var _patientDirToolsWired = false;
  var REPORT_ALL_DOCTORS_ID = '__ALL_DOCTORS__';
  // Stores Promises keyed by query signature; cleared at the start of every
  // refresh() call so that identical queries within one load share one round-trip.
  var _rptCycleCache = Object.create(null);
  // Monotonically-increasing counter used to detect and discard stale async renders.
  // Each refresh() invocation captures its own value; any call that finds the global
  // has moved on simply returns without touching the DOM.
  var _refreshSeq = 0;

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

  var REPORT_PAY_METHOD_ALIASES = {
    'master': 'Mastercard',
    'master card': 'Mastercard',
    'mastercard': 'Mastercard',
    'visa': 'Visa',
    'visa card': 'Visa',
    'cash': 'Cash',
    'eps': 'EPS',
    'octopus': 'Octopus',
    'alipay': 'Alipay',
    'wechat pay': 'WeChat Pay',
    'wechat': 'WeChat Pay',
    'hkbc': 'HKBC',
    'cheque': 'Cheque',
    'bank transfer': 'Bank Transfer',
    'insurance': 'Insurance',
    'waived': 'Waived',
    'other': 'Other'
  };

  /** Normalize stored payment labels to bill_types names for grouping. */
  function reportPayMethodCanonicalKey(v) {
    var s = reportPayMethodKey(v);
    if (!s) return '';
    var lk = s.toLowerCase().replace(/\s+/g, ' ');
    if (REPORT_PAY_METHOD_ALIASES[lk]) return REPORT_PAY_METHOD_ALIASES[lk];
    return s;
  }

  /** Unpaid / unsettled bill types — omit from Daily Summary payment-method totals. */
  function reportPayMethodIsUnsettled(key) {
    var s = String(key == null ? '' : key).trim().toLowerCase();
    return !s || s === 'pending' || s === 'n/a' || s === 'na' || s === 'unknown';
  }

  function dispPayMethodSummary(key) {
    if (reportPayMethodIsUnsettled(key)) return '—';
    return dispPayMethod(key);
  }

  function dispPayMethodTxSummary(row) {
    var allocs = row && row.payment_allocations;
    if (allocs && allocs.length) {
      if (allocs.length === 1) return dispPayMethodSummary(allocs[0].method);
      return allocs.map(function (a) { return dispPayMethod(a.method); }).join(', ');
    }
    return dispPayMethodSummary(row && row.payment_method);
  }

  function sumByKeyPaidMethods(rows, key, valueKey) {
    var map = {};
    (rows || []).forEach(function (r) {
      var allocs = r.payment_allocations;
      if (allocs && allocs.length) {
        allocs.forEach(function (a) {
          var k = reportPayMethodCanonicalKey(a.method);
          if (reportPayMethodIsUnsettled(k)) return;
          map[k] = (map[k] || 0) + Number(a.amount || 0);
        });
        return;
      }
      var k = reportPayMethodCanonicalKey(r[key]);
      if (reportPayMethodIsUnsettled(k)) return;
      map[k] = (map[k] || 0) + Number(r[valueKey] || 0);
    });
    return Object.keys(map).sort().map(function (k) { return { key: k, value: map[k] }; });
  }

  /** Per-bill paid amounts by method (bill_payments + gap on bill row). */
  function reportPaymentAllocationsForBill(bill, paymentRows) {
    var paidOnBill = reportBillPaidValue(bill);
    if (paidOnBill <= 0.005) return [];
    var pmts = (paymentRows || []).filter(function (p) { return !(p && p.voided_at); });
    var sumPmts = pmts.reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
    var gap = paidOnBill - sumPmts;
    if (gap > 0.005) {
      pmts = [{ method: bill.bill_type, amount: gap }].concat(pmts);
    }
    return pmts.map(function (p) {
      return {
        method: reportPayMethodCanonicalKey(p.method),
        amount: Number(p.amount || 0)
      };
    }).filter(function (a) {
      return !reportPayMethodIsUnsettled(a.method) && a.amount > 0.005;
    });
  }

  async function loadBillPaymentsForBillIds(billIds) {
    billIds = (billIds || []).filter(Boolean);
    if (!billIds.length) return [];
    var CHUNK = 80;
    var tasks = [];
    for (var i = 0; i < billIds.length; i += CHUNK) {
      (function (chunk) {
        tasks.push(
          SB.from('bill_payments')
            .select('id,bill_id,paid_date,amount,method,voided_at')
            .in('bill_id', chunk)
            .then(function (res) {
              if (res.error) {
                var msg = String(res.error.message || '').toLowerCase();
                if (msg.indexOf('bill_payments') >= 0 || msg.indexOf('relation') >= 0) return [];
                throw new Error(res.error.message);
              }
              return res.data || [];
            })
        );
      })(billIds.slice(i, i + CHUNK));
    }
    var chunks = await Promise.all(tasks);
    var out = [];
    chunks.forEach(function (data) { out = out.concat(data); });
    return out;
  }

  async function fetchBillsByIds(billIds) {
    billIds = uniqIds((billIds || []).filter(Boolean));
    if (!billIds.length) return [];
    var selectFull = 'id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,doctor_id,doctor_name,doctor_tag,appointment_id,created_at,clinic_tag,voided_at';
    var selectNoDoctor = 'id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,appointment_id,created_at,clinic_tag,voided_at';
    var selectLegacy = 'id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,appointment_id,created_at,voided_at';
    var out = [];
    var CHUNK = 80;
    for (var i = 0; i < billIds.length; i += CHUNK) {
      var chunk = billIds.slice(i, i + CHUNK);
      var res = await SB.from('bills')
        .select(selectFull)
        .in('id', chunk);
      if (res.error) {
        var m = String(res.error.message || '').toLowerCase();
        if (m.indexOf('doctor_id') >= 0 || m.indexOf('doctor_name') >= 0 || m.indexOf('doctor_tag') >= 0) {
          res = await SB.from('bills')
            .select(selectNoDoctor)
            .in('id', chunk);
          if (res.error) {
            var m2 = String(res.error.message || '').toLowerCase();
            if (m2.indexOf('clinic_tag') >= 0) {
              res = await SB.from('bills')
                .select(selectLegacy)
                .in('id', chunk);
            }
          }
        } else if (m.indexOf('clinic_tag') >= 0) {
          res = await SB.from('bills')
            .select('id,bill_date,bill_type,total,amount_paid,balance,items,notes,patient_id,patient_no,patient_name,doctor_id,doctor_name,doctor_tag,appointment_id,created_at,voided_at')
            .in('id', chunk);
        }
      }
      if (res.error) throw new Error(res.error.message);
      out = out.concat(res.data || []);
    }
    return excludeVoidBills(out);
  }

  async function loadBillsByIds(billIds) {
    return filterBillsForReportClinic(await fetchBillsByIds(billIds));
  }

  async function loadBillsByIdsRaw(billIds) {
    return fetchBillsByIds(billIds);
  }

  async function loadBillPaymentsByPaidDate(from, to) {
    var selectFull = 'id,bill_id,paid_date,amount,method,notes,received_by,clinic_id,clinic_tag,clinic_code,voided_at,created_at';
    var selectNoClinic = 'id,bill_id,paid_date,amount,method,notes,received_by,voided_at,created_at';
    var PAGE = 1000;
    var useNoClinic = false;
    var out = [];
    var offset = 0;

    while (true) {
      var res = await SB.from('bill_payments')
        .select(useNoClinic ? selectNoClinic : selectFull)
        .gte('paid_date', from)
        .lte('paid_date', to)
        .order('paid_date', { ascending: true })
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (res.error) {
        var m = String(res.error.message || '').toLowerCase();
        if (!useNoClinic && (m.indexOf('clinic_id') >= 0 || m.indexOf('clinic_tag') >= 0 || m.indexOf('clinic_code') >= 0)) {
          useNoClinic = true;
          offset = 0;
          out = [];
          continue;
        }
        var msg = String(res.error.message || '').toLowerCase();
        if (msg.indexOf('bill_payments') >= 0 || msg.indexOf('relation') >= 0) return [];
        throw new Error(res.error.message);
      }

      var rows = res.data || [];
      out = out.concat(rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
    }

    return out.filter(function (p) { return !(p && p.voided_at); });
  }

  function indexPaymentsByBillId(payments) {
    var map = {};
    (payments || []).forEach(function (p) {
      if (p && p.voided_at) return;
      var bid = p.bill_id;
      if (!bid) return;
      if (!map[bid]) map[bid] = [];
      map[bid].push(p);
    });
    return map;
  }

  function paymentDateKey(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    return s.slice(0, 10);
  }

  function reducePaymentAllocations(payments) {
    var map = {};
    (payments || []).forEach(function (p) {
      var method = reportPayMethodCanonicalKey(p.method);
      if (reportPayMethodIsUnsettled(method)) return;
      map[method] = (map[method] || 0) + Number(p.amount || 0);
    });
    return Object.keys(map).sort().map(function (k) { return { method: k, amount: Number(map[k] || 0) }; });
  }

  function buildDailySummaryTxRowFromPaymentSlice(b, p, paidAmount, allocs, extra) {
    var total = reportBillTotalValue(b);
    var bal = reportBillBalanceValue(b);
    var includeBillMeta = !(extra && extra.include_bill_meta === false);
    var primaryMethod = allocs.length === 1
      ? allocs[0].method
      : (allocs.length ? allocs[0].method : reportPayMethodCanonicalKey(b && b.bill_type));
    var row = {
      bill_id: b && b.id ? b.id : '',
      bill_date: b && b.bill_date ? b.bill_date : '',
      patient_no: (b && b.patient_no) || (p && p.patient_no) || '',
      patient_chinese: (p && p.chinese_name) || '',
      patient_name: ((p && p.full_name) || (b && b.patient_name) || ''),
      payment_method: primaryMethod,
      payment_allocations: allocs || [],
      amount: Number(paidAmount || 0).toFixed(2),
      bill_total: includeBillMeta ? total : 0,
      bill_paid: Number(paidAmount || 0),
      bill_balance: includeBillMeta ? bal : 0,
      treatment_items: (b && b.items) || '[]',
      remarks: (b && b.notes) || ''
    };
    if (extra) {
      var copied = Object.assign({}, extra);
      delete copied.include_bill_meta;
      Object.assign(row, copied);
    }
    return row;
  }

  function buildDailySummaryTxRow(b, p, paymentsByBillId, extra) {
    var paid = reportBillPaidValue(b);
    var total = reportBillTotalValue(b);
    var bal = reportBillBalanceValue(b);
    var allocs = reportPaymentAllocationsForBill(b, (paymentsByBillId && b.id) ? paymentsByBillId[b.id] : []);
    var primaryMethod = allocs.length === 1
      ? allocs[0].method
      : (allocs.length ? allocs[0].method : reportPayMethodCanonicalKey(b.bill_type));
    var row = {
      bill_id: b.id || '',
      bill_date: b.bill_date || '',
      patient_no: b.patient_no || (p.patient_no || ''),
      patient_chinese: p.chinese_name || '',
      patient_name: (p.full_name || b.patient_name || ''),
      payment_method: primaryMethod,
      payment_allocations: allocs,
      amount: paid.toFixed(2),
      bill_total: total,
      bill_paid: paid,
      bill_balance: bal,
      treatment_items: b.items || '[]',
      remarks: b.notes || ''
    };
    if (extra) Object.assign(row, extra);
    return row;
  }

  function reportBillPaidValue(b) {
    return Number(b && b.amount_paid != null ? b.amount_paid : 0);
  }

  function reportBillTotalValue(b) {
    return Number(b && b.total != null ? b.total : 0);
  }

  function reportBillBalanceValue(b) {
    var total = reportBillTotalValue(b);
    var paid = reportBillPaidValue(b);
    if (!b || b.balance === null || b.balance === undefined) return total - paid;
    return Number(b.balance || 0);
  }

  /** Step-1 saved bill (Pending / N/A) with no payment yet — full total counts toward Bill Total. */
  function reportIsPendingUnpaidBill(b) {
    if (!b || b.voided_at) return false;
    if (reportBillTotalValue(b) <= 0.005) return false;
    if (reportBillPaidValue(b) > 0.005) return false;
    return reportPayMethodIsUnsettled(reportPayMethodKey(b.bill_type));
  }

  function dailySummaryBillDayKey(b) {
    return paymentDateKey(b && b.bill_date);
  }

  function indexDailySummaryTxByBillId(tx) {
    var map = {};
    (tx || []).forEach(function (r) {
      if (r && r.bill_id) map[String(r.bill_id)] = true;
    });
    return map;
  }

  async function mergePatientsForBills(bills, pmap) {
    pmap = pmap || {};
    var need = [];
    (bills || []).forEach(function (b) {
      if (b && b.patient_id && !pmap[b.patient_id]) need.push(b.patient_id);
    });
    if (!need.length) return pmap;
    var pts = await loadPatientsByIds(uniqIds(need));
    pts.forEach(function (p) { pmap[p.id] = p; });
    return pmap;
  }

  function buildDailySummaryPendingBillTxRow(b, p, doctors, apptCtx, day, appointmentResolver) {
    var ref = String(b.id || '').trim();
    if (!ref) {
      var ct = String(b.created_at || '').replace(/\D/g, '');
      ref = ct ? ('TX-' + ct.slice(-10)) : 'N/A';
    }
    var pmapOne = {};
    if (p && p.id) pmapOne[p.id] = p;
    var patientClinicMap = patientClinicMapFromPmap(pmapOne);
    var clinicTag = dailySummaryClinicTagForBill(b, p, null, patientClinicMap, appointmentResolver || null);
    return buildDailySummaryTxRow(b, p, {}, Object.assign({
      bill_ref: ref,
      bill_date: day,
      payment_date: day,
      clinic_tag: clinicTag,
      clinic_code: clinicCodeFromStoredTag(clinicTag)
    }, resolveBillDoctorFields(b, doctors), resolveBillAppointmentFields(b, apptCtx, day)));
  }

  async function appendPendingUnpaidBillsToDailySummaryTx(from, to, tx, pmap, doctors, apptCtx, appointmentResolver) {
    var bills = await loadBillsLiteDedupe(from, to);
    var pending = (bills || []).filter(reportIsPendingUnpaidBill);
    if (!pending.length) return tx || [];

    pmap = await mergePatientsForBills(pending, pmap);
    if (!appointmentResolver) {
      appointmentResolver = await buildAppointmentClinicResolver(from, to, pending);
    }
    var seen = indexDailySummaryTxByBillId(tx);
    var out = tx || [];

    pending.forEach(function (b) {
      if (!b || !b.id || seen[b.id]) return;
      var day = dailySummaryBillDayKey(b);
      if (!day || day < from || day > to) return;
      var p = pmap[b.patient_id] || {};
      out.push(buildDailySummaryPendingBillTxRow(b, p, doctors, apptCtx, day, appointmentResolver));
      seen[b.id] = true;
    });

    return out.sort(dailySummaryTxSortCompare);
  }

  function appendPendingRowsToDayCards(dayCards, pendingRows) {
    var cards = dayCards || [];
    var cardByDate = {};
    cards.forEach(function (c) {
      if (c && c.date) cardByDate[c.date] = c;
    });
    (pendingRows || []).forEach(function (row) {
      var d = row.bill_date || row.payment_date;
      if (!d) return;
      var card = cardByDate[d];
      if (!card) {
        card = { date: d, paidTotal: 0, rows: [] };
        cardByDate[d] = card;
        cards.push(card);
      }
      card.rows.push(row);
      card.rows.sort(dailySummaryTxSortCompare);
    });
    cards.sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
    return cards;
  }

  /** Paid amount for income / payment statistics (excludes Pending / unsettled). */
  function reportPaidForIncomeStats(b) {
    if (reportPayMethodIsUnsettled(reportPayMethodKey(b && b.bill_type))) return 0;
    return reportBillPaidValue(b);
  }

  function todayISO() {
    if (typeof window.todayISO === 'function') return window.todayISO();
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function refreshForWorkingDate() {
    var sec = g('reportSection');
    if (!sec || sec.style.display === 'none') return;
    if (!_reportInitialized) return;
    refresh();
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

  function dailySummaryGroupByDoctorEnabled() {
    if (isReportAllClinicsSelected() && _dailySummaryAllClinicsLayout === 'altogether') return false;
    return true;
  }

  function dailySummaryMonthlyDayGrouped(rows) {
    if (!dailySummaryGroupByDoctorEnabled()) return false;
    if (isReportAllClinicsSelected()) return true;
    return dailySummaryUniqueDoctorCount(rows) > 1;
  }

  function dailySummaryDoctorBreakdownHtmlIfEnabled(transactions) {
    if (!dailySummaryGroupByDoctorEnabled()) return '';
    return dailySummaryDoctorBreakdownHtml(transactions);
  }

  function dailySummaryAllClinicsLayoutToggleHtml() {
    if (!isReportAllClinicsSelected()) return '';
    var byDr = _dailySummaryAllClinicsLayout !== 'altogether';
    return '<span style="width:1px;height:22px;background:#e5e7eb;display:inline-block;"></span>' +
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<div style="font-size:12px;color:#555;font-weight:900;">' + esc(tr('report.ds.allClinicsLayoutLabel')) + '</div>' +
        '<button type="button" class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (byDr ? 'var(--primary)' : 'var(--gray)') + ';" ' +
          'onclick="REPORT.setDailySummaryAllClinicsLayout(\'byDoctor\')">' + esc(tr('report.ds.layoutByDoctors')) + '</button>' +
        '<button type="button" class="btn-add" style="padding:7px 12px;font-size:12px;background:' + (!byDr ? 'var(--primary)' : 'var(--gray)') + ';" ' +
          'onclick="REPORT.setDailySummaryAllClinicsLayout(\'altogether\')">' + esc(tr('report.ds.layoutAltogether')) + '</button>' +
      '</div>';
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

  function clinicCanonicalKey(tagOrId) {
    var code = clinicCodeFromStoredTag(tagOrId);
    var up = String(code || '').trim().toUpperCase();
    if (!up) return '';
    if (typeof APP_CLINICS !== 'undefined' && APP_CLINICS.length) {
      for (var i = 0; i < APP_CLINICS.length; i++) {
        var c = APP_CLINICS[i];
        if (!c) continue;
        var cid = String(c.id || '').trim().toUpperCase();
        var cc = String(c.clinic_code || '').trim().toUpperCase();
        if (cid && (cid === up || String(tagOrId || '').trim().toUpperCase() === cid)) {
          return cc || cid;
        }
        if (cc && cc === up) return cc;
      }
    }
    return up;
  }

  function clinicCodesMatch(a, b) {
    var x = clinicCanonicalKey(a);
    var y = clinicCanonicalKey(b);
    return !!(x && y && x === y);
  }

  function clinicCodeFromDoctorCode(doctorCode) {
    var code = String(doctorCode || '').trim();
    if (!code || typeof APP_DOCTORS === 'undefined' || !APP_DOCTORS.length) return '';
    var codeUp = code.toUpperCase();
    for (var i = 0; i < APP_DOCTORS.length; i++) {
      var d = APP_DOCTORS[i];
      if (String(d.doctor_code || '').trim().toUpperCase() !== codeUp) continue;
      if (d.clinic_id && typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(d.clinic_id);
        if (rec) return clinicCodeFromStoredTag(rec.clinic_code || rec.id);
      }
    }
    return '';
  }

  function billDoctorCodeCandidates(bill) {
    var out = [];
    var seen = {};
    function add(raw) {
      var s = String(raw || '').trim();
      if (!s) return;
      var up = s.toUpperCase();
      if (seen[up]) return;
      seen[up] = true;
      out.push(s);
    }
    if (!bill) return out;
    add(bill.doctor_code);
    add(bill.doctor_tag);
    if (typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS.length) {
      var nTag = typeof normName === 'function' ? normName(bill.doctor_tag) : '';
      var nName = typeof normName === 'function' ? normName(bill.doctor_name) : '';
      APP_DOCTORS.forEach(function (d) {
        if (!d) return;
        if (bill.doctor_id && d.id && String(bill.doctor_id) === String(d.id)) {
          add(d.doctor_code);
          return;
        }
        if (typeof doctorTextVariants === 'function') {
          var vars = doctorTextVariants(d);
          if ((nTag && vars[nTag]) || (nName && vars[nName])) add(d.doctor_code);
        }
      });
    }
    return out;
  }

  function doctorsShareCode(codeA, codeB) {
    var a = String(codeA || '').trim().toUpperCase();
    var b = String(codeB || '').trim().toUpperCase();
    return !!(a && b && a === b);
  }

  function billDoctorMatchesAppt(bill, appt) {
    if (!bill || !appt) return false;
    var apptCode = String(appt.doctor_code || '').trim();
    if (!apptCode) return false;
    var candidates = billDoctorCodeCandidates(bill);
    for (var i = 0; i < candidates.length; i++) {
      if (doctorsShareCode(candidates[i], apptCode)) return true;
    }
    return false;
  }

  function appointmentRowClinicCode(appt, af, ctx) {
    if (!appt) return '';
    var tag = clinicCodeFromStoredTag(appt[af] || appt.clinic_tag || appt.clinic_code);
    if (tag) return tag;
    if (ctx && typeof ctx.inferClinicForUntaggedAppt === 'function') {
      return ctx.inferClinicForUntaggedAppt(appt) || '';
    }
    return clinicCodeFromDoctorCode(appt.doctor_code);
  }

  function normalizePatientNo(v) {
    return String(v || '').trim().toUpperCase();
  }

  function appointmentDayKey(appt) {
    return String(appt && appt.date ? appt.date : '').slice(0, 10);
  }

  function billLookupDates(bill, payment) {
    var dates = [];
    var seen = {};
    function add(raw) {
      var d = paymentDateKey(raw);
      if (!d || seen[d]) return;
      seen[d] = true;
      dates.push(d);
    }
    if (payment && payment.paid_date) add(payment.paid_date);
    if (bill && bill.bill_date) add(bill.bill_date);
    return dates;
  }

  function billDateRangeFromBills(bills) {
    var min = '';
    var max = '';
    (bills || []).forEach(function (b) {
      var d = paymentDateKey(b && b.bill_date);
      if (!d) return;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    });
    var t = todayISO();
    return { from: min || t, to: max || t };
  }

  /**
   * Trace bills back to appointments by id, patient_id+date, patient_no+date,
   * and doctor+date. Loads the full day schedule when possible so cross-clinic
   * visits are not lost when bills carry the wrong working-clinic tag.
   */
  async function buildAppointmentClinicResolver(from, to, bills) {
    bills = bills || [];
    var af = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
      ? APPOINTMENT_CLINIC_TAG_FIELD
      : 'clinic_tag';
    var reportTag = reportClinicTag();
    var apptIds = uniqIds(bills.map(function (b) { return b && b.appointment_id; }));
    var patientIds = uniqIds(bills.map(function (b) { return b && b.patient_id; }));
    var patientNos = uniqIds(bills.map(function (b) { return normalizePatientNo(b && b.patient_no); }));
    var byId = {};
    var byPatientDate = {};
    var byPatientNoDate = {};
    var allOnDay = [];
    var doctorsByClinicDay = {};
    var CHUNK = 80;

    function pickBetterAppt(cur, next) {
      if (!cur) return next;
      if (!next) return cur;
      var curMin = dailySummaryApptTimeToMin(cur.start_time);
      var nextMin = dailySummaryApptTimeToMin(next.start_time);
      return nextMin < curMin ? next : cur;
    }

    function ingestAppt(a) {
      if (!a || !a.id) return;
      byId[a.id] = a;
      var d = appointmentDayKey(a);
      if (!d) return;
      var pid = a.patient_id || '';
      var pno = normalizePatientNo(a.patient_no);
      if (pid) {
        var key = d + '|' + pid;
        byPatientDate[key] = pickBetterAppt(byPatientDate[key], a);
      }
      if (pno) {
        var keyNo = d + '|' + pno;
        byPatientNoDate[keyNo] = pickBetterAppt(byPatientNoDate[keyNo], a);
      }
      var clinicCode = clinicCodeFromStoredTag(a[af] || a.clinic_tag || a.clinic_code);
      if (clinicCode) {
        var docCode = String(a.doctor_code || '').trim().toUpperCase();
        if (docCode) {
          var ck = d + '|' + clinicCanonicalKey(clinicCode);
          if (!doctorsByClinicDay[ck]) doctorsByClinicDay[ck] = {};
          doctorsByClinicDay[ck][docCode] = true;
        }
      }
    }

    async function queryAppts(selectCols, builder) {
      var res = await builder(SB.from('appointments').select(selectCols));
      if (res.error && /clinic_tag|clinic_code|patient_no/i.test(String(res.error.message || ''))) {
        res = await builder(SB.from('appointments').select(
          'id,date,start_time,patient_id,patient_no,doctor_code,clinic_tag'
        ));
      }
      if (res.error) throw new Error(res.error.message);
      (res.data || []).forEach(function (a) {
        ingestAppt(a);
        allOnDay.push(a);
      });
    }

    var selectCols = 'id,date,start_time,patient_id,patient_no,doctor_code,' + af;

    // All appointment queries are independent (they feed the same ingestAppt map
    // which is idempotent), so fire them all in parallel.
    var singleDay = !!(from && to && from === to);
    var _apptTasks = [];

    for (var i = 0; i < apptIds.length; i += CHUNK) {
      (function (idChunk) {
        _apptTasks.push(queryAppts(selectCols, function (q) { return q.in('id', idChunk); }));
      })(apptIds.slice(i, i + CHUNK));
    }

    if (from && to) {
      _apptTasks.push(queryAppts(selectCols, function (q) {
        return q.gte('date', from).lte('date', to)
          .order('date', { ascending: true })
          .order('start_time', { ascending: true });
      }));
    }

    // For a single day the broad date-range scan above already returns every
    // appointment on that date — patient_id and patient_no sub-queries are redundant.
    if (!singleDay && patientIds.length && from && to) {
      for (var j = 0; j < patientIds.length; j += CHUNK) {
        (function (patChunk) {
          _apptTasks.push(queryAppts(selectCols, function (q) {
            return q.gte('date', from).lte('date', to).in('patient_id', patChunk)
              .order('date', { ascending: true })
              .order('start_time', { ascending: true });
          }));
        })(patientIds.slice(j, j + CHUNK));
      }
    }

    if (!singleDay && patientNos.length && from && to) {
      for (var n = 0; n < patientNos.length; n += CHUNK) {
        (function (noChunk) {
          _apptTasks.push(queryAppts(selectCols, function (q) {
            return q.gte('date', from).lte('date', to).in('patient_no', noChunk)
              .order('date', { ascending: true })
              .order('start_time', { ascending: true });
          }));
        })(patientNos.slice(n, n + CHUNK));
      }
    }

    await Promise.all(_apptTasks);

    function apptsForPatientOnDay(bill, day) {
      var matches = [];
      var seenAppt = {};
      function push(a) {
        if (!a || !a.id || seenAppt[a.id]) return;
        seenAppt[a.id] = true;
        matches.push(a);
      }
      if (bill && bill.appointment_id && byId[bill.appointment_id]) {
        push(byId[bill.appointment_id]);
      }
      if (bill && bill.patient_id) {
        push(byPatientDate[day + '|' + bill.patient_id]);
      }
      var pno = normalizePatientNo(bill && bill.patient_no);
      if (pno) {
        push(byPatientNoDate[day + '|' + pno]);
      }
      return matches;
    }

    function findAppointmentForBill(bill, payment) {
      if (!bill) return null;
      var dates = billLookupDates(bill, payment);
      var candidates = [];
      var seen = {};
      dates.forEach(function (day) {
        apptsForPatientOnDay(bill, day).forEach(function (a) {
          if (!a || !a.id || seen[a.id]) return;
          seen[a.id] = true;
          candidates.push(a);
        });
      });
      if (!candidates.length) return null;
      if (candidates.length === 1) return candidates[0];

      var doctorMatched = candidates.filter(function (a) {
        return billDoctorMatchesAppt(bill, a);
      });
      if (doctorMatched.length === 1) return doctorMatched[0];
      if (doctorMatched.length > 1) {
        doctorMatched.sort(function (a, b) {
          return dailySummaryApptTimeToMin(a.start_time) - dailySummaryApptTimeToMin(b.start_time);
        });
        return doctorMatched[0];
      }

      if (reportTag) {
        var tagged = candidates.filter(function (a) {
          return clinicCodesMatch(appointmentRowClinicCode(a, af), reportTag);
        });
        if (tagged.length === 1) return tagged[0];
        if (tagged.length > 1) {
          tagged.sort(function (a, b) {
            return dailySummaryApptTimeToMin(a.start_time) - dailySummaryApptTimeToMin(b.start_time);
          });
          return tagged[0];
        }
      }

      candidates.sort(function (a, b) {
        return dailySummaryApptTimeToMin(a.start_time) - dailySummaryApptTimeToMin(b.start_time);
      });
      return candidates[0];
    }

    function inferClinicForUntaggedAppt(appt, bill) {
      if (!appt) return '';
      var day = appointmentDayKey(appt);
      if (!day) return '';

      var taggedClinics = {};
      allOnDay.forEach(function (a) {
        if (appointmentDayKey(a) !== day) return;
        var samePatient = false;
        if (appt.patient_id && a.patient_id && String(appt.patient_id) === String(a.patient_id)) {
          samePatient = true;
        }
        var apptNo = normalizePatientNo(appt.patient_no);
        var aNo = normalizePatientNo(a.patient_no);
        if (apptNo && aNo && apptNo === aNo) samePatient = true;
        if (!samePatient) return;
        var c = clinicCodeFromStoredTag(a[af] || a.clinic_tag || a.clinic_code);
        if (c) taggedClinics[c.toUpperCase()] = c;
      });
      var clinicKeys = Object.keys(taggedClinics);
      if (clinicKeys.length === 1) return taggedClinics[clinicKeys[0]];

      if (reportTag) {
        var schedKey = day + '|' + clinicCanonicalKey(reportTag);
        var schedDocs = doctorsByClinicDay[schedKey] || {};
        var apptDoc = String(appt.doctor_code || '').trim().toUpperCase();
        if (apptDoc && schedDocs[apptDoc]) return clinicCodeFromStoredTag(reportTag);
        var billMatchedSched = false;
        billDoctorCodeCandidates(bill).forEach(function (code) {
          if (schedDocs[String(code || '').trim().toUpperCase()]) billMatchedSched = true;
        });
        if (billMatchedSched) return clinicCodeFromStoredTag(reportTag);

        var reportCanon = clinicCanonicalKey(reportTag);
        for (var ti = 0; ti < clinicKeys.length; ti++) {
          if (clinicCanonicalKey(taggedClinics[clinicKeys[ti]]) === reportCanon) {
            return taggedClinics[clinicKeys[ti]];
          }
        }
      }
      return '';
    }

    var ctx = {
      inferClinicForUntaggedAppt: function (appt) {
        return inferClinicForUntaggedAppt(appt, null);
      }
    };

    function clinicForBill(bill, payment) {
      if (!bill) return '';
      var appt = findAppointmentForBill(bill, payment);
      if (!appt) return '';
      var ctxBill = {
        inferClinicForUntaggedAppt: function (a) {
          return inferClinicForUntaggedAppt(a, bill);
        }
      };
      return appointmentRowClinicCode(appt, af, ctxBill);
    }

    return {
      clinicForBill: clinicForBill,
      findAppointmentForBill: findAppointmentForBill,
      byId: byId,
      byPatientDate: byPatientDate,
      byPatientNoDate: byPatientNoDate
    };
  }

  /**
   * Resolve which clinic a bill/payment belongs to for reporting.
   * Appointment (visit site) is first — bills/payments often carry the staff
   * working-clinic tag (e.g. KT) even when the visit was at TKO.
   * Priority: appointment → bill → payment → patient home clinic.
   */
  function resolveTransactionClinicCode(bill, payment, patientClinicMap, appointmentResolver) {
    patientClinicMap = patientClinicMap || {};
    var apptCode = '';
    if (appointmentResolver && typeof appointmentResolver.clinicForBill === 'function') {
      apptCode = appointmentResolver.clinicForBill(bill, payment);
    }
    if (apptCode) return apptCode;
    var billTag = clinicCodeFromStoredTag(bill && (bill.clinic_tag || bill.clinic_code));
    if (billTag) return billTag;
    var payTag = clinicCodeFromStoredTag(payment && (payment.clinic_tag || payment.clinic_code));
    if (payTag) return payTag;
    if (bill && bill.patient_id && patientClinicMap[bill.patient_id] !== undefined) {
      var patientTag = clinicCodeFromStoredTag(patientClinicMap[bill.patient_id]);
      if (patientTag) return patientTag;
    }
    return '';
  }

  function patientClinicMapFromPmap(pmap) {
    var out = {};
    var field = (typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined' && PATIENT_CLINIC_TAG_FIELD)
      ? PATIENT_CLINIC_TAG_FIELD
      : 'clinic_tag';
    Object.keys(pmap || {}).forEach(function (id) {
      var p = pmap[id];
      if (p) out[id] = String(p[field] || '').trim();
    });
    return out;
  }

  function dailySummaryClinicTagForBill(bill, patient, payment, patientClinicMap, appointmentResolver) {
    var code = resolveTransactionClinicCode(bill, payment, patientClinicMap, appointmentResolver);
    if (code) return code;
    var field = (typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined' && PATIENT_CLINIC_TAG_FIELD)
      ? PATIENT_CLINIC_TAG_FIELD
      : 'clinic_tag';
    return String((bill && bill.clinic_tag) || (patient && patient[field]) || '').trim();
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

  async function loadPatientClinicMap(patientIds) {
    patientIds = uniqIds((patientIds || []).filter(Boolean));
    var pmap = {};
    if (!patientIds.length) return pmap;
    var field = typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined'
      ? PATIENT_CLINIC_TAG_FIELD
      : 'clinic_tag';
    var CHUNK = 80;
    for (var i = 0; i < patientIds.length; i += CHUNK) {
      var chunk = patientIds.slice(i, i + CHUNK);
      var pr = await SB.from('patients').select('id,' + field).in('id', chunk);
      if (pr.error) throw new Error(pr.error.message);
      (pr.data || []).forEach(function (p) {
        pmap[p.id] = String(p[field] || '').trim();
      });
    }
    return pmap;
  }

  async function loadAppointmentClinicMap(apptIds) {
    apptIds = uniqIds((apptIds || []).filter(Boolean));
    var amap = {};
    if (!apptIds.length) return amap;
    var af = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
      ? APPOINTMENT_CLINIC_TAG_FIELD
      : 'clinic_tag';
    var CHUNK = 80;
    for (var ai = 0; ai < apptIds.length; ai += CHUNK) {
      var aChunk = apptIds.slice(ai, ai + CHUNK);
      var ar = await SB.from('appointments').select('id,' + af).in('id', aChunk);
      if (ar.error) throw new Error(ar.error.message);
      (ar.data || []).forEach(function (a) {
        amap[a.id] = String(a[af] || '').trim();
      });
    }
    return amap;
  }

  /** Match a payment row (+ parent bill) to the report clinic filter. */
  function sliceMatchesReportClinic(payment, bill, patientClinicMap, appointmentResolver) {
    var tag = reportClinicTag();
    if (!tag) return true;
    if (!bill) return false;
    var code = resolveTransactionClinicCode(bill, payment, patientClinicMap, appointmentResolver);
    if (!code) return false;
    return clinicCodesMatch(code, tag);
  }

  function billMatchesReportClinic(bill, patientClinicMap, appointmentResolver) {
    return sliceMatchesReportClinic(null, bill, patientClinicMap, appointmentResolver);
  }

  async function filterBillsForReportClinic(bills, from, to) {
    var tag = reportClinicTag();
    if (!tag || !bills || !bills.length) return bills || [];

    var range = (from && to) ? { from: from, to: to } : billDateRangeFromBills(bills);
    var patientIds = uniqIds(bills.map(function (b) { return b.patient_id; }));
    var _fcPar = await Promise.all([
      loadPatientClinicMap(patientIds),
      buildAppointmentClinicResolver(range.from, range.to, bills)
    ]);
    var pmap = _fcPar[0];
    var appointmentResolver = _fcPar[1];

    return bills.filter(function (b) {
      return billMatchesReportClinic(b, pmap, appointmentResolver);
    });
  }

  /**
   * Income / summary source of truth: bill_payments.paid_date + amount.
   * Falls back to bills.amount_paid when no payment rows exist (legacy saves).
   */
  async function loadReportPaymentSlices(from, to) {
    var legacyBillsP = loadBillsLiteDedupe(from, to);   // start in-flight immediately, independent of the payments path
    var payments = await loadBillPaymentsByPaidDate(from, to);
    var billIds = uniqIds(payments.map(function (p) { return p.bill_id; }));
    var bills = await loadBillsByIdsRaw(billIds);
    var billMap = {};
    bills.forEach(function (b) { if (b && b.id) billMap[b.id] = b; });

    var _slicePar1 = await Promise.all([
      loadPatientClinicMap(uniqIds(bills.map(function (b) { return b.patient_id; }))),
      buildAppointmentClinicResolver(from, to, bills)
    ]);
    var patientClinicMap = _slicePar1[0];
    var appointmentResolver = _slicePar1[1];

    var slices = [];
    var seenBillDay = {};

    payments.forEach(function (p) {
      if (!p || p.voided_at) return;
      var b = billMap[p.bill_id];
      if (!b) return;
      if (!sliceMatchesReportClinic(p, b, patientClinicMap, appointmentResolver)) return;
      var paidDate = paymentDateKey(p.paid_date);
      if (!paidDate || paidDate < from || paidDate > to) return;
      var amt = Number(p.amount || 0);
      if (amt <= 0.005) return;
      var method = reportPayMethodCanonicalKey(p.method);
      if (reportPayMethodIsUnsettled(method)) return;
      seenBillDay[p.bill_id + '|' + paidDate] = true;
      slices.push({
        payment: p,
        bill: b,
        paid_date: paidDate,
        amount: amt,
        method: method,
        clinic_code: resolveTransactionClinicCode(b, p, patientClinicMap, appointmentResolver) || ''
      });
    });

    var legacyBills = await legacyBillsP;
    var _slicePar2 = await Promise.all([
      loadBillPaymentsForBillIds(legacyBills.map(function (b) { return b.id; }).filter(Boolean)),
      loadPatientClinicMap(uniqIds(legacyBills.map(function (b) { return b.patient_id; }))),
      buildAppointmentClinicResolver(from, to, legacyBills)
    ]);
    var legacyPaymentsByBill = indexPaymentsByBillId(_slicePar2[0]);
    var legacyPatientMap = _slicePar2[1];
    var legacyApptResolver = _slicePar2[2];
    legacyBills.forEach(function (b) {
      if (!b || !b.id) return;
      if ((legacyPaymentsByBill[b.id] || []).length) return;
      if (!sliceMatchesReportClinic(null, b, legacyPatientMap, legacyApptResolver)) return;
      var paid = reportBillPaidValue(b);
      if (paid <= 0.005) return;
      var d = paymentDateKey(b.bill_date);
      if (!d || d < from || d > to) return;
      if (seenBillDay[b.id + '|' + d]) return;
      var method = reportPayMethodCanonicalKey(b.bill_type);
      if (reportPayMethodIsUnsettled(method)) return;
      slices.push({
        payment: { method: b.bill_type, amount: paid, paid_date: d, _synthetic: true },
        bill: b,
        paid_date: d,
        amount: paid,
        method: method,
        clinic_code: resolveTransactionClinicCode(b, null, legacyPatientMap, legacyApptResolver) || ''
      });
    });

    return slices;
  }

  function groupPaymentSlicesBy(slices, keyFn) {
    var map = {};
    (slices || []).forEach(function (s) {
      var k = keyFn(s);
      if (!k) return;
      map[k] = (map[k] || 0) + Number(s.amount || 0);
    });
    return Object.keys(map).sort().map(function (k) { return { key: k, value: map[k] }; });
  }

  // Human-readable clinic name for a stored clinic code/tag (falls back to the code).
  function reportClinicLabelFromCode(code) {
    var c = String(code || '').trim();
    if (!c) return tr('report.unknown');
    if (typeof APP_CLINICS !== 'undefined' && APP_CLINICS && APP_CLINICS.length) {
      for (var i = 0; i < APP_CLINICS.length; i++) {
        var rec = APP_CLINICS[i];
        if (!rec) continue;
        var cc = String(rec.clinic_code || '').trim();
        var id = String(rec.id || '').trim();
        if ((cc && clinicCodesMatch(cc, c)) || (id && id === c)) {
          return (typeof clinicDisplayName === 'function') ? clinicDisplayName(rec) : (cc || c);
        }
      }
    }
    return c;
  }

  // Pivot payment slices into period rows × clinic columns (used by the income
  // tabs when "All clinics" is selected so every clinic's amounts stay visible).
  function pivotSlicesByPeriodAndClinic(slices, periodKeyFn) {
    var periods = {};
    var order = [];
    var clinicTotals = {};
    (slices || []).forEach(function (s) {
      var pk = periodKeyFn(s);
      if (!pk) return;
      var code = clinicCanonicalKey(s.clinic_code) || '';   // '' → untagged / unknown
      var amt = Number(s.amount || 0);
      if (!periods[pk]) { periods[pk] = { period: pk, byClinic: {}, total: 0 }; order.push(pk); }
      periods[pk].byClinic[code] = (periods[pk].byClinic[code] || 0) + amt;
      periods[pk].total += amt;
      clinicTotals[code] = (clinicTotals[code] || 0) + amt;
    });
    var codes = Object.keys(clinicTotals).sort(function (a, b) {
      if (a === '' && b !== '') return 1;            // unknown bucket last
      if (b === '' && a !== '') return -1;
      return clinicTotals[b] - clinicTotals[a];      // biggest clinic first
    });
    order.sort();
    return { codes: codes, rows: order.map(function (k) { return periods[k]; }) };
  }

  // Render an income tab broken down per clinic: Period | <clinic…> | Total.
  function renderIncomeByClinic(slices, periodKeyFn, periodKey, periodLabel) {
    var piv = pivotSlicesByPeriodAndClinic(slices, periodKeyFn);
    var columns = [{ key: periodKey, label: periodLabel }];
    piv.codes.forEach(function (code) {
      columns.push({ key: 'c_' + code, label: reportClinicLabelFromCode(code) });
    });
    columns.push({ key: 'total', label: tr('report.col.totalHkd') });
    _rows = piv.rows.map(function (r) {
      var row = {};
      row[periodKey] = r.period;
      piv.codes.forEach(function (code) {
        row['c_' + code] = Number(r.byClinic[code] || 0).toFixed(2);
      });
      row.total = Number(r.total || 0).toFixed(2);
      return row;
    });
    renderTable(columns, _rows);
    renderChartFromRows(periodKey, 'total');
  }

  function weekStartFridayIso(isoDate) {
    var d = parseDateToLocal(isoDate || todayISO());
    var day = d.getDay();
    var diffToFri = (day - 5 + 7) % 7;
    d.setDate(d.getDate() - diffToFri);
    return iso(d);
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

  /** Normalize report date range from top pickers; swaps if inverted. */
  function normalizeReportDateRange(fromIso, toIso) {
    var fromDay = String(fromIso || todayISO()).slice(0, 10) || todayISO();
    var toDay = String(toIso || fromDay).slice(0, 10) || fromDay;
    if (fromDay > toDay) {
      var tmp = fromDay;
      fromDay = toDay;
      toDay = tmp;
      setDateInputs(fromDay, toDay);
    }
    return { from: fromDay, to: toDay };
  }

  function dailySummaryExportSuffix(fromIso, toIso) {
    var range = normalizeReportDateRange(fromIso, toIso);
    if (_dailySummaryView === 'monthly') {
      return 'monthly_' + (monthKeyOf(range.from) || monthKeyOf(todayISO()));
    }
    if (range.from === range.to) return 'daily_' + range.from;
    return 'range_' + range.from + '_to_' + range.to;
  }

  function syncDailySummaryStateFromReportDates(fromIso, toIso) {
    var range = normalizeReportDateRange(fromIso, toIso);
    _dailySummaryDate = range.from;
    _dailySummaryMonth = monthKeyOf(range.from) || monthKeyOf(todayISO());
    return range;
  }

  function showPatientDirTools(show) {
    var box = g('rptPatientDirTools');
    if (!box) return;
    box.style.display = show ? 'flex' : 'none';
  }

  function showMonthlyIncomeTools(show) {
    var box = g('rptMonthlyIncomeTools');
    var dayBox = g('rptDayRangeTools');
    if (box) box.style.display = show ? 'flex' : 'none';
    if (dayBox) dayBox.style.display = show ? 'none' : 'flex';
    if (show) {
      wireMonthlyIncomeToolsOnce();
      updateMonthlyIncomeHeaderPickers();
    }
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
      _dailySummaryView = 'daily';
      _dailySummaryDate = t;
      _dailySummaryMonth = monthKeyOf(t);
      setDateInputs(t, t);
      return;
    }

    if (tabKey === 'auditTrail') {
      // Wide default window so void-bill history is visible; date pickers narrow the list.
      var yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      fromEl.value = iso(yearAgo);
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
      var def = defaultMonthlyIncomeRange();
      _monthlyIncomeFromMonth = def.from;
      _monthlyIncomeToMonth = def.to;
      applyMonthlyIncomeMonthRange(def.from, def.to);
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

  function billItemLineAmount(it) {
    return Number(it && it.qty != null ? it.qty : 0) * Number(it && it.price != null ? it.price : 0);
  }

  /**
   * Split a payment total across bill line items by each line's share of the bill subtotal.
   * Statistics income uses payment (paid) amounts — bill line prices are reference only.
   */
  function allocatePaidAmountToBillItems(itemsJson, paidAmount) {
    var items = parseBillItems(itemsJson);
    var paid = Number(paidAmount || 0);
    if (paid <= 0.005 || !items.length) return [];
    var defaultName = tr('report.treat.defaultName');
    var lines = items.map(function (it) {
      return {
        name: String(it && it.desc ? it.desc : defaultName),
        qty: Number(it && it.qty ? it.qty : 0),
        lineAmt: billItemLineAmount(it)
      };
    });
    var subtotal = lines.reduce(function (s, l) { return s + l.lineAmt; }, 0);
    if (subtotal <= 0.005) {
      if (lines.length === 1) {
        return [{ name: lines[0].name, qty: lines[0].qty, paidShare: paid }];
      }
      var even = paid / lines.length;
      return lines.map(function (l) {
        return { name: l.name, qty: l.qty, paidShare: even };
      });
    }
    return lines.map(function (l) {
      return {
        name: l.name,
        qty: l.qty,
        paidShare: paid * (l.lineAmt / subtotal)
      };
    });
  }

  function accumulateTreatmentStatsMap(byItem, itemsJson, paidAmount) {
    allocatePaidAmountToBillItems(itemsJson, paidAmount).forEach(function (line) {
      var name = line.name;
      if (!byItem[name]) byItem[name] = { frequency: 0, amount_num: 0 };
      byItem[name].frequency += line.qty;
      byItem[name].amount_num += line.paidShare;
    });
  }

  function renderTableInto(wrap, columns, rows) {
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

  function renderTable(columns, rows) {
    renderTableInto(g('rptTableWrap'), columns, rows);
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
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return null;
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
      '<script>' +
      (typeof printPopupAutoCloseInlineScript === 'function' ? printPopupAutoCloseInlineScript() : '') +
      'window.onload=function(){setTimeout(function(){try{window.print();}catch(e){if(typeof __ppClose==="function")__ppClose();}},200);};' +
      '<\/script>' +
      '</body></html>'
    );
    w.document.close();
    if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(w);
    return w;
  }

  function printTable() {
    var wrap = (_tab === 'monthlyIncome' && g('rptMonthlyIncomeBody'))
      ? g('rptMonthlyIncomeBody')
      : g('rptTableWrap');
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
      .select('id,bill_date,bill_type,total,amount_paid,balance,items,status,created_at,patient_id,appointment_id,clinic_tag,clinic_code,voided_at')
      .gte('bill_date', from)
      .lte('bill_date', to)
      .order('bill_date', { ascending: true });
    if (res.error) {
      var m = String(res.error.message || '').toLowerCase();
      if (m.indexOf('clinic_code') >= 0) {
        res = await SB.from('bills')
          .select('id,bill_date,bill_type,total,amount_paid,balance,items,status,created_at,patient_id,appointment_id,clinic_tag,voided_at')
          .gte('bill_date', from)
          .lte('bill_date', to)
          .order('bill_date', { ascending: true });
      }
    }
    if (res.error) {
      var m2 = String(res.error.message || '').toLowerCase();
      if (m2.indexOf('clinic_tag') >= 0) {
        res = await SB.from('bills')
          .select('id,bill_date,bill_type,total,amount_paid,balance,items,status,created_at,patient_id,appointment_id,voided_at')
          .gte('bill_date', from)
          .lte('bill_date', to)
          .order('bill_date', { ascending: true });
      }
    }
    if (res.error) throw new Error(res.error.message);
    return filterBillsForReportClinic(excludeVoidBills(res.data || []), from, to);
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
    if (_tab === 'dailySummary') {
      exportDailySummaryCsvFormatted();
      return;
    }
    if (_tab === 'drMonthly' && _drMonthlyMode === 'simple') {
      exportDrMonthlyIncomeCsv();
      return;
    }
    if (_tab === 'drDaily') {
      exportDrDailyDoctorIncomeExcel(_drDailyIncomeExport);
      return;
    }
    if (_tab === 'drMonthly' && _drMonthlyMode === 'detail') {
      exportClinicIncomeDetailExcel(_clinicIncomeDetailExport, 'dr_monthly_income_', { includeDoctor: true });
      return;
    }
    if (!_rows || !_rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var keys = Object.keys(_rows[0] || {});
    if (!keys.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var columns = keys.map(function (k) { return { key: k, label: k }; });
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : todayISO();
    var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : from;
    var range = normalizeReportDateRange(from, to);
    var fname = (_tab || 'report') + '_' + range.from;
    if (range.to !== range.from) fname += '_to_' + range.to;
    downloadReportExcel(fname, columns, _rows);
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
    return filterBillsForReportClinic(excludeVoidBills(res.data || []), from, to);
  }

  // ── Per-refresh deduplication helpers ────────────────────────
  function _rptClearCycleCache() {
    _rptCycleCache = Object.create(null);
  }
  // Returns the same in-flight (or resolved) Promise for identical from/to within
  // one refresh cycle, eliminating duplicate loadBillsLite round-trips.
  function loadBillsLiteDedupe(from, to) {
    var k = 'bL:' + from + '|' + to;
    if (!_rptCycleCache[k]) _rptCycleCache[k] = loadBillsLite(from, to);
    return _rptCycleCache[k];
  }

  async function loadPatientsByIds(ids) {
    ids = uniqIds((ids || []).filter(Boolean));
    if (!ids.length) return [];
    var pField = (typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined' && PATIENT_CLINIC_TAG_FIELD)
      ? PATIENT_CLINIC_TAG_FIELD
      : 'clinic_tag';
    var out = [];
    var CHUNK = 80;
    for (var i = 0; i < ids.length; i += CHUNK) {
      var chunk = ids.slice(i, i + CHUNK);
      var res = await SB.from('patients')
        .select('id,patient_no,full_name,chinese_name,' + pField)
        .in('id', chunk);
      if (res.error) throw new Error(res.error.message);
      out = out.concat(res.data || []);
    }
    return out;
  }

  async function loadAppointmentsForDailySummary(from, to, bills) {
    bills = bills || [];
    var apptIds = uniqIds(bills.map(function (b) { return b && b.appointment_id; }));
    var patientIds = uniqIds(bills.map(function (b) { return b && b.patient_id; }));
    var byId = {};
    var byPatientDate = {};
    var CHUNK = 80;

    function ingestAppt(a) {
      if (!a || !a.id) return;
      byId[a.id] = a;
      var d = String(a.date || '').slice(0, 10);
      var pid = a.patient_id || '';
      if (!d || !pid) return;
      var key = d + '|' + pid;
      if (!byPatientDate[key]) {
        byPatientDate[key] = a;
        return;
      }
      var curMin = dailySummaryApptTimeToMin(byPatientDate[key].start_time);
      var nextMin = dailySummaryApptTimeToMin(a.start_time);
      if (nextMin < curMin) byPatientDate[key] = a;
    }

    for (var i = 0; i < apptIds.length; i += CHUNK) {
      var idChunk = apptIds.slice(i, i + CHUNK);
      var res = await SB.from('appointments')
        .select('id,date,start_time,patient_id,doctor_code')
        .in('id', idChunk);
      if (res.error) throw new Error(res.error.message);
      (res.data || []).forEach(ingestAppt);
    }

    if (patientIds.length && from && to) {
      for (var j = 0; j < patientIds.length; j += CHUNK) {
        var patientChunk = patientIds.slice(j, j + CHUNK);
        var res2 = await SB.from('appointments')
          .select('id,date,start_time,patient_id,doctor_code')
          .gte('date', from)
          .lte('date', to)
          .in('patient_id', patientChunk)
          .order('date', { ascending: true })
          .order('start_time', { ascending: true });
        if (res2.error) throw new Error(res2.error.message);
        (res2.data || []).forEach(ingestAppt);
      }
    }

    return { byId: byId, byPatientDate: byPatientDate };
  }

  async function loadDoctorsForReport() {
    var res = await SB.from('doctors')
      .select('id,doctor_code,english_name,chinese_name,is_active')
      .eq('is_active', true)
      .order('doctor_code', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    var rows = res.data || [];
    var seen = {};
    var out = [];
    rows.forEach(function (d) {
      var id = String(d && d.id != null ? d.id : '').trim();
      var code = String(d && d.doctor_code != null ? d.doctor_code : '').trim();
      var en = String(d && d.english_name != null ? d.english_name : '').trim();
      var zh = String(d && d.chinese_name != null ? d.chinese_name : '').trim();
      if (!id && !code && !en && !zh) return;
      var sigCore = [code.toLowerCase(), en.toLowerCase(), zh.toLowerCase()].join('|');
      var sig = sigCore.replace(/\|/g, '') ? sigCore : ('id:' + id.toLowerCase());
      if (seen[sig]) return;
      seen[sig] = true;
      out.push(d);
    });
    out.sort(function (a, b) {
      var an = String((a && (a.display_name || a.english_name || a.chinese_name || a.doctor_code)) || '').toLowerCase();
      var bn = String((b && (b.display_name || b.english_name || b.chinese_name || b.doctor_code)) || '').toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    return out;
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

  /** Bill / due / paid aggregates for Daily Summary detail KPIs. */
  function dailySummaryAggFromTx(tx) {
    var billTotal = 0;
    var paidTotal = 0;
    var dueTotal = 0;
    (tx || []).forEach(function (r) {
      billTotal += Number(r.bill_total != null ? r.bill_total : 0);
      paidTotal += Number(r.bill_paid != null ? r.bill_paid : (r.amount != null ? r.amount : 0));
      dueTotal += Number(r.bill_balance != null ? r.bill_balance : 0);
    });
    return {
      billTotal: billTotal,
      dueTotal: dueTotal,
      paidTotal: paidTotal
    };
  }

  function dailySummaryAggFromDayCards(dayCards) {
    var all = [];
    (dayCards || []).forEach(function (c) {
      (c.rows || []).forEach(function (r) { all.push(r); });
    });
    return dailySummaryAggFromTx(all);
  }

  function dailySummaryApptTimeToMin(t) {
    var p = String(t || '').split(':');
    return (parseInt(p[0] || '0', 10) * 60) + (parseInt(p[1] || '0', 10) || 0);
  }

  function dailySummaryApptSortMinutes(b, appt) {
    if (appt && appt.start_time) return dailySummaryApptTimeToMin(appt.start_time);
    if (b && b.created_at) {
      var created = new Date(b.created_at);
      if (!isNaN(created.getTime())) {
        return created.getHours() * 60 + created.getMinutes();
      }
    }
    return 99999;
  }

  function resolveBillAppointmentFields(b, apptCtx, paymentDate) {
    apptCtx = apptCtx || { byId: {}, byPatientDate: {} };
    var appt = null;
    if (b && b.appointment_id && apptCtx.byId[b.appointment_id]) {
      appt = apptCtx.byId[b.appointment_id];
    } else if (b && b.patient_id && paymentDate) {
      var key = String(paymentDate).slice(0, 10) + '|' + b.patient_id;
      appt = apptCtx.byPatientDate[key] || null;
    }
    var startTime = appt ? String(appt.start_time || '').trim() : '';
    return {
      appointment_id: (b && b.appointment_id) || (appt && appt.id) || '',
      appointment_time: startTime ? startTime.slice(0, 5) : '',
      appointment_sort_date: String((appt && appt.date) || paymentDate || (b && b.bill_date) || '').slice(0, 10),
      appointment_sort_min: dailySummaryApptSortMinutes(b, appt)
    };
  }

  function resolveBillDoctorFields(b, doctors) {
    var doctor_id = b && b.doctor_id ? String(b.doctor_id) : '';
    var doctor_tag = String(b && b.doctor_tag != null ? b.doctor_tag : '').trim();
    var doctor_name = String(b && b.doctor_name != null ? b.doctor_name : '').trim();
    var doctor_display = doctor_name || doctor_tag || '';
    var matched = null;
    if (doctor_id && doctors && doctors.length) {
      matched = doctors.find(function (d) { return String(d.id) === doctor_id; }) || null;
    }
    if (!matched && doctors && doctors.length) {
      matched = doctors.find(function (d) { return billMatchesDoctor(b, d); }) || null;
    }
    if (matched) {
      doctor_id = String(matched.id || doctor_id || '');
      doctor_display = drDisplayName(matched) || doctor_display;
      doctor_tag = doctor_tag || doctorTagOf(matched);
      doctor_name = doctor_name || drDisplayName(matched);
    }
    if (!doctor_display) doctor_display = tr('report.ds.unknownDoctor');
    var doctor_key = normName(doctor_display) ||
      normName(doctor_tag) ||
      normName(doctor_name) ||
      doctor_id ||
      '__unknown__';
    return {
      doctor_id: doctor_id,
      doctor_name: doctor_name,
      doctor_tag: doctor_tag,
      doctor_display: doctor_display,
      doctor_key: doctor_key
    };
  }

  function dailySummaryTxSortCompare(a, b) {
    var dateCmp = String(a && a.appointment_sort_date ? a.appointment_sort_date : '')
      .localeCompare(String(b && b.appointment_sort_date ? b.appointment_sort_date : ''));
    if (dateCmp !== 0) return dateCmp;
    var am = Number(a && a.appointment_sort_min != null ? a.appointment_sort_min : 99999);
    var bm = Number(b && b.appointment_sort_min != null ? b.appointment_sort_min : 99999);
    if (am !== bm) return am - bm;
    var adr = String(a && a.doctor_display ? a.doctor_display : '').toLowerCase();
    var bdr = String(b && b.doctor_display ? b.doctor_display : '').toLowerCase();
    if (adr !== bdr) return adr < bdr ? -1 : 1;
    return String(a && a.patient_no ? a.patient_no : '').localeCompare(String(b && b.patient_no ? b.patient_no : ''));
  }

  function dailySummaryGroupEarliestSortMin(rows) {
    var min = 99999;
    (rows || []).forEach(function (r) {
      var v = Number(r && r.appointment_sort_min != null ? r.appointment_sort_min : 99999);
      if (v < min) min = v;
    });
    return min;
  }

  function dailySummaryDoctorGroupKey(t) {
    if (!t) return '__unknown__';
    return String(t.doctor_key || '').trim() ||
      normName(t.doctor_display) ||
      normName(t.doctor_tag) ||
      normName(t.doctor_name) ||
      '__unknown__';
  }

  function dailySummaryGroupTxByDoctor(transactions) {
    var map = {};
    var order = [];
    (transactions || []).forEach(function (t) {
      var k = dailySummaryDoctorGroupKey(t);
      if (!map[k]) {
        map[k] = { key: k, label: t.doctor_display || tr('report.ds.unknownDoctor'), rows: [], _clinicSet: {} };
        order.push(k);
      }
      if (t.clinic_tag) map[k]._clinicSet[t.clinic_tag] = true;
      map[k].rows.push(t);
    });
    return order.map(function (k) {
      var g = map[k];
      g.clinicTags = Object.keys(g._clinicSet).sort();
      delete g._clinicSet;
      g.rows = (g.rows || []).slice().sort(dailySummaryTxSortCompare);
      return g;
    }).sort(function (a, b) {
      var aMin = dailySummaryGroupEarliestSortMin(a.rows);
      var bMin = dailySummaryGroupEarliestSortMin(b.rows);
      if (aMin !== bMin) return aMin - bMin;
      var al = String(a.label || '').toLowerCase();
      var bl = String(b.label || '').toLowerCase();
      if (al < bl) return -1;
      if (al > bl) return 1;
      return 0;
    });
  }

  // Returns amber pill(s) showing the associated clinic(s) for a doctor group.
  // Only rendered when "All Clinics" is the active clinic filter.
  function dailySummaryGroupClinicBadgeHtml(g) {
    if (!isReportAllClinicsSelected()) return '';
    var tags = g.clinicTags || [];
    if (!tags.length) return '';
    return tags.map(function (tag) {
      return '<span style="display:inline-flex;align-items:center;background:#fffbeb;color:#92400e;' +
        'border:1px solid #fcd34d;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:800;">' +
        esc(tag) + '</span>';
    }).join('');
  }

  function dailySummaryUniqueDoctorCount(transactions) {
    var seen = {};
    (transactions || []).forEach(function (t) {
      seen[dailySummaryDoctorGroupKey(t)] = true;
    });
    return Object.keys(seen).length;
  }

  function dailySummaryMethodMiniPillsFromRows(rows) {
    var methodMiniMap = {};
    (rows || []).forEach(function (t) {
      var allocs = t.payment_allocations || [];
      if (allocs.length) {
        allocs.forEach(function (a) {
          var k = reportPayMethodCanonicalKey(a.method);
          if (reportPayMethodIsUnsettled(k)) return;
          methodMiniMap[k] = (methodMiniMap[k] || 0) + Number(a.amount || 0);
        });
        return;
      }
      var k = reportPayMethodCanonicalKey(t.payment_method);
      if (reportPayMethodIsUnsettled(k)) return;
      methodMiniMap[k] = (methodMiniMap[k] || 0) + Number(t.bill_paid || 0);
    });
    return Object.keys(methodMiniMap).sort().map(function (k) {
      return '<span style="display:inline-flex;align-items:center;gap:6px;background:#eef6ff;color:#0d6efd;border:1px solid #d9eaff;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;">' +
        '<span>' + esc(dispPayMethod(k)) + '</span><span style="color:#1f2937;">' + fmtHK(Number(methodMiniMap[k] || 0)) + '</span>' +
      '</span>';
    }).join('');
  }

  function dailySummaryDoctorBreakdownHtml(transactions) {
    var groups = dailySummaryGroupTxByDoctor(transactions);
    if (groups.length < 2) return '';
    var cards = groups.map(function (g) {
      var paid = (g.rows || []).reduce(function (acc, r) { return acc + Number(r.bill_paid || 0); }, 0);
      var pills = dailySummaryMethodMiniPillsFromRows(g.rows);
      var clinicBadge = dailySummaryGroupClinicBadgeHtml(g);
      return '<div style="background:#fff;border:1px solid #dbeafe;border-radius:12px;padding:10px 12px;min-width:200px;flex:1 1 220px;max-width:360px;box-shadow:0 2px 8px rgba(15,23,42,.04);">' +
        '<div style="font-size:12px;font-weight:900;color:#1e40af;line-height:1.35;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
          esc(g.label) + clinicBadge +
        '</div>' +
        '<div style="font-size:16px;font-weight:900;color:#15803d;margin-top:4px;">' + fmtHK(paid) + '</div>' +
        '<div style="font-size:11px;color:#64748b;font-weight:800;margin-top:4px;">' +
          esc(trRepl('report.ds.monthly.txCount', { N: String((g.rows || []).length) })) +
        '</div>' +
        (pills ? '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;">' + pills + '</div>' : '') +
      '</div>';
    }).join('');
    return '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;padding:10px 12px;margin-bottom:12px;' +
      'box-shadow:0 2px 8px rgba(15,23,42,.04);">' +
      '<div style="font-size:12px;font-weight:900;color:#0d6efd;margin-bottom:8px;">' +
        esc(tr('report.ds.doctorTotalsTitle')) +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;">' + cards + '</div>' +
    '</div>';
  }

  function dailySummarySimpleRowHtml(t, td, showClinicCol) {
    return '<tr>' +
      '<td style="' + td + '">' + esc(t.patient_no) + '</td>' +
      '<td style="' + td + '">' + esc(t.patient_chinese) + '</td>' +
      '<td style="' + td + '">' + esc(t.patient_name) + '</td>' +
      (showClinicCol ? ('<td style="' + td + '">' + esc(t.clinic_tag || '') + '</td>') : '') +
      '<td style="' + td + '">' + esc(dispPayMethodTxSummary(t)) + '</td>' +
      '<td style="' + td + 'text-align:right;font-weight:900;color:#15803d;">' + fmtHK(Number(t.bill_paid || 0)) + '</td>' +
      '<td style="' + td + '">' + esc(t.remarks) + '</td>' +
    '</tr>';
  }

  function dailySummarySimpleDoctorGroupHeaderHtml(g, colSpan) {
    var paid = (g.rows || []).reduce(function (acc, r) { return acc + Number(r.bill_paid || 0); }, 0);
    var pills = dailySummaryMethodMiniPillsFromRows(g.rows);
    var clinicBadge = dailySummaryGroupClinicBadgeHtml(g);
    return '<tr>' +
      '<td colspan="' + colSpan + '" style="padding:10px 12px;background:#f0f7ff;border-bottom:1px solid #dbeafe;vertical-align:middle;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
          '<div>' +
            '<div style="font-size:13px;font-weight:900;color:#1e40af;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
              esc(g.label) + clinicBadge +
            '</div>' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;margin-top:2px;">' +
              esc(trRepl('report.ds.monthly.txCount', { N: String((g.rows || []).length) })) +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(tr('report.ds.dailyPaidTotal')) + '</div>' +
            '<div style="font-size:15px;font-weight:900;color:#15803d;">' + fmtHK(paid) + '</div>' +
          '</div>' +
        '</div>' +
        (pills ? '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;">' + pills + '</div>' : '') +
      '</td>' +
    '</tr>';
  }

  function dailySummarySimpleBodyHtml(transactions, td, showClinicCol) {
    var tx = transactions || [];
    if (!tx.length) return '';
    if (!dailySummaryGroupByDoctorEnabled()) {
      return tx.map(function (t) {
        return dailySummarySimpleRowHtml(t, td, showClinicCol);
      }).join('');
    }
    var colSpan = showClinicCol ? 7 : 6;
    return dailySummaryGroupTxByDoctor(tx).map(function (g) {
      var header = dailySummarySimpleDoctorGroupHeaderHtml(g, colSpan);
      var rows = (g.rows || []).map(function (t) {
        return dailySummarySimpleRowHtml(t, td, showClinicCol);
      }).join('');
      return header + rows;
    }).join('');
  }

  var REPORT_DS_PAY_METHOD_DEFAULTS = ['Cash', 'Visa', 'Mastercard', 'EPS', 'Octopus'];

  var REPORT_DS_PAY_METHOD_STYLE = {
    Cash:      { bg: '#ecfdf5', border: '#86efac', label: '#166534', val: '#15803d' },
    Visa:      { bg: '#eff6ff', border: '#93c5fd', label: '#1e40af', val: '#1d4ed8' },
    Mastercard:{ bg: '#fff7ed', border: '#fdba74', label: '#9a3412', val: '#c2410c' },
    Master:    { bg: '#fff7ed', border: '#fdba74', label: '#9a3412', val: '#c2410c' },
    EPS:       { bg: '#f5f3ff', border: '#c4b5fd', label: '#5b21b6', val: '#6d28d9' },
    Octopus:   { bg: '#fdf2f8', border: '#f9a8d4', label: '#9d174d', val: '#db2777' }
  };

  var REPORT_DS_PAY_METHOD_FALLBACK = {
    bg: '#f8fafc', border: '#e2e8f0', label: '#475569', val: '#0d6efd'
  };

  function dailySummaryPayMethodKeysOrdered(totalsByMethodPaid) {
    var paidMap = {};
    (totalsByMethodPaid || []).forEach(function (x) {
      var k = reportPayMethodCanonicalKey(x.key);
      if (!k || reportPayMethodIsUnsettled(k)) return;
      paidMap[k] = Number(x.value || 0);
    });
    var out = [];
    REPORT_DS_PAY_METHOD_DEFAULTS.forEach(function (k) {
      if (out.indexOf(k) < 0) out.push(k);
    });
    Object.keys(paidMap).sort().forEach(function (k) {
      if (out.indexOf(k) < 0) out.push(k);
    });
    return out.map(function (k) { return { key: k, value: paidMap[k] || 0 }; });
  }

  function dailySummaryPayMethodCardHtml(item) {
    var st = REPORT_DS_PAY_METHOD_STYLE[item.key] || REPORT_DS_PAY_METHOD_FALLBACK;
    return '<div style="background:' + st.bg + ';border:1px solid ' + st.border + ';border-radius:12px;' +
      'padding:10px 12px;min-width:118px;flex:1 1 118px;max-width:220px;' +
      'box-shadow:0 2px 8px rgba(15,23,42,.06);">' +
      '<div style="font-size:11px;font-weight:900;color:' + st.label + ';letter-spacing:.02em;">' +
        esc(dispPayMethod(item.key)) +
      '</div>' +
      '<div style="font-size:17px;font-weight:900;color:' + st.val + ';margin-top:4px;">' +
        fmtHK(Number(item.value || 0)) +
      '</div>' +
    '</div>';
  }

  /** Header zone: paid total + highlighted payment-method cards (Daily Summary). */
  function dailySummaryHeaderZoneHtml(totalsByMethodPaid, paidTotal, overviewTitleKey, extraOverviewHtml) {
    var items = dailySummaryPayMethodKeysOrdered(totalsByMethodPaid);
    var cards = items.map(dailySummaryPayMethodCardHtml).join('');
    if (!cards) {
      cards = '<div style="padding:6px 0;color:#64748b;font-size:12px;">' +
        esc(tr('report.ds.monthly.noMethodTotals')) + '</div>';
    }
    var titleKey = overviewTitleKey || 'report.ds.dailyOverviewTitle';
    return '<div style="background:linear-gradient(135deg,#0d6efd,#2b8fff);border-radius:14px;padding:12px 14px;' +
      'color:#fff;margin-bottom:12px;box-shadow:0 5px 14px rgba(13,110,253,.22);">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
        '<div style="min-width:160px;">' +
          '<div style="font-size:12px;font-weight:800;opacity:.92;">' + esc(tr(titleKey)) + '</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.24);border-radius:12px;' +
          'padding:8px 12px;min-width:150px;">' +
          '<div style="font-size:11px;font-weight:700;opacity:.92;">' + esc(tr('report.ds.dailyPaidTotal')) + '</div>' +
          '<div style="font-size:20px;font-weight:900;margin-top:2px;">' + fmtHK(Number(paidTotal || 0)) + '</div>' +
        '</div>' +
      '</div>' +
      (extraOverviewHtml || '') +
    '</div>' +
    '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;padding:10px 12px;margin-bottom:12px;' +
      'box-shadow:0 2px 8px rgba(15,23,42,.04);">' +
      '<div style="font-size:12px;font-weight:900;color:#0d6efd;margin-bottom:8px;">' +
        esc(tr('report.ds.monthly.paymentTotalsTitle')) +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;">' + cards + '</div>' +
    '</div>';
  }

  function reportExportFilename(name) {
    return String(name || 'report').replace(/\.(csv|xls|xlsx)$/i, '') + '.xlsx';
  }

  var _reportXlsxLibPromise = null;
  var _reportXlsxStyled = false;

  function loadReportXlsxLib() {
    if (_reportXlsxStyled && typeof XLSX !== 'undefined' && XLSX.utils && XLSX.writeFile) {
      return Promise.resolve(XLSX);
    }
    if (!_reportXlsxLibPromise || !_reportXlsxStyled) {
      _reportXlsxLibPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js';
        s.async = true;
        s.onload = function () {
          if (typeof XLSX !== 'undefined' && XLSX.utils && XLSX.writeFile) {
            _reportXlsxStyled = true;
            resolve(XLSX);
          } else {
            reject(new Error('XLSX library failed to initialize'));
          }
        };
        s.onerror = function () { reject(new Error('Failed to load XLSX library')); };
        document.head.appendChild(s);
      });
    }
    return _reportXlsxLibPromise;
  }

  function reportExcelBaseCellStyle(extra) {
    var base = {
      font: { name: 'Calibri', sz: 11, color: { rgb: '000000' } },
      alignment: { vertical: 'top', wrapText: false }
    };
    if (!extra) return base;
    if (extra.font) extra.font = Object.assign({}, base.font, extra.font);
    if (extra.alignment) extra.alignment = Object.assign({}, base.alignment, extra.alignment);
    return Object.assign({}, base, extra);
  }

  function applyReportExcelSheetStyles(ws, sheetData) {
    if (!ws || !sheetData) return;
    var headerRow = sheetData.headerRowIndex;
    var colCount = sheetData.colCount || 0;
    var prefaceCount = sheetData.prefaceCount || 0;
    var numericCols = sheetData.numericColIndices || [];
    var numericColFormats = sheetData.numericColFormats || {};
    var aoa = sheetData.aoa || [];
    var r;
    var c;
    var addr;
    var cell;

    if (prefaceCount > 0) {
      addr = XLSX.utils.encode_cell({ r: 0, c: 0 });
      cell = ws[addr];
      if (cell) {
        cell.s = reportExcelBaseCellStyle({ font: { bold: true } });
      }
    }

    if (headerRow >= 0) {
      var headerBorderStyle = sheetData.headerBottomBorder || 'thin';
      for (c = 0; c < colCount; c++) {
        addr = XLSX.utils.encode_cell({ r: headerRow, c: c });
        cell = ws[addr];
        if (!cell) continue;
        cell.s = reportExcelBaseCellStyle({
          font: { bold: true },
          border: { bottom: { style: headerBorderStyle, color: { rgb: '000000' } } }
        });
      }
    }

    (sheetData.columnHeaderRows || []).forEach(function (rowIdx) {
      var colHeaderBorder = sheetData.headerBottomBorder || 'thin';
      for (c = 0; c < colCount; c++) {
        addr = XLSX.utils.encode_cell({ r: rowIdx, c: c });
        cell = ws[addr];
        if (!cell) continue;
        cell.s = reportExcelBaseCellStyle({
          font: { bold: true },
          border: { bottom: { style: colHeaderBorder, color: { rgb: '000000' } } }
        });
      }
    });

    (sheetData.sectionHeaderRows || []).forEach(function (rowIdx) {
      addr = XLSX.utils.encode_cell({ r: rowIdx, c: 0 });
      cell = ws[addr];
      if (cell) {
        cell.s = reportExcelBaseCellStyle({ font: { bold: true } });
      }
    });

    (sheetData.boldRows || []).forEach(function (rowIdx) {
      for (c = 0; c < colCount; c++) {
        addr = XLSX.utils.encode_cell({ r: rowIdx, c: c });
        cell = ws[addr];
        if (!cell) continue;
        var existing = cell.s || reportExcelBaseCellStyle();
        cell.s = reportExcelBaseCellStyle(Object.assign({}, existing, {
          font: Object.assign({}, (existing.font || {}), { bold: true })
        }));
      }
    });

    var styledSkipRows = {};
    (sheetData.columnHeaderRows || []).forEach(function (i) { styledSkipRows[i] = true; });
    (sheetData.sectionHeaderRows || []).forEach(function (i) { styledSkipRows[i] = true; });

    for (r = headerRow + 1; r < aoa.length; r++) {
      if (styledSkipRows[r]) continue;
      numericCols.forEach(function (colIdx) {
        addr = XLSX.utils.encode_cell({ r: r, c: colIdx });
        cell = ws[addr];
        if (!cell || cell.v === '' || cell.v === null || cell.v === undefined) return;
        var fmt = numericColFormats[colIdx] || '#,##0.00';
        cell.s = reportExcelBaseCellStyle({
          alignment: { horizontal: 'right' },
          numFmt: typeof cell.v === 'number' ? fmt : undefined
        });
      });
    }

    ws['!views'] = [{ showGridLines: true }];
  }

  function reportExcelColWidthChars(px) {
    return Math.max(8, Math.round(Number(px || 140) / 7));
  }

  function buildReportExcelAoA(opts) {
    opts = opts || {};
    var preface = opts.prefaceRows || [];
    var columns = opts.columns || [];
    var rows = opts.rows || [];
    var keys = columns.map(function (c) { return c.key; });
    var labels = columns.map(function (c) { return c.label; });
    var colCount = Math.max(columns.length, 1);
    var colWidths = columns.map(function (c, i) {
      if (opts.colWidths && opts.colWidths[i]) return opts.colWidths[i];
      return reportExcelColWidth(c.key, c.label);
    });
    var numericKeys = {};
    keys.forEach(function (k) {
      if (isReportExcelNumericKey(k)) numericKeys[k] = true;
    });
    (opts.numericKeys || []).forEach(function (k) { numericKeys[k] = true; });

    function cellVal(v, key) {
      if (v === null || v === undefined || v === '') return '';
      if (numericKeys[key]) {
        var n = Number(v);
        if (!isNaN(n)) return n;
      }
      return String(v);
    }

    function blankRow() {
      var r = [];
      for (var i = 0; i < colCount; i++) r.push('');
      return r;
    }

    var aoa = [];
    var merges = [];
    var headerRowIndex = -1;

    preface.forEach(function (line) {
      var r = blankRow();
      r[0] = String(line || '');
      merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: colCount - 1 } });
      aoa.push(r);
    });
    if (preface.length) aoa.push(blankRow());

    var skipGlobalHeader = !!opts.skipGlobalHeader;
    var sectionHeaderRows = [];
    var columnHeaderRows = [];
    var boldRows = [];

    if (!skipGlobalHeader) {
      headerRowIndex = aoa.length;
      aoa.push(labels.slice());
    }

    rows.forEach(function (row) {
      var rowMeta = (typeof opts.rowMeta === 'function') ? (opts.rowMeta(row) || {}) : {};
      if (row._type === 'columnHeader' || rowMeta.columnHeader) {
        columnHeaderRows.push(aoa.length);
      }
      if (row._type === 'doctorSection' || rowMeta.sectionHeader) {
        sectionHeaderRows.push(aoa.length);
        if (colCount > 1) {
          merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: colCount - 1 } });
        }
      }
      if (rowMeta.bold || row._type === 'total') {
        boldRows.push(aoa.length);
      }
      aoa.push(keys.map(function (k, i) {
        var v = cellVal(row[k], k);
        if (rowMeta.indentCol === i && v) v = '  ' + String(v);
        return v;
      }));
    });

    var numericColIndices = [];
    var numericColFormats = {};
    keys.forEach(function (k, i) {
      if (!numericKeys[k]) return;
      numericColIndices.push(i);
      numericColFormats[i] = (k === 'tx_count') ? '0' : '#,##0.00';
    });

    return {
      aoa: aoa,
      colWidths: colWidths,
      merges: merges,
      headerRowIndex: headerRowIndex,
      colCount: colCount,
      prefaceCount: preface.length,
      numericColIndices: numericColIndices,
      numericColFormats: numericColFormats,
      sectionHeaderRows: sectionHeaderRows,
      columnHeaderRows: columnHeaderRows,
      boldRows: boldRows,
      headerBottomBorder: opts.headerBottomBorder || 'thin'
    };
  }

  function downloadReportExcelWorkbook(filename, sheetData) {
    var ws = XLSX.utils.aoa_to_sheet(sheetData.aoa);
    if (sheetData.merges && sheetData.merges.length) ws['!merges'] = sheetData.merges;
    ws['!cols'] = (sheetData.colWidths || []).map(function (w) {
      return { wch: reportExcelColWidthChars(w) };
    });
    applyReportExcelSheetStyles(ws, sheetData);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, reportExportFilename(filename), { bookType: 'xlsx', compression: true, cellStyles: true });
  }

  function downloadReportExcel(filename, columns, rows, opts) {
    if (!rows || !rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var sheetData = buildReportExcelAoA(Object.assign({ columns: columns, rows: rows }, opts || {}));
    loadReportXlsxLib().then(function () {
      downloadReportExcelWorkbook(filename, sheetData);
    }).catch(function (e) {
      alert(trRepl('report.alert.exportFailed', { MSG: e.message || String(e) }));
    });
  }

  function reportExcelColWidth(key, label) {
    var k = String(key || '').toLowerCase();
    if (k.indexOf('remark') >= 0 || k.indexOf('item') >= 0 || k.indexOf('treatment') >= 0) return 240;
    if (k.indexOf('chinese') >= 0 || k.indexOf('english') >= 0 || k.indexOf('patient_name') >= 0) return 180;
    if (k.indexOf('patient') >= 0 || k.indexOf('doctor') >= 0) return 160;
    if (k.indexOf('date') >= 0 || k.indexOf('month') >= 0 || k.indexOf('week') >= 0) return 150;
    if (k.indexOf('method') >= 0 || k.indexOf('account') >= 0) return 150;
    if (k.indexOf('paid') >= 0 || k.indexOf('total') >= 0 || k.indexOf('amount') >= 0 || k.indexOf('balance') >= 0 || k.indexOf('income') >= 0) return 120;
    if (k.indexOf('freq') >= 0 || k.indexOf('count') >= 0 || k.indexOf('bills') >= 0) return 110;
    if (String(label || '').length > 12) return 160;
    return 140;
  }

  function isReportExcelNumericKey(key) {
    var k = String(key || '').toLowerCase();
    if (k === 'payment_method' || k === 'method' || k === 'account') return false;
    return /(^|_)(paid|total|amount|balance|income|value|freq|frequency|bills?|count|tx_count)(_|$)/.test(k) ||
      k === 'paid' || k === 'total' || k === 'amount' || k === 'balance' || k === 'income';
  }

  function downloadCSV(filename, columns, rows) {
    downloadReportExcel(filename, columns, rows);
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

  function renderDailySummaryDaily(transactions, totalsByMethodPaid) {
    var body = g('rptDailySummaryBody');
    if (!body) return;
    var agg = dailySummaryAggFromTx(transactions);

    var th = 'padding:10px 10px;background:#f0f7ff;color:#0d6efd;font-size:12px;font-weight:900;border-bottom:2px solid #dde8f5;text-align:left;';
    var td = 'padding:9px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:middle;';

    var showClinicCol = isReportAllClinicsSelected();
    var rowsHtml = dailySummarySimpleBodyHtml(transactions, td, showClinicCol);

    body.innerHTML =
      dailySummaryHeaderZoneHtml(totalsByMethodPaid, agg.paidTotal, 'report.ds.dailyOverviewTitle') +
      dailySummaryDoctorBreakdownHtmlIfEnabled(transactions) +
      '<div style="border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff;">' +
        '<div style="overflow:auto;max-height:520px;">' +
          '<table style="width:100%;border-collapse:collapse;min-width:860px;">' +
            '<thead><tr>' +
              '<th style="' + th + 'width:120px;">' + esc(tr('report.col.patientNo')) + '</th>' +
              '<th style="' + th + 'width:160px;">' + esc(tr('report.col.chinese')) + '</th>' +
              '<th style="' + th + '">' + esc(tr('report.ds.col.english')) + '</th>' +
              (showClinicCol ? ('<th style="' + th + 'width:130px;">' + esc(tr('report.col.clinicTag')) + '</th>') : '') +
              '<th style="' + th + 'width:150px;">' + esc(tr('report.ds.col.payment')) + '</th>' +
              '<th style="' + th + 'width:120px;text-align:right;">' + esc(tr('report.ds.col.paid')) + '</th>' +
              '<th style="' + th + 'width:220px;">' + esc(tr('report.col.remarks')) + '</th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function renderDailySummaryMonthly(dayCards, monthTotalsByMethodPaid) {
    var body = g('rptDailySummaryBody');
    if (!body) return;

    var dayCount = dayCards.length;
    var txCount = 0;
    dayCards.forEach(function (c) { txCount += (c.rows || []).length; });
    var agg = dailySummaryAggFromDayCards(dayCards);

    var monthlyExtraOverview =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;width:100%;">' +
        '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:8px 10px;min-width:130px;">' +
          '<div style="font-size:11px;font-weight:700;opacity:.9;">' + esc(tr('report.ds.monthly.daysWithBills')) + '</div>' +
          '<div style="margin-top:2px;font-size:18px;font-weight:900;">' + dayCount + '</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:8px 10px;min-width:130px;">' +
          '<div style="font-size:11px;font-weight:700;opacity:.9;">' + esc(tr('report.ds.monthly.transactions')) + '</div>' +
          '<div style="margin-top:2px;font-size:18px;font-weight:900;">' + txCount + '</div>' +
        '</div>' +
      '</div>';

    var cardsHtml = dayCards.map(function (c) {
      var methodMini = dailySummaryMethodMiniPillsFromRows(c.rows);

      var showClinicCol = isReportAllClinicsSelected();
      var multiDrDay = dailySummaryMonthlyDayGrouped(c.rows);
      var gridCols = showClinicCol
        ? (multiDrDay
          ? 'minmax(90px,110px) minmax(180px,1fr) minmax(100px,120px) minmax(110px,130px) minmax(110px,130px) minmax(100px,120px)'
          : 'minmax(90px,110px) minmax(200px,1fr) minmax(110px,130px) minmax(120px,140px) minmax(100px,120px)')
        : (multiDrDay
          ? 'minmax(90px,110px) minmax(200px,1fr) minmax(110px,130px) minmax(110px,130px) minmax(100px,120px)'
          : 'minmax(90px,110px) minmax(220px,1fr) minmax(120px,140px) minmax(100px,120px)');

      function monthlyDayRowHtml(t) {
        return '<div style="display:grid;grid-template-columns:' + gridCols + ';gap:10px;align-items:start;padding:10px 0;border-bottom:1px dashed #e6edf5;">' +
          '<div style="font-weight:900;color:#0d6efd;font-size:12px;">' + esc(t.patient_no || '-') + '</div>' +
          '<div style="min-width:0;">' +
            '<div style="font-size:13px;font-weight:900;color:#1f2937;line-height:1.35;">' + esc(t.patient_chinese || '') + (t.patient_name ? (' / ' + esc(t.patient_name)) : '') + '</div>' +
            (t.remarks ? '<div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.35;">' + esc(t.remarks) + '</div>' : '') +
          '</div>' +
          (multiDrDay ? ('<div style="color:#1e40af;font-weight:900;font-size:12px;">' + esc(t.doctor_display || '') + '</div>') : '') +
          (showClinicCol ? ('<div style="color:#334155;font-weight:900;font-size:12px;">' + esc(t.clinic_tag || '') + '</div>') : '') +
          '<div style="color:#475569;font-weight:900;font-size:12px;">' + esc(dispPayMethodTxSummary(t)) + '</div>' +
          '<div style="text-align:right;font-weight:900;color:#15803d;font-size:12px;">' + fmtHK(Number(t.bill_paid || 0)) + '</div>' +
        '</div>';
      }

      var rows = '';
      if (multiDrDay) {
        rows = dailySummaryGroupTxByDoctor(c.rows).map(function (g) {
          var drPaid = (g.rows || []).reduce(function (acc, r) { return acc + Number(r.bill_paid || 0); }, 0);
          var drPills = dailySummaryMethodMiniPillsFromRows(g.rows);
          var sectionHeader =
            '<div style="padding:8px 0 6px 0;margin-top:6px;border-top:1px solid #edf2f7;">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<div style="font-size:12px;font-weight:900;color:#1e40af;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                  esc(g.label) + dailySummaryGroupClinicBadgeHtml(g) +
                '</div>' +
                '<div style="font-size:12px;font-weight:900;color:#15803d;">' + fmtHK(drPaid) + '</div>' +
              '</div>' +
              (drPills ? '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">' + drPills + '</div>' : '') +
            '</div>';
          var sectionRows = (g.rows || []).map(monthlyDayRowHtml).join('');
          return sectionHeader + sectionRows;
        }).join('');
      } else {
        rows = (c.rows || []).map(monthlyDayRowHtml).join('');
      }

      var doctorMini = '';
      if (multiDrDay) {
        doctorMini = dailySummaryGroupTxByDoctor(c.rows).map(function (g) {
          var drPaid = (g.rows || []).reduce(function (acc, r) { return acc + Number(r.bill_paid || 0); }, 0);
          return '<span style="display:inline-flex;align-items:center;gap:6px;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;">' +
            '<span>' + esc(g.label) + '</span><span style="color:#15803d;">' + fmtHK(drPaid) + '</span>' +
          '</span>';
        }).join('');
      }

      return '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:14px;padding:12px 14px;margin-bottom:12px;box-shadow:0 3px 10px rgba(15,23,42,.04);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid #edf2f7;">' +
          '<div style="font-weight:900;color:#0d6efd;font-size:14px;">' + esc(c.date) + '</div>' +
          '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(trRepl('report.ds.monthly.txCount', { N: String((c.rows || []).length) })) + '</div>' +
            '<div style="font-size:14px;font-weight:900;color:#15803d;">' + fmtHK(Number(c.paidTotal || 0)) + '</div>' +
          '</div>' +
        '</div>' +
        (doctorMini ? '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 2px 0;">' + doctorMini + '</div>' : '') +
        (methodMini ? '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 4px 0;">' + methodMini + '</div>' : '') +
        '<div style="margin-top:2px;">' + rows + '</div>' +
      '</div>';
    }).join('');

    if (!cardsHtml) {
      cardsHtml = '<div style="background:#fff;border:1px dashed #d7e2f0;border-radius:12px;padding:22px;text-align:center;color:#64748b;">' + esc(tr('report.ds.monthly.noBillingTx')) + '</div>';
    }

    var monthAllRows = [];
    dayCards.forEach(function (c) {
      (c.rows || []).forEach(function (r) { monthAllRows.push(r); });
    });

    body.innerHTML =
      '<div style="max-height:640px;overflow:auto;padding-right:2px;">' +
        dailySummaryHeaderZoneHtml(monthTotalsByMethodPaid, agg.paidTotal, 'report.ds.monthly.overviewTitle', monthlyExtraOverview) +
        dailySummaryDoctorBreakdownHtmlIfEnabled(monthAllRows) +
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
    var doctorLine = t.doctor_display
      ? ('<div style="font-size:11px;color:#1e40af;font-weight:800;margin-top:4px;line-height:1.35;">' + esc(tr('report.dr.labelDoctor')) + ': ' + esc(t.doctor_display) + '</div>')
      : '';
    return '<tr>' +
      '<td style="width:10%;padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#334155;vertical-align:top;word-break:break-word;">' + esc(t.bill_date || '') + '</td>' +
      '<td style="width:20%;padding:10px 8px;border-bottom:1px solid #eef2f7;vertical-align:top;word-break:break-word;">' +
        '<div style="font-size:12px;color:#0d6efd;font-weight:900;">' + esc(t.patient_no || '-') + '</div>' +
        '<div style="font-size:12px;color:#0f172a;font-weight:900;line-height:1.35;margin-top:2px;">' + nameLine + '</div>' +
        doctorLine +
      '</td>' +
      '<td style="width:14%;padding:10px 8px;border-bottom:1px solid #eef2f7;vertical-align:top;word-break:break-word;">' +
        '<div style="font-size:12px;color:#475569;font-weight:900;">' + esc(dispPayMethodTxSummary(t)) + '</div>' +
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

  function renderDailySummaryDetailDaily(transactions, totalsByMethodPaid) {
    var body = g('rptDailySummaryBody');
    if (!body) return;
    var agg = dailySummaryAggFromTx(transactions);
    var totalTreatments = 0;
    transactions.forEach(function (t) {
      totalTreatments += treatmentEntriesHtml(t.treatment_items).count;
    });

    var showClinicCol = isReportAllClinicsSelected();
    var rowsHtml = transactions.map(function (t) { return detailTxRowHtml(t, false, showClinicCol); }).join('');
    if (!rowsHtml) {
      rowsHtml = '<tr><td colspan="' + (showClinicCol ? '8' : '7') + '" style="padding:20px;text-align:center;color:#64748b;">' + esc(tr('report.ds.detail.noDetailedTx')) + '</td></tr>';
    }

    body.innerHTML =
      dailySummaryHeaderZoneHtml(totalsByMethodPaid, agg.paidTotal, 'report.ds.dailyOverviewTitle') +
      dailySummaryDoctorBreakdownHtmlIfEnabled(transactions) +
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
          '<div style="font-size:18px;color:#c2410c;font-weight:900;margin-top:2px;">' + fmtHK(agg.billTotal) + '</div>' +
        '</div>' +
        '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:10px 12px;min-width:190px;">' +
          '<div style="font-size:11px;color:#166534;font-weight:800;">' + esc(tr('report.ds.dailyPaidTotal')) + '</div>' +
          '<div style="font-size:18px;color:#15803d;font-weight:900;margin-top:2px;">' + fmtHK(agg.paidTotal) + '</div>' +
        '</div>' +
        '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;min-width:210px;">' +
          '<div style="font-size:11px;color:#991b1b;font-weight:800;">' + esc(tr('report.ds.dailyDueAmount')) + '</div>' +
          '<div style="font-size:18px;color:#dc2626;font-weight:900;margin-top:2px;">' + fmtHK(agg.dueTotal) + '</div>' +
        '</div>' +
      '</div>' +
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

  function renderDailySummaryDetailMonthly(dayCards, monthTotalsByMethodPaid) {
    var body = g('rptDailySummaryBody');
    if (!body) return;
    var showClinicCol = isReportAllClinicsSelected();
    var agg = dailySummaryAggFromDayCards(dayCards);

    var totalBills = 0;
    var totalTreatments = 0;
    dayCards.forEach(function (c) {
      (c.rows || []).forEach(function (t) {
        totalBills += 1;
        totalTreatments += treatmentEntriesHtml(t.treatment_items).count;
      });
    });

    var sectionsHtml = dayCards.map(function (c) {
      var dayBillTotal = (c.rows || []).reduce(function (acc, r) {
        return acc + Number(r.bill_total || 0);
      }, 0);
      var rowsHtml = (c.rows || []).map(function (t) { return detailTxRowHtml(t, true, showClinicCol); }).join('');
      if (!rowsHtml) {
        rowsHtml = '<tr><td colspan="' + (showClinicCol ? '8' : '7') + '" style="padding:14px;color:#64748b;text-align:center;">' + esc(tr('report.ds.detail.monthlyNoDetailRows')) + '</td></tr>';
      }
      return '<div style="background:#fff;border:1px solid #dfe9f5;border-radius:12px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 8px rgba(15,23,42,.04);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#f8fbff;border-bottom:1px solid #e6edf5;">' +
          '<div style="font-size:13px;font-weight:900;color:#0d6efd;">' + esc(c.date) + '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
            '<div style="font-size:11px;color:#64748b;font-weight:800;">' + esc(trRepl('report.ds.detail.monthlyBillsCount', { N: String((c.rows || []).length) })) + '</div>' +
            '<div style="font-size:11px;color:#166534;font-weight:800;">' + esc(tr('report.ds.dailyPaidTotal')) + ' ' + fmtHK(Number(c.paidTotal || 0)) + '</div>' +
            '<div style="font-size:11px;color:#7c2d12;font-weight:800;">' + esc(tr('report.ds.detail.kpiBillTotal')) + ' ' + fmtHK(dayBillTotal) + '</div>' +
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

    var monthAllRows = [];
    dayCards.forEach(function (c) {
      (c.rows || []).forEach(function (r) { monthAllRows.push(r); });
    });

    body.innerHTML =
      '<div style="max-height:640px;overflow:auto;padding-right:2px;">' +
        dailySummaryHeaderZoneHtml(monthTotalsByMethodPaid, agg.paidTotal, 'report.ds.monthly.overviewTitle') +
        dailySummaryDoctorBreakdownHtmlIfEnabled(monthAllRows) +
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
            '<div style="margin-top:2px;font-size:18px;color:#c2410c;font-weight:900;">' + fmtHK(agg.billTotal) + '</div>' +
          '</div>' +
          '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:10px 12px;min-width:180px;">' +
            '<div style="font-size:11px;color:#166534;font-weight:800;">' + esc(tr('report.ds.dailyPaidTotal')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#15803d;font-weight:900;">' + fmtHK(agg.paidTotal) + '</div>' +
          '</div>' +
          '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;min-width:200px;">' +
            '<div style="font-size:11px;color:#991b1b;font-weight:800;">' + esc(tr('report.ds.dailyDueAmount')) + '</div>' +
            '<div style="margin-top:2px;font-size:18px;color:#dc2626;font-weight:900;">' + fmtHK(agg.dueTotal) + '</div>' +
          '</div>' +
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

  function yearOptionsHTML(selectedYear, yearsBack) {
    var nowY = new Date().getFullYear();
    var sel = Number(selectedYear) || nowY;
    var back = (yearsBack != null) ? yearsBack : 5;
    var opts = [];
    for (var y = nowY; y >= nowY - back; y--) {
      opts.push('<option value="' + y + '"' + (y === sel ? ' selected' : '') + '>' + y + '</option>');
    }
    return opts.join('');
  }

  function monthNumOptionsHTML(selectedMm) {
    var sel = String(selectedMm || '').padStart(2, '0');
    return MONTH_SHORT_KEYS.map(function (key, idx) {
      var mm = String(idx + 1).padStart(2, '0');
      var optSel = (mm === sel) ? ' selected' : '';
      return '<option value="' + mm + '"' + optSel + '>' + esc(monthShortLabel(idx)) + '</option>';
    }).join('');
  }

  function yyyyMmFromParts(year, monthMm) {
    var y = String(year || new Date().getFullYear()).slice(0, 4);
    var m = String(monthMm || '01').padStart(2, '0').slice(0, 2);
    if (!/^\d{4}$/.test(y)) y = String(new Date().getFullYear());
    if (!/^(0[1-9]|1[0-2])$/.test(m)) m = String(new Date().getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }

  function addMonthsYyyyMm(yyyyMm, delta) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm || ''));
    if (!m) return monthKeyOf(todayISO());
    var d = new Date(+m[1], +m[2] - 1 + Number(delta || 0), 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function enumerateMonthsBetween(fromYyyyMm, toYyyyMm) {
    var from = String(fromYyyyMm || '').slice(0, 7);
    var to = String(toYyyyMm || '').slice(0, 7);
    if (!from || !to) return [];
    if (from > to) {
      var tmp = from;
      from = to;
      to = tmp;
    }
    var out = [];
    var cur = from;
    var guard = 0;
    while (guard++ < MONTHLY_INCOME_MAX_MONTHS + 4) {
      out.push(cur);
      if (cur === to) break;
      cur = addMonthsYyyyMm(cur, 1);
    }
    return out;
  }

  function monthSpanCount(fromYyyyMm, toYyyyMm) {
    return enumerateMonthsBetween(fromYyyyMm, toYyyyMm).length;
  }

  function defaultMonthlyIncomeRange() {
    var toKey = monthKeyOf(todayISO());
    var fromKey = addMonthsYyyyMm(toKey, -(MONTHLY_INCOME_DEFAULT_MONTHS - 1));
    return { from: fromKey, to: toKey };
  }

  function clampMonthlyIncomeRange(fromYyyyMm, toYyyyMm, anchor) {
    var from = String(fromYyyyMm || '').slice(0, 7) || monthKeyOf(todayISO());
    var to = String(toYyyyMm || '').slice(0, 7) || from;
    var clamped = false;
    if (from > to) {
      var swap = from;
      from = to;
      to = swap;
    }
    var span = monthSpanCount(from, to);
    if (span > MONTHLY_INCOME_MAX_MONTHS) {
      clamped = true;
      if (anchor === 'from') {
        to = addMonthsYyyyMm(from, MONTHLY_INCOME_MAX_MONTHS - 1);
      } else {
        from = addMonthsYyyyMm(to, -(MONTHLY_INCOME_MAX_MONTHS - 1));
      }
    }
    return { from: from, to: to, clamped: clamped };
  }

  function applyMonthlyIncomeMonthRange(fromMonth, toMonth, opts) {
    opts = opts || {};
    var r = clampMonthlyIncomeRange(fromMonth, toMonth, _monthlyIncomeLastAnchor);
    _monthlyIncomeFromMonth = r.from;
    _monthlyIncomeToMonth = r.to;
    setDateInputs(r.from + '-01', monthEndISO(r.to));
    if (r.clamped && opts.notify) {
      alert(trRepl('report.mi.rangeClamped', {
        from: r.from,
        to: r.to,
        max: String(MONTHLY_INCOME_MAX_MONTHS)
      }));
    }
    return r;
  }

  function ensureMonthlyIncomeRangeInitialized() {
    if (_monthlyIncomeFromMonth && _monthlyIncomeToMonth) return;
    var def = defaultMonthlyIncomeRange();
    _monthlyIncomeFromMonth = def.from;
    _monthlyIncomeToMonth = def.to;
  }

  function updateMonthlyIncomeHeaderPickers() {
    ensureMonthlyIncomeRangeInitialized();
    var from = _monthlyIncomeFromMonth;
    var to = _monthlyIncomeToMonth;
    var fromParts = /^(\d{4})-(\d{2})$/.exec(from) || [];
    var toParts = /^(\d{4})-(\d{2})$/.exec(to) || [];
    var fy = g('rptMiFromYear');
    var fm = g('rptMiFromMonth');
    var ty = g('rptMiToYear');
    var tm = g('rptMiToMonth');
    if (fy) {
      fy.innerHTML = yearOptionsHTML(fromParts[1] || String(new Date().getFullYear()), 8);
      fy.value = fromParts[1] || fy.value;
    }
    if (fm) {
      fm.innerHTML = monthNumOptionsHTML(fromParts[2] || '01');
      fm.value = fromParts[2] || fm.value;
    }
    if (ty) {
      ty.innerHTML = yearOptionsHTML(toParts[1] || String(new Date().getFullYear()), 8);
      ty.value = toParts[1] || ty.value;
    }
    if (tm) {
      tm.innerHTML = monthNumOptionsHTML(toParts[2] || '01');
      tm.value = toParts[2] || tm.value;
    }
  }

  function wireMonthlyIncomeToolsOnce() {
    if (_monthlyIncomeToolsWired) return;
    [
      { yearId: 'rptMiFromYear', monthId: 'rptMiFromMonth', anchor: 'from' },
      { yearId: 'rptMiToYear', monthId: 'rptMiToMonth', anchor: 'to' }
    ].forEach(function (cfg) {
      [cfg.yearId, cfg.monthId].forEach(function (id) {
        var el = g(id);
        if (!el) return;
        el.addEventListener('change', function () {
          if (!_reportInitialized || _tab !== 'monthlyIncome') return;
          setMonthlyIncomeRangeFromHeader(cfg.anchor, true);
        });
      });
    });
    _monthlyIncomeToolsWired = true;
  }

  function setMonthlyIncomeRangeFromHeader(anchor, notify) {
    _monthlyIncomeLastAnchor = (anchor === 'from') ? 'from' : 'to';
    var fromKey = yyyyMmFromParts(
      g('rptMiFromYear') ? g('rptMiFromYear').value : '',
      g('rptMiFromMonth') ? g('rptMiFromMonth').value : ''
    );
    var toKey = yyyyMmFromParts(
      g('rptMiToYear') ? g('rptMiToYear').value : '',
      g('rptMiToMonth') ? g('rptMiToMonth').value : ''
    );
    applyMonthlyIncomeMonthRange(fromKey, toKey, { notify: !!notify });
    updateMonthlyIncomeHeaderPickers();
    if (_tab === 'monthlyIncome') refresh();
  }

  function renderMonthlyIncomeShell() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div style="padding:12px;">' +
        '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:#22c55e;" onclick="REPORT.printTable()">' + esc(tr('report.ds.btnPrint')) + '</button>' +
          '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:#0d6efd;" onclick="REPORT.printChart()">' + esc(tr('report.printChart')) + '</button>' +
          '<button class="btn-add" style="padding:7px 12px;font-size:12px;background:#64748b;" onclick="REPORT.exportCSV()">' + esc(tr('report.ds.btnExportCsv')) + '</button>' +
        '</div>' +
        '<div id="rptMonthlyIncomeBody" style="min-height:200px;"></div>' +
      '</div>';
  }

  function fillMonthlyIncomeRows(groupedMap, fromMonthKey, toMonthKey) {
    var months = enumerateMonthsBetween(fromMonthKey, toMonthKey);
    return months.map(function (mk) {
      return { month: mk, total: Number(groupedMap[mk] || 0).toFixed(2) };
    });
  }

  function renderMonthlyIncomeByClinic(slices, fromMonthKey, toMonthKey) {
    var body = g('rptMonthlyIncomeBody') || g('rptTableWrap');
    var months = enumerateMonthsBetween(fromMonthKey, toMonthKey);
    var monthSet = {};
    months.forEach(function (mk) { monthSet[mk] = true; });
    var periodKeyFn = function (s) { return String(s.paid_date || '').slice(0, 7); };
    var filtered = (slices || []).filter(function (s) {
      return monthSet[periodKeyFn(s)];
    });
    var piv = pivotSlicesByPeriodAndClinic(filtered, periodKeyFn);
    var byPeriod = {};
    piv.rows.forEach(function (r) { byPeriod[r.period] = r; });
    var columns = [{ key: 'month', label: tr('report.col.month') }];
    piv.codes.forEach(function (code) {
      columns.push({ key: 'c_' + code, label: reportClinicLabelFromCode(code) });
    });
    columns.push({ key: 'total', label: tr('report.col.paymentHkd') });
    _rows = months.map(function (mk) {
      var src = byPeriod[mk] || { byClinic: {}, total: 0 };
      var row = { month: mk };
      piv.codes.forEach(function (code) {
        row['c_' + code] = Number(src.byClinic[code] || 0).toFixed(2);
      });
      row.total = Number(src.total || 0).toFixed(2);
      return row;
    });
    if (!piv.codes.length) {
      columns = [
        { key: 'month', label: tr('report.col.month') },
        { key: 'total', label: tr('report.col.paymentHkd') }
      ];
    }
    renderTableInto(body, columns, _rows);
    renderChartFromRows('month', 'total');
  }

  function drDisplayName(d) {
    if (!d) return '';
    if (typeof doctorDisplayName === 'function') return doctorDisplayName(d);
    return d.display_name || d.english_name || d.chinese_name || d.doctor_code || '';
  }

  async function ensureDrDoctorsLoaded() {
    if (_drDailyDoctors.length) return _drDailyDoctors;
    try {
      _drDailyDoctors = await loadDoctorsForReport();
    } catch (e) {
      console.warn('loadDoctorsForReport failed:', e && e.message ? e.message : e);
      _drDailyDoctors = [];
    }
    return _drDailyDoctors;
  }

  function drOptionsHTML(selectedId) {
    var seenNames = {};
    var docs = [];
    (_drDailyDoctors || []).slice().sort(function (a, b) {
      var an = String(drDisplayName(a) || '').toLowerCase();
      var bn = String(drDisplayName(b) || '').toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    }).forEach(function (d) {
      var label = String(drDisplayName(d) || '').trim().toLowerCase();
      if (!label) label = 'id:' + String(d && d.id != null ? d.id : '');
      if (seenNames[label]) return;
      seenNames[label] = true;
      docs.push(d);
    });
    var allOpt = '<option value="' + REPORT_ALL_DOCTORS_ID + '"' +
      ((selectedId === REPORT_ALL_DOCTORS_ID) ? ' selected' : '') + '>' +
      esc(tr('report.dr.allDoctors')) + '</option>';
    if (!docs.length) {
      return allOpt;
    }
    return allOpt + docs.map(function (d) {
      var id = String(d.id != null ? d.id : '');
      var shown = drDisplayName(d) || tr('report.dr.doctorFallback');
      var sel = (String(selectedId) === id) ? ' selected' : '';
      return '<option value="' + esc(id) + '"' + sel + '>' + esc(shown) + '</option>';
    }).join('');
  }

  function isAllDoctorsChoice(doctorId) {
    return String(doctorId || '') === REPORT_ALL_DOCTORS_ID;
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

  var DR_MONTHLY_ENGLISH_MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function drMonthlyEnglishMonthName(monthIdx) {
    return DR_MONTHLY_ENGLISH_MONTHS[monthIdx] || DR_MONTHLY_ENGLISH_MONTHS[0];
  }

  function formatDrMonthlyLongDate(isoDate) {
    var d = parseDateToLocal(isoDate);
    if (!d || isNaN(d.getTime())) return String(isoDate || '');
    var day = String(d.getDate()).padStart(2, '0');
    return day + ' ' + drMonthlyEnglishMonthName(d.getMonth()) + ' ' + d.getFullYear();
  }

  function formatDrMonthlyMonthTitle(yyyyMm) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm || ''));
    if (!m) return String(yyyyMm || '');
    return drMonthlyEnglishMonthName(+m[2] - 1) + ' ' + m[1];
  }

  function enumerateMonthDays(yyyyMm) {
    var days = [];
    var cur = parseDateToLocal(String(yyyyMm || '') + '-01');
    var end = parseDateToLocal(monthEndISO(yyyyMm));
    if (!cur || !end || isNaN(cur.getTime()) || isNaN(end.getTime())) return days;
    while (cur.getTime() <= end.getTime()) {
      days.push(iso(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  /** Legacy Clinic Income Report account labels (VISA, MASTER, EPS, …). */
  function drMonthlyAccountLabel(method) {
    var s = String(method || '').trim();
    if (!s) return '';
    var lk = s.toLowerCase().replace(/\s+/g, ' ');
    if (lk === 'mastercard' || lk === 'master' || lk === 'master card') return 'MASTER';
    if (lk === 'visa' || lk === 'visa card') return 'VISA';
    if (lk === 'union pay' || lk === 'unionpay' || lk === 'union-pay') return 'UNION PAY';
    if (lk === 'cash') return 'CASH';
    if (lk === 'eps') return 'EPS';
    if (lk === 'octopus') return 'OCTOPUS';
    if (lk === 'alipay') return 'ALIPAY';
    if (lk === 'wechat pay' || lk === 'wechat') return 'WECHAT PAY';
    if (lk === 'hkbc') return 'HKBC';
    if (lk === 'cheque') return 'CHEQUE';
    if (lk === 'bank transfer') return 'BANK TRANSFER';
    return s.toUpperCase();
  }

  function drMonthlyAmountPlain(n) {
    return Number(n || 0).toFixed(2);
  }

  function drMonthlyAmountDisplay(n) {
    if (typeof fmt2 === 'function') return fmt2(n);
    return drMonthlyAmountPlain(n);
  }

  function buildDrMonthlyIncomeReportData(slices, yyyyMm, opts) {
    opts = opts || {};
    var byDay = {};
    var monthByMethod = {};
    var grandTotal = 0;

    (slices || []).forEach(function (s) {
      var d = s.paid_date;
      if (!d) return;
      var amt = Number(s.amount || 0);
      if (amt <= 0.005) return;
      var acct = drMonthlyAccountLabel(s.method);
      if (!acct) return;
      if (!byDay[d]) byDay[d] = { bills: {}, methods: {} };
      if (s.bill && s.bill.id) byDay[d].bills[s.bill.id] = true;
      byDay[d].methods[acct] = (byDay[d].methods[acct] || 0) + amt;
      monthByMethod[acct] = (monthByMethod[acct] || 0) + amt;
      grandTotal += amt;
    });

    var displayRows = [];
    var exportRows = [];
    var days;
    if (opts.singleDay) {
      days = [opts.singleDay];
    } else if (opts.from && opts.to) {
      days = enumerateDateRange(opts.from, opts.to);
    } else {
      days = enumerateMonthDays(yyyyMm);
    }

    days.forEach(function (d) {
      var dayData = byDay[d] || { bills: {}, methods: {} };
      var txCount = Object.keys(dayData.bills).length;
      var dayTotal = Object.keys(dayData.methods).reduce(function (sum, k) {
        return sum + Number(dayData.methods[k] || 0);
      }, 0);
      var dateLabel = formatDrMonthlyLongDate(d);

      displayRows.push({
        date: dateLabel,
        tx_count: String(txCount),
        account: '',
        amount: '',
        total: drMonthlyAmountPlain(dayTotal),
        _type: 'day'
      });
      exportRows.push({
        date: dateLabel,
        tx_count: String(txCount),
        account: '',
        amount: '',
        total: drMonthlyAmountPlain(dayTotal),
        _type: 'day'
      });

      if (!txCount) return;

      Object.keys(dayData.methods).sort(function (a, b) {
        return dayData.methods[b] - dayData.methods[a];
      }).forEach(function (acct) {
        var amt = dayData.methods[acct];
        displayRows.push({
          date: '',
          tx_count: '',
          account: acct,
          amount: drMonthlyAmountPlain(amt),
          total: '',
          _type: 'method'
        });
        exportRows.push({
          date: '',
          tx_count: '',
          account: acct,
          amount: drMonthlyAmountPlain(amt),
          total: '',
          _type: 'method'
        });
      });
    });

    var grandLabel = tr('report.drMonthly.grandTotal');
    displayRows.push({
      date: '',
      tx_count: '',
      account: grandLabel,
      amount: '',
      total: drMonthlyAmountPlain(grandTotal),
      _type: 'grand'
    });
    exportRows.push({
      date: '',
      tx_count: '',
      account: grandLabel,
      amount: '',
      total: drMonthlyAmountPlain(grandTotal),
      _type: 'grand'
    });

    Object.keys(monthByMethod).sort(function (a, b) {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }).forEach(function (acct) {
      displayRows.push({
        date: '',
        tx_count: '',
        account: acct,
        amount: drMonthlyAmountPlain(monthByMethod[acct]),
        total: '',
        _type: 'monthMethod'
      });
      exportRows.push({
        date: '',
        tx_count: '',
        account: acct,
        amount: drMonthlyAmountPlain(monthByMethod[acct]),
        total: '',
        _type: 'monthMethod'
      });
    });

    return {
      displayRows: displayRows,
      exportRows: exportRows,
      grandTotal: grandTotal,
      monthByMethod: monthByMethod
    };
  }

  function groupDrMonthlySlicesByDoctor(slices, doctors) {
    var map = {};
    (slices || []).forEach(function (s) {
      var df = resolveBillDoctorFields(s.bill, doctors);
      var key = df.doctor_key || df.doctor_display || '__unknown__';
      if (!map[key]) {
        map[key] = { doctorLabel: df.doctor_display, slices: [] };
      }
      map[key].slices.push(s);
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      return String(a.doctorLabel || '').localeCompare(String(b.doctorLabel || ''));
    });
  }

  function drMonthlyColumnHeaderRow() {
    return {
      date: tr('report.drMonthly.col.date'),
      tx_count: tr('report.drMonthly.col.txCount'),
      account: tr('report.drMonthly.col.account'),
      amount: tr('report.drMonthly.col.amount'),
      total: tr('report.drMonthly.col.total'),
      _type: 'columnHeader'
    };
  }

  function buildDrMonthlyIncomeReportDataForAllDoctors(slices, yyyyMm, doctors) {
    var sections = groupDrMonthlySlicesByDoctor(slices, doctors).map(function (g) {
      return {
        doctorLabel: g.doctorLabel,
        incomeData: buildDrMonthlyIncomeReportData(g.slices, yyyyMm)
      };
    });
    var displayRows = [];
    var exportRows = [];
    sections.forEach(function (sec, idx) {
      if (idx > 0) {
        var gap = { date: '', tx_count: '', account: '', amount: '', total: '', _type: 'spacer' };
        displayRows.push(gap);
        exportRows.push(Object.assign({}, gap));
      }
      var colHeader = drMonthlyColumnHeaderRow();
      var header = {
        date: sec.doctorLabel,
        tx_count: '',
        account: '',
        amount: '',
        total: '',
        _type: 'doctorSection'
      };
      displayRows.push(header);
      exportRows.push(Object.assign({}, header));
      displayRows.push(colHeader);
      exportRows.push(Object.assign({}, colHeader));
      displayRows = displayRows.concat(sec.incomeData.displayRows);
      exportRows = exportRows.concat(sec.incomeData.exportRows.map(function (r) {
        return Object.assign({}, r);
      }));
    });
    return {
      sections: sections,
      displayRows: displayRows,
      exportRows: exportRows,
      grandTotal: sections.reduce(function (sum, sec) {
        return sum + Number(sec.incomeData.grandTotal || 0);
      }, 0)
    };
  }

  function renderDrMonthlyIncomeReport(body, incomeData, clinicLabel, doctorLabel, month, allDoctors) {
    if (!body) return;
    var th = 'padding:10px 10px;background:#f0f7ff;color:#0d6efd;font-size:12px;font-weight:900;border-bottom:2px solid #dde8f5;text-align:left;';
    var td = 'padding:9px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top;';
    var rowsHtml = (incomeData.displayRows || []).map(function (r) {
      if (r._type === 'columnHeader') {
        return '<tr>' +
          '<th style="' + th + '">' + esc(r.date) + '</th>' +
          '<th style="' + th + 'text-align:right;width:130px;">' + esc(r.tx_count) + '</th>' +
          '<th style="' + th + 'width:180px;">' + esc(r.account) + '</th>' +
          '<th style="' + th + 'text-align:right;width:140px;">' + esc(r.amount) + '</th>' +
          '<th style="' + th + 'text-align:right;width:140px;">' + esc(r.total) + '</th>' +
        '</tr>';
      }
      if (r._type === 'doctorSection') {
        return '<tr><td colspan="5" style="padding:10px 10px 6px;font-weight:900;color:#1e40af;font-size:14px;">' +
          esc(r.date || '') + '</td></tr>';
      }
      if (r._type === 'spacer') {
        return '<tr><td colspan="5" style="height:10px;border:none;"></td></tr>';
      }
      var isMethod = r._type === 'method' || r._type === 'monthMethod';
      var isGrand = r._type === 'grand';
      var acctStyle = isMethod ? (td + 'padding-left:28px;color:#475569;font-weight:800;') : (td + (isGrand ? 'font-weight:900;color:#0f172a;' : ''));
      var totalStyle = td + 'text-align:right;' + ((r._type === 'day' || isGrand) ? 'font-weight:900;color:#15803d;' : '');
      var amountCell = r.amount ? drMonthlyAmountDisplay(r.amount) : '';
      var totalCell = r.total ? drMonthlyAmountDisplay(r.total) : '';
      return '<tr>' +
        '<td style="' + td + (r.date ? 'font-weight:900;color:#0f172a;' : '') + '">' + esc(r.date) + '</td>' +
        '<td style="' + td + 'text-align:right;">' + esc(r.tx_count) + '</td>' +
        '<td style="' + acctStyle + '">' + esc(r.account) + '</td>' +
        '<td style="' + td + 'text-align:right;' + (isMethod ? 'font-weight:800;color:#334155;' : '') + '">' + esc(amountCell) + '</td>' +
        '<td style="' + totalStyle + '">' + esc(totalCell) + '</td>' +
      '</tr>';
    }).join('');

    var metaLines =
      '<div style="margin-bottom:12px;line-height:1.6;">' +
        '<div style="font-size:16px;font-weight:900;color:#0f172a;">' + esc(tr('report.drMonthly.reportTitle')) + '</div>' +
        '<div style="font-size:13px;color:#475569;">' + esc(tr('report.drMonthly.labelClinic')) + ': <strong>' + esc(clinicLabel || '—') + '</strong></div>' +
        '<div style="font-size:13px;color:#475569;">' + esc(tr('report.ds.labelMonth')) + ': <strong>' + esc(formatDrMonthlyMonthTitle(month)) + '</strong></div>' +
        (allDoctors
          ? ('<div style="font-size:13px;color:#475569;">' + esc(tr('report.dr.labelDoctor')) + ': <strong>' + esc(tr('report.dr.allDoctors')) + '</strong></div>')
          : (doctorLabel
            ? ('<div style="font-size:13px;color:#475569;">' + esc(tr('report.dr.labelDoctor')) + ': <strong>' + esc(doctorLabel) + '</strong></div>')
            : '')) +
      '</div>';

    var tableHead = allDoctors ? '' : (
      '<thead><tr>' +
        '<th style="' + th + '">' + esc(tr('report.drMonthly.col.date')) + '</th>' +
        '<th style="' + th + 'text-align:right;width:130px;">' + esc(tr('report.drMonthly.col.txCount')) + '</th>' +
        '<th style="' + th + 'width:180px;">' + esc(tr('report.drMonthly.col.account')) + '</th>' +
        '<th style="' + th + 'text-align:right;width:140px;">' + esc(tr('report.drMonthly.col.amount')) + '</th>' +
        '<th style="' + th + 'text-align:right;width:140px;">' + esc(tr('report.drMonthly.col.total')) + '</th>' +
      '</tr></thead>'
    );

    body.innerHTML = metaLines +
      '<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:auto;max-height:560px;background:#fff;">' +
        '<table style="width:100%;border-collapse:collapse;min-width:720px;">' +
          tableHead +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>';
  }

  function exportClinicIncomeReportExcel(exportBundle, fnameBase, options) {
    options = options || {};
    if (!exportBundle || !exportBundle.rows || !exportBundle.rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var meta = exportBundle.meta || {};
    var columns = [
      { key: 'date', label: tr('report.drMonthly.col.date') },
      { key: 'tx_count', label: tr('report.drMonthly.col.txCount') },
      { key: 'account', label: tr('report.drMonthly.col.account') },
      { key: 'amount', label: tr('report.drMonthly.col.amount') },
      { key: 'total', label: tr('report.drMonthly.col.total') }
    ];
    var preface = [
      tr('report.drMonthly.reportTitle'),
      trRepl('report.drMonthly.exportClinic', { C: meta.clinic || '' }),
      trRepl('report.drMonthly.exportMonth', { M: meta.month || '' })
    ];
    if (options.includeDoctor && meta.doctor) {
      preface.push(trRepl('report.drMonthly.exportDoctor', { D: meta.doctor }));
    }
    if (options.includeDoctor && meta.allDoctors) {
      preface.push(trRepl('report.drMonthly.exportDoctor', { D: tr('report.dr.allDoctors') }));
    }
    var fname = meta.fileBase || (fnameBase + (meta.monthKey || meta.dateKey || monthKeyOf(todayISO())));
    if (meta.doctorSlug) fname += '_' + meta.doctorSlug;
    var grandLabel = tr('report.drMonthly.grandTotal');
    downloadReportExcel(fname, columns, exportBundle.rows, {
      prefaceRows: preface,
      colWidths: [240, 140, 200, 140, 140],
      numericKeys: ['tx_count', 'amount', 'total'],
      skipGlobalHeader: !!meta.allDoctors,
      rowMeta: function (r) {
        if (r._type === 'columnHeader') return { columnHeader: true };
        if (r._type === 'doctorSection') return { sectionHeader: true };
        if (r._type === 'method' || r._type === 'monthMethod') return { indentCol: 2 };
        if (!r.date && r.account && r.account !== grandLabel && r._type !== 'grand') {
          return { indentCol: 2 };
        }
        return {};
      }
    });
  }

  function reportActiveClinicLabel() {
    return isReportAllClinicsSelected()
      ? tr('report.audit.allClinics')
      : reportClinicLabelFromCode(reportClinicTag());
  }

  function enumerateDateRange(fromIso, toIso) {
    var days = [];
    var cur = parseDateToLocal(fromIso);
    var end = parseDateToLocal(toIso);
    if (!cur || !end || isNaN(cur.getTime()) || isNaN(end.getTime())) return days;
    while (cur.getTime() <= end.getTime()) {
      days.push(iso(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  function clinicIncomeDetailDayKey(t) {
    return paymentDateKey(t && (t.payment_date || t.bill_date));
  }

  function formatClinicIncomeDetailPatient(t) {
    var no = String(t.patient_no || '').trim();
    var cn = String(t.patient_chinese || '').trim();
    var en = String(t.patient_name || '').trim();
    var name = cn + (cn && en ? ' / ' : '') + en;
    var line = (no ? (no + ' ') : '') + name;
    if (t.doctor_display) {
      line += ' (' + String(t.doctor_display) + ')';
    }
    return line.trim();
  }

  function sumUniqueBillAmounts(transactions) {
    var bill = 0;
    var balance = 0;
    var seen = {};
    (transactions || []).forEach(function (t) {
      var bid = t.bill_id ? String(t.bill_id) : '';
      if (bid) {
        if (seen[bid]) return;
        seen[bid] = true;
      }
      bill += Number(t.bill_total || 0);
      balance += Number(t.bill_balance || 0);
    });
    return { bill: bill, balance: balance };
  }

  function clinicIncomeDetailColumns() {
    return [
      { key: 'date', label: tr('report.drMonthly.col.date') },
      { key: 'tx_count', label: tr('report.drMonthly.col.txCount') },
      { key: 'patient', label: tr('report.ds.detail.thPatient') },
      { key: 'payment_method', label: tr('report.csv.paymentMethod') },
      { key: 'bill', label: tr('report.ds.detail.thBill') },
      { key: 'paid', label: tr('report.ds.detail.thPaid') },
      { key: 'balance', label: tr('report.ds.detail.thRemaining') },
      { key: 'total', label: tr('report.drMonthly.col.total') }
    ];
  }

  function buildClinicIncomeDetailReportData(transactions, opts) {
    opts = opts || {};
    var byDay = {};
    (transactions || []).forEach(function (t) {
      var d = clinicIncomeDetailDayKey(t);
      if (!d) return;
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(t);
    });

    var days;
    if (opts.yyyyMm) {
      days = enumerateMonthDays(opts.yyyyMm);
    } else if (opts.from && opts.to) {
      days = enumerateDateRange(opts.from, opts.to);
    } else {
      days = Object.keys(byDay).sort();
    }

    var monthByMethod = {};
    var grandPaid = 0;
    var displayRows = [];
    var exportRows = [];

    function pushRow(row) {
      displayRows.push(row);
      exportRows.push(Object.assign({}, row));
    }

    days.forEach(function (d) {
      var dayTx = (byDay[d] || []).slice().sort(dailySummaryTxSortCompare);
      var txCount = dayTx.length;
      var dayPaid = dayTx.reduce(function (sum, t) { return sum + Number(t.bill_paid || 0); }, 0);
      var dayAmounts = sumUniqueBillAmounts(dayTx);
      var dateLabel = formatDrMonthlyLongDate(d);

      dayTx.forEach(function (t) {
        var acct = drMonthlyAccountLabel(t.payment_method);
        if (acct) monthByMethod[acct] = (monthByMethod[acct] || 0) + Number(t.bill_paid || 0);
      });
      grandPaid += dayPaid;

      pushRow({
        date: dateLabel,
        tx_count: String(txCount),
        patient: '',
        payment_method: '',
        bill: txCount ? drMonthlyAmountPlain(dayAmounts.bill) : '',
        paid: txCount ? drMonthlyAmountPlain(dayPaid) : '',
        balance: txCount ? drMonthlyAmountPlain(dayAmounts.balance) : '',
        total: drMonthlyAmountPlain(dayPaid),
        _type: 'day'
      });

      if (!txCount) return;

      dayTx.forEach(function (t) {
        pushRow({
          date: '',
          tx_count: '',
          patient: formatClinicIncomeDetailPatient(t),
          payment_method: drMonthlyAccountLabel(t.payment_method),
          bill: drMonthlyAmountPlain(t.bill_total),
          paid: drMonthlyAmountPlain(t.bill_paid),
          balance: drMonthlyAmountPlain(t.bill_balance),
          total: '',
          _type: 'detail'
        });
      });
    });

    var grandAmounts = sumUniqueBillAmounts(transactions);
    var grandLabel = tr('report.drMonthly.grandTotal');
    pushRow({
      date: '',
      tx_count: '',
      patient: grandLabel,
      payment_method: '',
      bill: drMonthlyAmountPlain(grandAmounts.bill),
      paid: drMonthlyAmountPlain(grandPaid),
      balance: drMonthlyAmountPlain(grandAmounts.balance),
      total: drMonthlyAmountPlain(grandPaid),
      _type: 'grand'
    });

    Object.keys(monthByMethod).sort(function (a, b) {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }).forEach(function (acct) {
      pushRow({
        date: '',
        tx_count: '',
        patient: '',
        payment_method: acct,
        bill: '',
        paid: drMonthlyAmountPlain(monthByMethod[acct]),
        balance: '',
        total: '',
        _type: 'monthMethod'
      });
    });

    return {
      displayRows: displayRows,
      exportRows: exportRows,
      grandTotal: grandPaid,
      monthByMethod: monthByMethod
    };
  }

  function renderClinicIncomeDetailReport(body, reportData, meta) {
    if (!body) return;
    var th = 'padding:10px 10px;background:#f0f7ff;color:#0d6efd;font-size:12px;font-weight:900;border-bottom:2px solid #dde8f5;text-align:left;';
    var td = 'padding:9px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top;';
    var rowsHtml = (reportData.displayRows || []).map(function (r) {
      var isDetail = r._type === 'detail';
      var isMethod = r._type === 'monthMethod';
      var isGrand = r._type === 'grand';
      var isDay = r._type === 'day';
      var patientStyle = td + (isDetail ? 'padding-left:28px;color:#334155;' : (isGrand ? 'font-weight:900;color:#0f172a;' : ''));
      var methodStyle = td + (isMethod ? 'padding-left:28px;color:#475569;font-weight:800;' : '');
      var billStyle = td + 'text-align:right;' + ((isDay || isGrand || isDetail) ? 'font-weight:800;color:#0f172a;' : '');
      var paidStyle = td + 'text-align:right;' + ((isDay || isGrand || isDetail || isMethod) ? 'font-weight:800;color:#0369a1;' : '');
      var balStyle = td + 'text-align:right;font-weight:800;color:' + (Number(r.balance || 0) > 0 ? '#dc2626' : '#16a34a') + ';';
      var totalStyle = td + 'text-align:right;' + ((isDay || isGrand) ? 'font-weight:900;color:#15803d;' : '');
      return '<tr>' +
        '<td style="' + td + (r.date ? 'font-weight:900;color:#0f172a;' : '') + '">' + esc(r.date) + '</td>' +
        '<td style="' + td + 'text-align:right;">' + esc(r.tx_count) + '</td>' +
        '<td style="' + patientStyle + '">' + esc(r.patient) + '</td>' +
        '<td style="' + methodStyle + '">' + esc(r.payment_method) + '</td>' +
        '<td style="' + billStyle + '">' + esc(r.bill ? drMonthlyAmountDisplay(r.bill) : '') + '</td>' +
        '<td style="' + paidStyle + '">' + esc(r.paid ? drMonthlyAmountDisplay(r.paid) : '') + '</td>' +
        '<td style="' + balStyle + '">' + esc(r.balance ? drMonthlyAmountDisplay(r.balance) : '') + '</td>' +
        '<td style="' + totalStyle + '">' + esc(r.total ? drMonthlyAmountDisplay(r.total) : '') + '</td>' +
      '</tr>';
    }).join('');

    var periodLabel = meta.periodLabel || meta.month || '';
    var metaLines =
      '<div style="margin-bottom:12px;line-height:1.6;">' +
        '<div style="font-size:16px;font-weight:900;color:#0f172a;">' + esc(tr('report.drMonthly.reportTitle')) + '</div>' +
        '<div style="font-size:13px;color:#475569;">' + esc(tr('report.drMonthly.labelClinic')) + ': <strong>' + esc(meta.clinic || '—') + '</strong></div>' +
        (periodLabel
          ? ('<div style="font-size:13px;color:#475569;">' + esc(meta.periodTitle || tr('report.ds.labelMonth')) + ': <strong>' + esc(periodLabel) + '</strong></div>')
          : '') +
        (meta.allDoctors
          ? ('<div style="font-size:13px;color:#475569;">' + esc(tr('report.dr.labelDoctor')) + ': <strong>' + esc(tr('report.dr.allDoctors')) + '</strong></div>')
          : (meta.doctor
            ? ('<div style="font-size:13px;color:#475569;">' + esc(tr('report.dr.labelDoctor')) + ': <strong>' + esc(meta.doctor) + '</strong></div>')
            : '')) +
      '</div>';

    body.innerHTML = metaLines +
      '<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:auto;max-height:560px;background:#fff;">' +
        '<table style="width:100%;border-collapse:collapse;min-width:980px;">' +
          '<thead><tr>' +
            '<th style="' + th + '">' + esc(tr('report.drMonthly.col.date')) + '</th>' +
            '<th style="' + th + 'text-align:right;width:90px;">' + esc(tr('report.drMonthly.col.txCount')) + '</th>' +
            '<th style="' + th + 'min-width:220px;">' + esc(tr('report.ds.detail.thPatient')) + '</th>' +
            '<th style="' + th + 'width:140px;">' + esc(tr('report.csv.paymentMethod')) + '</th>' +
            '<th style="' + th + 'text-align:right;width:110px;">' + esc(tr('report.ds.detail.thBill')) + '</th>' +
            '<th style="' + th + 'text-align:right;width:110px;">' + esc(tr('report.ds.detail.thPaid')) + '</th>' +
            '<th style="' + th + 'text-align:right;width:110px;color:#dc2626;">' + esc(tr('report.ds.detail.thRemaining')) + '</th>' +
            '<th style="' + th + 'text-align:right;width:110px;">' + esc(tr('report.drMonthly.col.total')) + '</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>';
  }

  function presentClinicIncomeDetailReport(body, transactions, meta, buildOpts) {
    var reportData = buildClinicIncomeDetailReportData(transactions, buildOpts || {});
    _clinicIncomeDetailExport = {
      meta: meta || {},
      rows: reportData.exportRows
    };
    _rows = reportData.exportRows;
    renderClinicIncomeDetailReport(body, reportData, meta || {});
  }

  function exportClinicIncomeDetailExcel(exportBundle, fnameBase, options) {
    options = options || {};
    if (!exportBundle || !exportBundle.rows || !exportBundle.rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var meta = exportBundle.meta || {};
    var columns = clinicIncomeDetailColumns();
    var preface = [
      tr('report.drMonthly.reportTitle'),
      trRepl('report.drMonthly.exportClinic', { C: meta.clinic || '' })
    ];
    if (meta.month) {
      preface.push(trRepl('report.drMonthly.exportMonth', { M: meta.month }));
    } else if (meta.periodLabel) {
      preface.push(trRepl('report.drMonthly.exportMonth', { M: meta.periodLabel }));
    }
    if (options.includeDoctor && meta.doctor) {
      preface.push(trRepl('report.drMonthly.exportDoctor', { D: meta.doctor }));
    }
    if (options.includeDoctor && meta.allDoctors) {
      preface.push(trRepl('report.drMonthly.exportDoctor', { D: tr('report.dr.allDoctors') }));
    }
    var fname = fnameBase + (meta.monthKey || meta.dateKey || monthKeyOf(todayISO()));
    if (meta.doctorSlug) fname += '_' + meta.doctorSlug;
    var grandLabel = tr('report.drMonthly.grandTotal');
    downloadReportExcel(fname, columns, exportBundle.rows, {
      prefaceRows: preface,
      colWidths: [240, 90, 240, 150, 110, 110, 110, 110],
      numericKeys: ['tx_count', 'bill', 'paid', 'balance', 'total'],
      rowMeta: function (r) {
        if (r._type === 'detail') return { indentCol: 2 };
        if (r._type === 'monthMethod') return { indentCol: 3 };
        if (!r.date && r.patient && r.patient !== grandLabel && r._type !== 'grand') {
          return { indentCol: 2 };
        }
        return {};
      }
    });
  }

  function exportDrMonthlyIncomeCsv() {
    exportClinicIncomeReportExcel(_drMonthlyIncomeExport, 'dr_monthly_income_', { includeDoctor: true });
  }

  function exportDailySummaryClinicIncomeExcel() {
    exportClinicIncomeReportExcel(_dailySummaryIncomeExport, 'daily_summary_', { includeDoctor: false });
  }

  function dailySummarySimpleExportColumns(includeDate, omitDoctor) {
    var cols = [
      { key: 'patient_no', label: tr('report.csv.patientNo') },
      { key: 'patient_chinese', label: tr('report.csv.patientChinese') },
      { key: 'patient_name', label: tr('report.csv.patientEnglish') }
    ];
    if (!omitDoctor) {
      cols.push({ key: 'doctor_display', label: tr('report.csv.doctor') });
    }
    cols.push(
      { key: 'payment_method', label: tr('report.csv.paymentMethod') },
      { key: 'bill_paid', label: tr('report.csv.paid') },
      { key: 'remarks', label: tr('report.csv.remarks') }
    );
    if (includeDate) {
      return [{ key: 'payment_date', label: tr('report.col.date') }].concat(cols);
    }
    return cols;
  }

  function buildDailySummarySimpleDailyExportRow(t, method, amt, includeDate, omitDoctor) {
    var row = {
      patient_no: t.patient_no || '',
      patient_chinese: t.patient_chinese || '',
      patient_name: t.patient_name || '',
      payment_method: drMonthlyAccountLabel(method),
      bill_paid: drMonthlyAmountPlain(amt),
      remarks: t.remarks || '',
      _type: 'tx'
    };
    if (!omitDoctor) row.doctor_display = t.doctor_display || '';
    if (includeDate) {
      row.payment_date = t.payment_date || t.bill_date || '';
    }
    return row;
  }

  function dailySummarySimpleColumnHeaderRow(includeDate, omitDoctor) {
    var row = {
      patient_no: tr('report.csv.patientNo'),
      patient_chinese: tr('report.csv.patientChinese'),
      patient_name: tr('report.csv.patientEnglish'),
      payment_method: tr('report.csv.paymentMethod'),
      bill_paid: tr('report.csv.paid'),
      remarks: tr('report.csv.remarks'),
      _type: 'columnHeader'
    };
    if (!omitDoctor) row.doctor_display = tr('report.csv.doctor');
    if (includeDate) row.payment_date = tr('report.col.date');
    return row;
  }

  function dailySummarySimpleDoctorSectionRow(label, includeDate) {
    var row = {
      patient_no: String(label || ''),
      patient_chinese: '',
      patient_name: '',
      doctor_display: '',
      payment_method: '',
      bill_paid: '',
      remarks: '',
      _type: 'doctorSection'
    };
    if (includeDate) row.payment_date = '';
    return row;
  }

  function appendDailySummarySimpleTxExportRows(transactions, exportRows, includeDate, byMethod, onAmount, omitDoctor) {
    (transactions || []).slice().sort(dailySummaryTxSortCompare).forEach(function (t) {
      var allocs = t.payment_allocations;
      var pushed = false;
      if (allocs && allocs.length) {
        allocs.forEach(function (a) {
          var amt = Number(a.amount || 0);
          if (amt <= 0.005) return;
          var method = drMonthlyAccountLabel(a.method);
          if (!method) return;
          if (onAmount) onAmount(amt, method);
          exportRows.push(buildDailySummarySimpleDailyExportRow(t, a.method, amt, includeDate, omitDoctor));
          pushed = true;
        });
      }
      if (!pushed) {
        var amt = Number(t.bill_paid != null ? t.bill_paid : t.amount || 0);
        if (amt <= 0.005) return;
        var method = drMonthlyAccountLabel(t.payment_method);
        if (!method || reportPayMethodIsUnsettled(reportPayMethodCanonicalKey(t.payment_method))) return;
        if (onAmount) onAmount(amt, method);
        exportRows.push(buildDailySummarySimpleDailyExportRow(t, t.payment_method, amt, includeDate, omitDoctor));
      }
    });
  }

  function buildDailySummarySimpleDailyExportRows(transactions, includeDate) {
    var exportRows = [];
    var byMethod = {};
    var grandTotal = 0;
    var blankBase = {
      patient_no: '',
      patient_chinese: '',
      patient_name: '',
      doctor_display: '',
      payment_method: '',
      bill_paid: '',
      remarks: ''
    };
    if (includeDate) blankBase.payment_date = '';

    function trackAmount(amt, method) {
      grandTotal += amt;
      byMethod[method] = (byMethod[method] || 0) + amt;
    }

    var groupByDoctor = dailySummaryGroupByDoctorEnabled();
    if (groupByDoctor) {
      var groups = dailySummaryGroupTxByDoctor(transactions);
      groups.forEach(function (g, idx) {
        if (idx > 0) {
          exportRows.push(Object.assign({}, blankBase, { _type: 'spacer' }));
        }
        exportRows.push(dailySummarySimpleDoctorSectionRow(g.label, includeDate));
        exportRows.push(dailySummarySimpleColumnHeaderRow(includeDate, true));
        appendDailySummarySimpleTxExportRows(g.rows, exportRows, includeDate, byMethod, trackAmount, true);
      });
    } else {
      appendDailySummarySimpleTxExportRows(transactions, exportRows, includeDate, byMethod, trackAmount, false);
    }

    var totalRow = Object.assign({}, blankBase, {
      payment_method: tr('report.drDaily.totalLabel'),
      bill_paid: drMonthlyAmountPlain(grandTotal),
      _type: 'total'
    });
    exportRows.push(totalRow);

    Object.keys(byMethod).sort(function (a, b) {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }).forEach(function (method) {
      exportRows.push(Object.assign({}, blankBase, {
        payment_method: method,
        bill_paid: drMonthlyAmountPlain(byMethod[method]),
        _type: 'methodTotal'
      }));
    });

    return {
      exportRows: exportRows,
      grandTotal: grandTotal,
      byMethod: byMethod,
      groupByDoctor: groupByDoctor
    };
  }

  function setDailySummaryDailySimpleExportBundle(transactions, from, to) {
    var range = normalizeReportDateRange(from, to);
    var includeDate = range.from !== range.to;
    var built = buildDailySummarySimpleDailyExportRows(transactions, includeDate);
    var periodLabel = range.from === range.to
      ? formatDrMonthlyLongDate(range.from)
      : (formatDrMonthlyLongDate(range.from) + ' – ' + formatDrMonthlyLongDate(range.to));
    var fileSuffix = dailySummaryExportSuffix(range.from, range.to);
    _dailySummaryIncomeExport = {
      meta: {
        month: periodLabel,
        clinic: reportActiveClinicLabel(),
        fileBase: 'daily_summary_' + fileSuffix,
        includeDate: includeDate,
        exportKind: 'dailySimple',
        groupByDoctor: !!built.groupByDoctor
      },
      rows: built.exportRows
    };
    return built;
  }

  function exportDailySummarySimpleDailyExcel(exportBundle) {
    if (!exportBundle || !exportBundle.rows || !exportBundle.rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var meta = exportBundle.meta || {};
    var omitDoctor = !!meta.groupByDoctor;
    var columns = dailySummarySimpleExportColumns(!!meta.includeDate, omitDoctor);
    var payMethodColIdx = -1;
    columns.forEach(function (c, i) {
      if (c.key === 'payment_method') payMethodColIdx = i;
    });
    var preface = [
      tr('report.drMonthly.reportTitle'),
      trRepl('report.drMonthly.exportClinic', { C: meta.clinic || '' }),
      trRepl('report.drDaily.exportDate', { D: meta.month || '' })
    ];
    var fname = meta.fileBase || ('daily_summary_' + todayISO());
    downloadReportExcel(fname, columns, exportBundle.rows, {
      prefaceRows: preface,
      colWidths: meta.includeDate
        ? (omitDoctor ? [100, 90, 120, 140, 120, 100, 180] : [100, 90, 120, 140, 120, 120, 100, 180])
        : (omitDoctor ? [90, 120, 140, 120, 100, 180] : [90, 120, 140, 120, 120, 100, 180]),
      numericKeys: ['bill_paid'],
      skipGlobalHeader: omitDoctor,
      headerBottomBorder: 'medium',
      rowMeta: function (r) {
        if (r._type === 'columnHeader') return { columnHeader: true };
        if (r._type === 'doctorSection') return { sectionHeader: true };
        if (r._type === 'total') return { bold: true };
        if (r._type === 'methodTotal') return { indentCol: payMethodColIdx };
        return {};
      }
    });
  }

  async function setDailySummaryClinicIncomeExportBundle(from, to) {
    var range = normalizeReportDateRange(from, to);
    var slices = await loadReportPaymentSlices(range.from, range.to);
    var buildOpts;
    var periodLabel;
    if (range.from === range.to) {
      buildOpts = { singleDay: range.from };
      periodLabel = formatDrMonthlyLongDate(range.from);
    } else {
      buildOpts = { from: range.from, to: range.to };
      periodLabel = _dailySummaryView === 'monthly'
        ? formatDrMonthlyMonthTitle(monthKeyOf(range.from))
        : (formatDrMonthlyLongDate(range.from) + ' – ' + formatDrMonthlyLongDate(range.to));
    }
    var incomeData = buildDrMonthlyIncomeReportData(
      slices || [],
      monthKeyOf(range.from),
      buildOpts
    );
    var fileSuffix = dailySummaryExportSuffix(range.from, range.to);
    _dailySummaryIncomeExport = {
      meta: {
        monthKey: monthKeyOf(range.from),
        month: periodLabel,
        clinic: reportActiveClinicLabel(),
        fileBase: 'daily_summary_' + fileSuffix
      },
      rows: incomeData.exportRows
    };
    return incomeData;
  }

  function formatDrDailyReportDate(isoDate) {
    var d = parseDateToLocal(isoDate);
    if (!d || isNaN(d.getTime())) return String(isoDate || '');
    var day = String(d.getDate()).padStart(2, '0');
    return day + ' ' + drMonthlyEnglishMonthName(d.getMonth()) + ', ' + d.getFullYear();
  }

  function formatDrDailyPatientExportLine(b, p) {
    var parts = [];
    var no = String((b && b.patient_no) || (p && p.patient_no) || '').trim();
    var cn = String((p && p.chinese_name) || '').trim();
    var en = String((p && p.full_name) || (b && b.patient_name) || '').trim();
    if (no) parts.push(no);
    if (cn) parts.push(cn);
    if (en) parts.push(en);
    return parts.join(', ');
  }

  function drDailyDoctorIncomeColumns() {
    return [
      { key: 'transaction_code', label: tr('report.drDaily.col.transactionCode') },
      { key: 'patient', label: tr('report.ds.detail.thPatient') },
      { key: 'account', label: tr('report.drMonthly.col.account') },
      { key: 'received', label: tr('report.drDaily.col.received') },
      { key: 'remarks', label: tr('report.csv.remarks') }
    ];
  }

  function buildDrDailyDoctorIncomeRowsFromSlices(slices, pmap, day) {
    var byMethod = {};
    var grandTotal = 0;
    var exportRows = [];
    var billCodeById = {};
    var billSeq = 0;
    var dayKey = String(day || '').replace(/-/g, '');

    function codeForBill(b) {
      var bid = b && b.id;
      if (!bid) return '';
      if (!billCodeById[bid]) {
        billSeq += 1;
        billCodeById[bid] = dayKey + String(billSeq).padStart(4, '0');
      }
      return billCodeById[bid];
    }

    var sorted = (slices || []).slice().sort(function (a, b) {
      var pa = formatDrDailyPatientExportLine(a.bill, pmap[a.bill && a.bill.patient_id]);
      var pb = formatDrDailyPatientExportLine(b.bill, pmap[b.bill && b.bill.patient_id]);
      return pa.localeCompare(pb);
    });

    sorted.forEach(function (s) {
      var b = s.bill || {};
      var p = pmap[b.patient_id] || {};
      var acct = drMonthlyAccountLabel(s.method);
      var amt = Number(s.amount || 0);
      if (amt <= 0.005) return;
      grandTotal += amt;
      if (acct) byMethod[acct] = (byMethod[acct] || 0) + amt;
      exportRows.push({
        transaction_code: codeForBill(b),
        patient: formatDrDailyPatientExportLine(b, p),
        account: acct,
        received: drMonthlyAmountPlain(amt),
        remarks: String(b.notes || ''),
        _type: 'tx'
      });
    });

    exportRows.push({
      transaction_code: '',
      patient: '',
      account: tr('report.drDaily.totalLabel'),
      received: drMonthlyAmountPlain(grandTotal),
      remarks: '',
      _type: 'total'
    });

    Object.keys(byMethod).sort(function (a, b) {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    }).forEach(function (acct) {
      exportRows.push({
        transaction_code: '',
        patient: '',
        account: acct,
        received: drMonthlyAmountPlain(byMethod[acct]),
        remarks: '',
        _type: 'methodTotal'
      });
    });

    return {
      displayRows: exportRows,
      exportRows: exportRows,
      grandTotal: grandTotal,
      byMethod: byMethod
    };
  }

  function buildDrDailyDoctorIncomeReportData(slices, pmap, day) {
    return buildDrDailyDoctorIncomeRowsFromSlices(slices, pmap, day);
  }

  function buildDrDailyDoctorIncomeReportDataAllDoctors(slices, doctors, pmap, day) {
    var groups = groupDrMonthlySlicesByDoctor(slices, doctors);
    var displayRows = [];
    var exportRows = [];
    groups.forEach(function (g, idx) {
      if (idx > 0) {
        var gap = {
          transaction_code: '', patient: '', account: '', received: '', remarks: '',
          _type: 'spacer'
        };
        displayRows.push(gap);
        exportRows.push(Object.assign({}, gap));
      }
      displayRows.push({
        transaction_code: g.doctorLabel,
        patient: '', account: '', received: '', remarks: '',
        _type: 'doctorSection'
      });
      exportRows.push({
        transaction_code: g.doctorLabel,
        patient: '', account: '', received: '', remarks: '',
        _type: 'doctorSection'
      });
      var colHeader = {
        transaction_code: tr('report.drDaily.col.transactionCode'),
        patient: tr('report.ds.detail.thPatient'),
        account: tr('report.drMonthly.col.account'),
        received: tr('report.drDaily.col.received'),
        remarks: tr('report.csv.remarks'),
        _type: 'columnHeader'
      };
      displayRows.push(colHeader);
      exportRows.push(Object.assign({}, colHeader));
      var section = buildDrDailyDoctorIncomeRowsFromSlices(g.slices, pmap, day);
      displayRows = displayRows.concat(section.displayRows);
      exportRows = exportRows.concat(section.exportRows.map(function (r) {
        return Object.assign({}, r);
      }));
    });
    return { displayRows: displayRows, exportRows: exportRows };
  }

  function renderDrDailyDoctorIncomeReport(body, bundle) {
    if (!body) return;
    var meta = bundle.meta || {};
    var th = 'padding:10px 10px;background:#f0f7ff;color:#0d6efd;font-size:12px;font-weight:900;border-bottom:2px solid #0d6efd;text-align:left;';
    var td = 'padding:9px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top;';
    var rowsHtml = (bundle.displayRows || bundle.rows || []).map(function (r) {
      if (r._type === 'columnHeader') {
        return '<tr>' +
          '<th style="' + th + '">' + esc(r.transaction_code) + '</th>' +
          '<th style="' + th + '">' + esc(r.patient) + '</th>' +
          '<th style="' + th + 'width:120px;">' + esc(r.account) + '</th>' +
          '<th style="' + th + 'text-align:right;width:120px;">' + esc(r.received) + '</th>' +
          '<th style="' + th + '">' + esc(r.remarks) + '</th>' +
        '</tr>';
      }
      if (r._type === 'doctorSection') {
        return '<tr><td colspan="5" style="padding:10px 10px 6px;font-weight:900;color:#1e40af;font-size:14px;">' +
          esc(r.transaction_code || '') + '</td></tr>';
      }
      if (r._type === 'spacer') {
        return '<tr><td colspan="5" style="height:10px;border:none;"></td></tr>';
      }
      var isTotal = r._type === 'total';
      var isMethod = r._type === 'methodTotal';
      var acctStyle = td + (isMethod ? 'padding-left:28px;color:#475569;font-weight:800;' : (isTotal ? 'font-weight:900;color:#0f172a;' : 'color:#475569;font-weight:800;'));
      var recvStyle = td + 'text-align:right;font-weight:900;color:' + (isTotal ? '#15803d' : '#0369a1') + ';';
      var recvCell = r.received ? drMonthlyAmountDisplay(r.received) : '';
      return '<tr>' +
        '<td style="' + td + 'color:#334155;font-weight:800;">' + esc(r.transaction_code) + '</td>' +
        '<td style="' + td + 'color:#0f172a;">' + esc(r.patient) + '</td>' +
        '<td style="' + acctStyle + '">' + esc(r.account) + '</td>' +
        '<td style="' + recvStyle + '">' + esc(recvCell) + '</td>' +
        '<td style="' + td + 'color:#64748b;">' + esc(r.remarks) + '</td>' +
      '</tr>';
    }).join('');

    var tableHead = meta.allDoctors ? '' : (
      '<thead><tr>' +
        '<th style="' + th + '">' + esc(tr('report.drDaily.col.transactionCode')) + '</th>' +
        '<th style="' + th + '">' + esc(tr('report.ds.detail.thPatient')) + '</th>' +
        '<th style="' + th + 'width:120px;">' + esc(tr('report.drMonthly.col.account')) + '</th>' +
        '<th style="' + th + 'text-align:right;width:120px;">' + esc(tr('report.drDaily.col.received')) + '</th>' +
        '<th style="' + th + '">' + esc(tr('report.csv.remarks')) + '</th>' +
      '</tr></thead>'
    );

    body.innerHTML =
      '<div style="margin-bottom:12px;line-height:1.6;">' +
        '<div style="font-size:16px;font-weight:900;color:#0f172a;">' + esc(tr('report.drDaily.reportTitle')) + '</div>' +
        '<div style="font-size:13px;color:#475569;">' + esc(tr('report.drMonthly.labelClinic')) + ': <strong>' + esc(meta.clinic || '—') + '</strong></div>' +
        '<div style="font-size:13px;color:#475569;">' + esc(tr('report.dr.labelDoctor')) + ': <strong>' + esc(meta.doctorDisplay || meta.doctor || tr('report.dr.allDoctors')) + '</strong></div>' +
        '<div style="font-size:13px;color:#475569;">' + esc(tr('report.ds.labelDate')) + ': <strong>' + esc(meta.date || '') + '</strong></div>' +
      '</div>' +
      '<div style="border:1px solid #e5e7eb;border-radius:12px;overflow:auto;max-height:560px;background:#fff;">' +
        '<table style="width:100%;border-collapse:collapse;min-width:860px;">' +
          tableHead +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>';
  }

  async function prepareDrDailyDoctorIncomeExport(day, allDoctors, dr) {
    var slices = await loadReportPaymentSlices(day, day);
    var filtered = slices || [];
    if (!allDoctors) {
      filtered = filtered.filter(function (s) {
        return billMatchesDoctor(s.bill, dr);
      });
    }
    var patientIds = uniqIds(filtered.map(function (s) {
      return s.bill && s.bill.patient_id;
    }));
    var pts = patientIds.length ? await loadPatientsByIds(patientIds) : [];
    var pmap = {};
    pts.forEach(function (p) { if (p && p.id) pmap[p.id] = p; });

    var clinicLabel = reportActiveClinicLabel();
    var doctorDisplay = allDoctors ? tr('report.dr.allDoctors') : drDisplayName(dr);
    var doctorSlug = allDoctors
      ? 'all_doctors'
      : String(doctorTagOf(dr) || (dr && dr.id) || 'doctor').replace(/[^\w]+/g, '_').toLowerCase();
    var reportData = allDoctors
      ? buildDrDailyDoctorIncomeReportDataAllDoctors(filtered, _drDailyDoctors, pmap, day)
      : buildDrDailyDoctorIncomeReportData(filtered, pmap, day);

    return {
      meta: {
        dateKey: day,
        clinic: clinicLabel,
        doctor: allDoctors ? '' : doctorDisplay,
        doctorDisplay: doctorDisplay,
        allDoctors: allDoctors,
        doctorSlug: doctorSlug,
        date: formatDrDailyReportDate(day)
      },
      rows: reportData.exportRows,
      displayRows: reportData.displayRows
    };
  }

  function exportDrDailyDoctorIncomeExcel(exportBundle) {
    if (!exportBundle || !exportBundle.rows || !exportBundle.rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var meta = exportBundle.meta || {};
    var columns = drDailyDoctorIncomeColumns();
    var preface = [
      tr('report.drDaily.reportTitle'),
      trRepl('report.drMonthly.exportClinic', { C: meta.clinic || '' }),
      trRepl('report.drMonthly.exportDoctor', { D: meta.doctorDisplay || meta.doctor || tr('report.dr.allDoctors') }),
      trRepl('report.drDaily.exportDate', { D: meta.date || '' })
    ];
    var fname = 'dr_daily_income_' + (meta.dateKey || todayISO());
    if (meta.doctorSlug) fname += '_' + meta.doctorSlug;
    downloadReportExcel(fname, columns, exportBundle.rows, {
      prefaceRows: preface,
      colWidths: [140, 320, 120, 120, 240],
      numericKeys: ['received'],
      skipGlobalHeader: !!meta.allDoctors,
      headerBottomBorder: 'medium',
      rowMeta: function (r) {
        if (r._type === 'columnHeader') return { columnHeader: true };
        if (r._type === 'doctorSection') return { sectionHeader: true };
        if (r._type === 'total') return { bold: true };
        if (r._type === 'methodTotal') return { indentCol: 2 };
        return {};
      }
    });
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

    if (!_drDailyDoctorId) _drDailyDoctorId = REPORT_ALL_DOCTORS_ID;

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
    await ensureDrDoctorsLoaded();
    if (!_drDailyDoctorId) _drDailyDoctorId = REPORT_ALL_DOCTORS_ID;
    if (!isAllDoctorsChoice(_drDailyDoctorId) && !_drDailyDoctors.some(function (d) { return String(d.id) === String(_drDailyDoctorId); })) {
      _drDailyDoctorId = REPORT_ALL_DOCTORS_ID;
    }

    renderDrDailyShell();

    var body = g('rptDrDailyBody');
    if (!body) return;
    body.innerHTML = '<div style="padding:12px;color:#888;">' + esc(tr('report.loading')) + '</div>';

    try {
    var day = _drDailyDate || todayISO();
    setDateInputs(day, day);

    var allDoctors = isAllDoctorsChoice(_drDailyDoctorId);
    var dr = allDoctors ? null : (_drDailyDoctors.find(function (d) { return String(d.id) === String(_drDailyDoctorId); }) || null);
    if (!allDoctors && !dr) {
      body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noDoctorMsg')) + '</div>';
      _rows = [];
      _drDailyIncomeExport = null;
      return;
    }

    var incomeExportBundle = await prepareDrDailyDoctorIncomeExport(day, allDoctors, dr);
    _drDailyIncomeExport = incomeExportBundle;

    if (_drDailyMode === 'simple') {
      _clinicIncomeDetailExport = null;
      _rows = incomeExportBundle.rows || [];
      renderDrDailyDoctorIncomeReport(body, incomeExportBundle);
      return;
    }

    var _drDailyPar1 = await Promise.all([
      loadBillsLiteDedupe(day, day),
      loadTreatmentsByDay(day)
    ]);
    var bills = _drDailyPar1[0];
    var treatments = _drDailyPar1[1];

    var treatmentsMatched = allDoctors ? treatments.slice() : treatments.filter(function (t) {
      return treatmentMatchesDoctor(t, dr);
    });

    var tByPatient = {};
    treatmentsMatched.forEach(function (t) {
      var k = t.patient_id || '';
      if (!k) return;
      if (!tByPatient[k]) tByPatient[k] = [];
      tByPatient[k].push(t);
    });

    var directBills = allDoctors ? bills.slice() : bills.filter(function (b) { return billMatchesDoctor(b, dr); });
    var legacyBills = allDoctors ? [] : bills.filter(function (b) {
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
    var _drDailyPar2 = await Promise.all([
      loadPatientsByIds(patientIds),
      loadBillPaymentsForBillIds(filteredBills.map(function (b) { return b.id; }).filter(Boolean))
    ]);
    var pts = _drDailyPar2[0];
    var pmap = {};
    pts.forEach(function (p) { pmap[p.id] = p; });
    var paymentsByBillId = indexPaymentsByBillId(_drDailyPar2[1]);

    // When "All clinics" is selected, resolve each bill's clinic so the
    // per-clinic breakdown (badges + clinic column) renders like Daily Summary.
    var drDailyAllClinics = isReportAllClinicsSelected();
    var drDailyPatientClinicMap = drDailyAllClinics ? patientClinicMapFromPmap(pmap) : null;
    var drDailyApptResolver = drDailyAllClinics
      ? await buildAppointmentClinicResolver(day, day, filteredBills)
      : null;

    var tx = filteredBills.map(function (b) {
      var p = pmap[b.patient_id] || {};
      var extra = Object.assign({
        bill_date: b.bill_date || day,
        payment_date: b.bill_date || day,
        doctor_tag: b.doctor_tag || b.doctor_name || (dr ? doctorTagOf(dr) : '') || '',
        dr_treatments: tByPatient[b.patient_id] || []
      }, resolveBillDoctorFields(b, _drDailyDoctors));
      if (drDailyAllClinics) {
        var clinicTag = dailySummaryClinicTagForBill(
          b, p, (paymentsByBillId[b.id] || [])[0] || null,
          drDailyPatientClinicMap, drDailyApptResolver
        );
        extra.clinic_tag = clinicTag;
        extra.clinic_code = clinicCodeFromStoredTag(clinicTag);
      }
      return buildDailySummaryTxRow(b, p, paymentsByBillId, extra);
    });

    _rows = tx;
    var totalsPaid = sumByKeyPaidMethods(tx, 'payment_method', 'bill_paid');

    if (_drDailyMode === 'detail') {
      _clinicIncomeDetailExport = null;
      _drMonthlyIncomeExport = null;
      var drDailyDoctorLabel = allDoctors ? '' : drDisplayName(dr);
      var drDailyDoctorSlug = allDoctors
        ? 'all_doctors'
        : String(doctorTagOf(dr) || (dr && dr.id) || 'doctor').replace(/[^\w]+/g, '_').toLowerCase();
      presentClinicIncomeDetailReport(body, tx, {
        clinic: reportActiveClinicLabel(),
        periodLabel: formatDrMonthlyLongDate(day),
        periodTitle: tr('report.ds.labelDate'),
        dateKey: day,
        doctor: drDailyDoctorLabel,
        allDoctors: allDoctors,
        doctorSlug: drDailyDoctorSlug
      }, { from: day, to: day });
      return;
    }

    if (_drDailyMode === 'treatmentStats') {
      var byItem = {};
      tx.forEach(function (r) {
        var paid = Number(r.bill_paid != null ? r.bill_paid : 0);
        if (paid <= 0.005) return;
        accumulateTreatmentStatsMap(byItem, r.treatment_items, paid);
      });
      var grandFreq = 0;
      var grandAmt = 0;
      Object.keys(byItem).forEach(function (k) {
        grandFreq += byItem[k].frequency;
        grandAmt += byItem[k].amount_num;
      });
      var rows = Object.keys(byItem).map(function (k) {
        return {
          item_name: k,
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
    } catch (e) {
      body.innerHTML = '<div style="padding:14px;color:#dc2626;">' + esc(e.message || tr('report.error.loadingDataNote')) + '</div>';
      _rows = [];
    }
  }

  function renderDrMonthlyShell() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;
    var month = _drMonthlyMonth || monthKeyOf(todayISO());
    _drMonthlyMonth = month;
    if (!_drMonthlyDoctorId && _drDailyDoctorId) _drMonthlyDoctorId = _drDailyDoctorId;
    if (!_drMonthlyDoctorId) _drMonthlyDoctorId = REPORT_ALL_DOCTORS_ID;
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
    await ensureDrDoctorsLoaded();
    if (!_drMonthlyDoctorId) _drMonthlyDoctorId = REPORT_ALL_DOCTORS_ID;
    if (!isAllDoctorsChoice(_drMonthlyDoctorId) && !_drDailyDoctors.some(function (d) { return String(d.id) === String(_drMonthlyDoctorId); })) {
      _drMonthlyDoctorId = REPORT_ALL_DOCTORS_ID;
    }
    renderDrMonthlyShell();

    var body = g('rptDrMonthlyBody');
    if (!body) return;
    body.innerHTML = '<div style="padding:12px;color:#888;">' + esc(tr('report.loading')) + '</div>';

    try {
    var month = _drMonthlyMonth || monthKeyOf(todayISO());
    var from = month + '-01';
    var to = monthEndISO(month);
    setDateInputs(from, to);

    var allDoctors = isAllDoctorsChoice(_drMonthlyDoctorId);
    var dr = allDoctors ? null : (_drDailyDoctors.find(function (d) { return d.id === _drMonthlyDoctorId; }) || null);
    if (!allDoctors && !dr) {
      body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noDoctorMsg')) + '</div>';
      _rows = [];
      _drMonthlyIncomeExport = null;
      return;
    }

    // ── SIMPLE: Clinic Income layout (paid_date + payment-method splits) ──
    if (_drMonthlyMode === 'simple') {
      var slices = await loadReportPaymentSlices(from, to);
      var filteredSlices = slices || [];
      if (!allDoctors) {
        filteredSlices = filteredSlices.filter(function (s) {
          return billMatchesDoctor(s.bill, dr);
        });
      }
      var incomeData = allDoctors
        ? buildDrMonthlyIncomeReportDataForAllDoctors(filteredSlices, month, _drDailyDoctors)
        : buildDrMonthlyIncomeReportData(filteredSlices, month);
      var clinicLabel = isReportAllClinicsSelected()
        ? tr('report.audit.allClinics')
        : reportClinicLabelFromCode(reportClinicTag());
      var doctorLabel = allDoctors ? '' : drDisplayName(dr);
      var doctorSlug = allDoctors
        ? 'all_doctors'
        : String(doctorTagOf(dr) || (dr && dr.id) || 'doctor').replace(/[^\w]+/g, '_').toLowerCase();
      _drMonthlyIncomeExport = {
        meta: {
          monthKey: month,
          month: formatDrMonthlyMonthTitle(month),
          clinic: clinicLabel,
          doctor: doctorLabel,
          allDoctors: allDoctors,
          doctorSlug: doctorSlug
        },
        rows: incomeData.exportRows
      };
      if (!incomeData.exportRows || !incomeData.exportRows.length) {
        body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noBilledMonth')) + '</div>';
        _rows = [];
        _drMonthlyIncomeExport = null;
        return;
      }
      _rows = incomeData.exportRows;
      _clinicIncomeDetailExport = null;
      renderDrMonthlyIncomeReport(body, incomeData, clinicLabel, doctorLabel, month, allDoctors);
      return;
    }

    var bills = await loadBillsLiteDedupe(from, to);
    var filtered = allDoctors ? bills.slice() : bills.filter(function (b) { return billMatchesDoctor(b, dr); });

    if (!filtered.length) {
      body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noBilledMonth')) + '</div>';
      _rows = [];
      _drMonthlyIncomeExport = null;
      return;
    }

    // ───────────────────────────────────────────────────────
    // MODE: Treatment Statistics (monthly)
    // ───────────────────────────────────────────────────────
    if (_drMonthlyMode === 'treatmentStats') {
      var byItem = {};
      filtered.forEach(function (b) {
        var paid = reportBillPaidValue(b);
        if (paid <= 0.005) return;
        accumulateTreatmentStatsMap(byItem, b.items, paid);
      });

      var grandItems = 0;
      var grandIncome = 0;
      Object.keys(byItem).forEach(function (k) {
        grandItems += byItem[k].frequency;
        grandIncome += byItem[k].amount_num;
      });

      var rows = Object.keys(byItem).map(function (k) {
        return { item: k, freq: byItem[k].frequency, income: byItem[k].amount_num };
      }).sort(function (a, b) { return b.income - a.income; });

      if (!rows.length) {
        body.innerHTML = '<div style="padding:14px;color:#64748b;">' + esc(tr('report.dr.noBilledTreatmentMonth')) + '</div>';
        _rows = [];
        return;
      }

      _rows = rows.map(function (r) {
        return { item: r.item, frequency: r.freq, income: r.income.toFixed(2) };
      });
      // Append total row so it appears in CSV export
      _rows = _rows.concat([{ item: tr('report.drStats.totalRow'), frequency: grandItems, income: grandIncome.toFixed(2) }]);

      var th = 'padding:10px 12px;background:#f3f0ff;color:#6d28d9;font-size:12px;font-weight:900;border-bottom:2px solid #e9ddff;text-align:left;';
      var td = 'padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:middle;';
      var dataRows = _rows.slice(0, _rows.length - 1);
      var rowsHtml = dataRows.map(function (r) {
        return '<tr>' +
          '<td style="' + td + 'font-weight:900;color:#0f172a;">' + esc(r.item) + '</td>' +
          '<td style="' + td + 'text-align:right;">' + esc(String(r.frequency || 0)) + '</td>' +
          '<td style="' + td + 'text-align:right;font-weight:900;color:#6d28d9;">' + fmtHK(Number(r.income)) + '</td>' +
        '</tr>';
      }).join('');
      var tfootStyle = 'padding:10px 12px;font-size:13px;vertical-align:middle;background:#f3f0ff;border-top:2px solid #c4b5fd;';
      var totalFooter =
        '<tfoot><tr>' +
          '<td style="' + tfootStyle + 'font-weight:900;color:#4c1d95;">' + esc(tr('report.drStats.totalRow')) + '</td>' +
          '<td style="' + tfootStyle + 'text-align:right;font-weight:900;color:#4c1d95;">' + esc(String(grandItems)) + '</td>' +
          '<td style="' + tfootStyle + 'text-align:right;font-weight:900;color:#4c1d95;">' + fmtHK(grandIncome) + '</td>' +
        '</tr></tfoot>';

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
              totalFooter +
            '</table>' +
          '</div>' +
        '</div>';
      return;
    }

    // Build transaction rows for Detail mode (reuse existing renderer)
    if (_drMonthlyMode === 'detail') {
      var patientIds = filtered.map(function (b) { return b.patient_id; }).filter(Boolean);
      var _drMoPar = await Promise.all([
        loadPatientsByIds(patientIds),
        loadBillPaymentsForBillIds(filtered.map(function (b) { return b.id; }).filter(Boolean))
      ]);
      var pts = _drMoPar[0];
      var pmap = {};
      pts.forEach(function (p) { pmap[p.id] = p; });
      var paymentsByBillId = indexPaymentsByBillId(_drMoPar[1]);

      var drMoAllClinics = isReportAllClinicsSelected();
      var drMoPatientClinicMap = drMoAllClinics ? patientClinicMapFromPmap(pmap) : null;
      var drMoApptResolver = drMoAllClinics
        ? await buildAppointmentClinicResolver(from, to, filtered)
        : null;

      var tx = filtered.map(function (b) {
        var p = pmap[b.patient_id] || {};
        var extra = Object.assign({
          bill_date: b.bill_date || '',
          payment_date: b.bill_date || ''
        }, resolveBillDoctorFields(b, _drDailyDoctors));
        if (drMoAllClinics) {
          var clinicTag = dailySummaryClinicTagForBill(
            b, p, (paymentsByBillId[b.id] || [])[0] || null,
            drMoPatientClinicMap, drMoApptResolver
          );
          extra.clinic_tag = clinicTag;
          extra.clinic_code = clinicCodeFromStoredTag(clinicTag);
        }
        return buildDailySummaryTxRow(b, p, paymentsByBillId, extra);
      });

      _rows = tx;
      _clinicIncomeDetailExport = null;
      _drMonthlyIncomeExport = null;
      var drMoDoctorLabel = allDoctors ? '' : drDisplayName(dr);
      var drMoDoctorSlug = allDoctors
        ? 'all_doctors'
        : String(doctorTagOf(dr) || (dr && dr.id) || 'doctor').replace(/[^\w]+/g, '_').toLowerCase();
      presentClinicIncomeDetailReport(body, tx, {
        clinic: reportActiveClinicLabel(),
        month: formatDrMonthlyMonthTitle(month),
        monthKey: month,
        periodLabel: formatDrMonthlyMonthTitle(month),
        periodTitle: tr('report.ds.labelMonth'),
        doctor: drMoDoctorLabel,
        allDoctors: allDoctors,
        doctorSlug: drMoDoctorSlug
      }, { yyyyMm: month });
      return;
    }
    } catch (e) {
      body.innerHTML = '<div style="padding:14px;color:#dc2626;">' + esc(e.message || tr('report.error.loadingDataNote')) + '</div>';
      _rows = [];
      _drMonthlyIncomeExport = null;
    }
  }

  async function buildDailySummaryMonthlyClinicIncome(fromM, toM) {
    var body = g('rptDailySummaryBody');
    if (!body) return;
    var monthKey = monthKeyOf(fromM) || _dailySummaryMonth || monthKeyOf(todayISO());
    _dailySummaryMonth = monthKey;
    var incomeData = await setDailySummaryClinicIncomeExportBundle(fromM, toM);
    var clinicLabel = reportActiveClinicLabel();
    _rows = incomeData.exportRows;
    _clinicIncomeDetailExport = null;
    renderDrMonthlyIncomeReport(body, incomeData, clinicLabel, '', monthKey, false);
  }

  async function buildDailySummaryForDateRange(fromM, toM, doctors) {
    if (_dailySummaryView === 'monthly' && !_dailySummaryDetailMode) {
      await buildDailySummaryMonthlyClinicIncome(fromM, toM);
      return;
    }
    _dailySummaryIncomeExport = null;
    var monthSlices = await loadReportPaymentSlices(fromM, toM);
    var groups = {};
    var order = [];
    monthSlices.forEach(function (s) {
      var d = s.paid_date;
      if (!d) return;
      if (!groups[d]) { groups[d] = {}; order.push(d); }
      var bid = s.bill && s.bill.id;
      if (!bid) return;
      if (!groups[d][bid]) groups[d][bid] = [];
      groups[d][bid].push(s.payment);
    });
    order.sort();

    var monthBillMap = {};
    monthSlices.forEach(function (s) {
      if (s.bill && s.bill.id) monthBillMap[s.bill.id] = s.bill;
    });

    var allBillIds = Object.keys(monthBillMap);
    var patientIdsM = allBillIds.map(function (id) {
      return monthBillMap[id] ? monthBillMap[id].patient_id : '';
    }).filter(Boolean);
    var _mBillsArr = allBillIds.map(function (bid) { return monthBillMap[bid]; });
    var _mPar1 = await Promise.all([
      loadPatientsByIds(patientIdsM),
      loadAppointmentsForDailySummary(fromM, toM, _mBillsArr),
      buildAppointmentClinicResolver(fromM, toM, _mBillsArr)
    ]);
    var ptsM = _mPar1[0];
    var pmapM = {};
    ptsM.forEach(function (p) { pmapM[p.id] = p; });
    var apptCtxM = _mPar1[1];
    var appointmentResolverM = _mPar1[2];
    var patientClinicMapM = patientClinicMapFromPmap(pmapM);

    var seenBillMeta = {};
    var monthAllTx = [];
    var dayCards = order.map(function (d) {
      var billGroups = groups[d] || {};
      var billIdsThisDay = Object.keys(billGroups);
      var rows = billIdsThisDay.map(function (bid) {
        var b = monthBillMap[bid] || {};
        var p = pmapM[b.patient_id] || {};
        var payRows = billGroups[bid] || [];
        var paidAmount = payRows.reduce(function (s, x) { return s + Number(x.amount || 0); }, 0);
        var allocs = reducePaymentAllocations(payRows);
        var ref = String(b.id || '').trim();
        if (!ref) {
          var ct = String(b.created_at || '').replace(/\D/g, '');
          ref = ct ? ('TX-' + ct.slice(-10)) : 'N/A';
        }
        var clinicTag = dailySummaryClinicTagForBill(b, p, payRows[0] || null, patientClinicMapM, appointmentResolverM);
        var includeBillMeta = !seenBillMeta[bid];
        seenBillMeta[bid] = true;
        var txRow = buildDailySummaryTxRowFromPaymentSlice(b, p, paidAmount, allocs, Object.assign({
          bill_ref: ref,
          bill_date: d,
          payment_date: d,
          clinic_tag: clinicTag,
          clinic_code: clinicCodeFromStoredTag(clinicTag),
          include_bill_meta: includeBillMeta
        }, resolveBillDoctorFields(b, doctors), resolveBillAppointmentFields(b, apptCtxM, d)));
        monthAllTx.push(txRow);
        return txRow;
      }).sort(dailySummaryTxSortCompare);
      var paidTotal = rows.reduce(function (acc, r) { return acc + Number(r.bill_paid || 0); }, 0);
      return { date: d, paidTotal: paidTotal, rows: rows };
    });

    var seenBillIdsInMonthTx = indexDailySummaryTxByBillId(monthAllTx);
    var pendingMonthBills = (await loadBillsLiteDedupe(fromM, toM)).filter(reportIsPendingUnpaidBill);
    pmapM = await mergePatientsForBills(pendingMonthBills, pmapM);
    var pendingMonthRows = [];
    pendingMonthBills.forEach(function (b) {
      if (!b || !b.id || seenBillIdsInMonthTx[b.id]) return;
      var billDay = dailySummaryBillDayKey(b);
      if (!billDay || billDay < fromM || billDay > toM) return;
      var p = pmapM[b.patient_id] || {};
      var txRow = buildDailySummaryPendingBillTxRow(b, p, doctors, apptCtxM, billDay, appointmentResolverM);
      pendingMonthRows.push(txRow);
      monthAllTx.push(txRow);
      seenBillIdsInMonthTx[b.id] = true;
    });
    if (pendingMonthRows.length) {
      dayCards = appendPendingRowsToDayCards(dayCards, pendingMonthRows);
    }

    var totalsByMethodPaidM = sumByKeyPaidMethods(monthAllTx, 'payment_method', 'bill_paid');

    _rows = monthAllTx;
    if (_dailySummaryDetailMode) {
      _dailySummaryIncomeExport = null;
      var dsMonthKey = monthKeyOf(fromM);
      var dsBody = g('rptDailySummaryBody');
      var dsIsMonthly = _dailySummaryView === 'monthly';
      presentClinicIncomeDetailReport(dsBody, monthAllTx, {
        clinic: reportActiveClinicLabel(),
        month: dsIsMonthly ? formatDrMonthlyMonthTitle(dsMonthKey) : '',
        monthKey: dsIsMonthly ? dsMonthKey : '',
        periodLabel: dsIsMonthly
          ? formatDrMonthlyMonthTitle(dsMonthKey)
          : (fromM === toM
            ? formatDrMonthlyLongDate(fromM)
            : (formatDrMonthlyLongDate(fromM) + ' – ' + formatDrMonthlyLongDate(toM))),
        periodTitle: dsIsMonthly ? tr('report.ds.labelMonth') : tr('report.ds.labelDate'),
        dateKey: !dsIsMonthly && fromM === toM ? fromM : ''
      }, dsIsMonthly ? { yyyyMm: dsMonthKey } : { from: fromM, to: toM });
    } else {
      _clinicIncomeDetailExport = null;
      setDailySummaryDailySimpleExportBundle(monthAllTx, fromM, toM);
      renderDailySummaryMonthly(dayCards, totalsByMethodPaidM);
    }
  }

  async function buildDailySummary(refreshSeq) {
    var from = g('rptFrom') ? g('rptFrom').value : todayISO();
    var to = g('rptTo') ? g('rptTo').value : todayISO();
    var doctors = await ensureDrDoctorsLoaded();
    // Abort if a newer refresh has already started — avoids stale data renders.
    if (refreshSeq !== _refreshSeq) return;
    var range = syncDailySummaryStateFromReportDates(from, to);

    // Daily view: single day table, or multi-day grouped view when From ≠ To
    if (_dailySummaryView === 'daily') {
      if (range.from !== range.to) {
        await buildDailySummaryForDateRange(range.from, range.to, doctors);
        return;
      }

      var day = range.from;
      var daySlices = await loadReportPaymentSlices(day, day);
      if (refreshSeq !== _refreshSeq) return;

      var groupedByBill = {};
      var paidBillMap = {};
      daySlices.forEach(function (s) {
        var bid = s.bill && s.bill.id;
        if (!bid) return;
        paidBillMap[bid] = s.bill;
        if (!groupedByBill[bid]) groupedByBill[bid] = [];
        groupedByBill[bid].push(s.payment);
      });

      var txBillIds = Object.keys(groupedByBill);
      var patientIds = txBillIds.map(function (bid) {
        return paidBillMap[bid] ? paidBillMap[bid].patient_id : '';
      }).filter(Boolean);
      // loadPatientsByIds and loadBillsLite are independent — run in parallel.
      // loadBillsLiteDedupe reuses the Promise already fired inside loadReportPaymentSlices.
      var _dsPar1 = await Promise.all([
        loadPatientsByIds(patientIds),
        loadBillsLiteDedupe(day, day)
      ]);
      if (refreshSeq !== _refreshSeq) return;
      var pts = _dsPar1[0];
      var pmap = {};
      pts.forEach(function (p) { pmap[p.id] = p; });

      var pendingDayBills = _dsPar1[1].filter(reportIsPendingUnpaidBill);
      var billsForAppt = Object.keys(paidBillMap).map(function (bid) {
        return paidBillMap[bid];
      });
      pendingDayBills.forEach(function (b) {
        if (b && b.id && !paidBillMap[b.id]) billsForAppt.push(b);
      });
      // apptCtx and appointmentResolver are independent — run in parallel.
      var _dsPar2 = await Promise.all([
        loadAppointmentsForDailySummary(day, day, billsForAppt),
        buildAppointmentClinicResolver(day, day, billsForAppt)
      ]);
      if (refreshSeq !== _refreshSeq) return;
      var apptCtx = _dsPar2[0];
      var appointmentResolver = _dsPar2[1];
      var patientClinicMap = patientClinicMapFromPmap(pmap);

      var tx = txBillIds.map(function (bid) {
        var b = paidBillMap[bid] || {};
        var p = pmap[b.patient_id] || {};
        var rows = groupedByBill[bid] || [];
        var paidAmount = rows.reduce(function (s, x) { return s + Number(x.amount || 0); }, 0);
        var allocs = reducePaymentAllocations(rows);
        var ref = String(b.id || '').trim();
        if (!ref) {
          var ct = String(b.created_at || '').replace(/\D/g, '');
          ref = ct ? ('TX-' + ct.slice(-10)) : 'N/A';
        }
        var clinicTag = dailySummaryClinicTagForBill(b, p, rows[0] || null, patientClinicMap, appointmentResolver);
        return buildDailySummaryTxRowFromPaymentSlice(b, p, paidAmount, allocs, Object.assign({
          bill_ref: ref,
          bill_date: day,
          payment_date: day,
          clinic_tag: clinicTag,
          clinic_code: clinicCodeFromStoredTag(clinicTag)
        }, resolveBillDoctorFields(b, doctors), resolveBillAppointmentFields(b, apptCtx, day)));
      }).sort(dailySummaryTxSortCompare);

      tx = await appendPendingUnpaidBillsToDailySummaryTx(day, day, tx, pmap, doctors, apptCtx, appointmentResolver);
      if (refreshSeq !== _refreshSeq) return;

      var totalsPaid = sumByKeyPaidMethods(tx, 'payment_method', 'bill_paid');

      _rows = tx;
      if (!_dailySummaryDetailMode) {
        setDailySummaryDailySimpleExportBundle(tx, day, day);
      } else {
        _dailySummaryIncomeExport = null;
      }
      if (_dailySummaryDetailMode) {
        _clinicIncomeDetailExport = null;
        presentClinicIncomeDetailReport(g('rptDailySummaryBody'), tx, {
          clinic: reportActiveClinicLabel(),
          periodLabel: formatDrMonthlyLongDate(day),
          periodTitle: tr('report.ds.labelDate'),
          dateKey: day
        }, { from: day, to: day });
      } else {
        _clinicIncomeDetailExport = null;
        renderDailySummaryDaily(tx, totalsPaid);
      }
      return;
    }

    // Monthly view uses the month picker, or the month of the From date when top range changes
    var monthKey = _dailySummaryMonth || monthKeyOf(range.from) || monthKeyOf(todayISO());
    _dailySummaryMonth = monthKey;
    var base = parseDateToLocal(monthKey + '-01');
    var first = firstDayOfMonth(base);
    var last = lastDayOfMonth(base);
    var fromM = iso(first);
    var toM = iso(last);
    setDateInputs(fromM, toM);

    if (refreshSeq !== _refreshSeq) return;
    await buildDailySummaryForDateRange(fromM, toM, doctors);
  }

  function renderDailySummaryShell() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;

    var today = todayISO();
    var dailyDate = (g('rptFrom') && g('rptFrom').value) || _dailySummaryDate || today;
    _dailySummaryDate = dailyDate;

    var curMonth = _dailySummaryMonth ||
      monthKeyOf((g('rptFrom') && g('rptFrom').value) || dailyDate || today) ||
      monthKeyOf(today);
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
            ((_dailySummaryView === 'monthly') ? '' : dailySummaryAllClinicsLayoutToggleHtml()) +
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

  function auditSubTabBtnStyle(active) {
    return 'padding:8px 14px;font-size:12px;font-weight:800;border-radius:8px;border:1px solid ' +
      (active ? '#0d6efd' : '#cbd5e1') + ';background:' + (active ? 'var(--primary)' : '#fff') +
      ';color:' + (active ? '#fff' : '#334155') + ';cursor:pointer;';
  }

  function updateAuditSubTabUi() {
    var logBtn = g('rptAuditSubTabLog');
    var voidBtn = g('rptAuditSubTabVoid');
    var logPanel = g('rptAuditLogPanel');
    var voidPanel = g('rptAuditVoidPanel');
    var isVoid = _auditSubTab === 'voidBills';
    if (logBtn) logBtn.style.cssText = auditSubTabBtnStyle(!isVoid);
    if (voidBtn) voidBtn.style.cssText = auditSubTabBtnStyle(isVoid);
    if (logPanel) logPanel.style.display = isVoid ? 'none' : '';
    if (voidPanel) voidPanel.style.display = isVoid ? '' : 'none';
  }

  function switchAuditSubTab(key) {
    _auditSubTab = (key === 'voidBills') ? 'voidBills' : 'log';
    updateAuditSubTabUi();
    if (_tab !== 'auditTrail') return;
    if (_auditSubTab === 'voidBills') {
      setHeader(tr('report.title.auditTrail'), tr('report.hint.voidBills'));
      if (!_voidBillRows.length) {
        loadVoidBillsManager();
      } else {
        renderVoidBillsList();
      }
      return;
    }
    setHeader(tr('report.title.auditTrail'), tr('report.hint.auditTrail'));
    if (!_auditTrailDataLoaded) {
      loadAuditTrail();
    } else {
      renderAuditTrailList();
    }
  }

  function voidBillFmtMoney(n) {
    var v = Number(n || 0);
    if (typeof fmtHK === 'function') return fmtHK(v);
    return '$' + v.toFixed(2);
  }

  function auditRowIsBillVoid(a) {
    if (!a || a.table_name !== 'bills') return false;
    var detail = String(a.changes_detail || '').toUpperCase();
    if (detail.indexOf('VOIDED_AT') >= 0 || detail.indexOf('VOIDED_BY') >= 0) return true;
    var pl = a.payload;
    if (pl && typeof pl === 'object') {
      var data = pl.data;
      if (data && !Array.isArray(data) && data.voided_at) return true;
      if (Array.isArray(data) && data.length && data[0] && data[0].voided_at) return true;
    }
    return false;
  }

  function buildVoidBillAuditMap(auditRows, bills) {
    var map = {};
    (bills || []).forEach(function (b) {
      if (!b || !b.id) return;
      var best = null;
      var bestDiff = Infinity;
      var voidTs = b.voided_at ? new Date(b.voided_at).getTime() : NaN;
      (auditRows || []).forEach(function (a) {
        if (String(a.record_id || '') !== String(b.id)) return;
        if (!auditRowIsBillVoid(a)) return;
        var ats = a.created_at ? new Date(a.created_at).getTime() : NaN;
        var diff = (isNaN(voidTs) || isNaN(ats)) ? 0 : Math.abs(ats - voidTs);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = a;
        }
      });
      if (best) map[b.id] = best;
    });
    return map;
  }

  function enrichVoidBillRow(bill, audit) {
    var clinic = '';
    if (audit && audit.clinic_tag) clinic = String(audit.clinic_tag);
    else if (bill.clinic_tag) clinic = String(bill.clinic_tag);
    else if (bill.clinic_code) clinic = String(bill.clinic_code);
    return {
      id: bill.id,
      bill: bill,
      audit: audit || null,
      voided_at: bill.voided_at,
      voided_by: bill.voided_by || '',
      client_host: audit ? (audit.client_host || '') : '',
      clinic: clinic,
      user_id: audit ? (audit.user_id || '') : '',
      user_name: audit ? (audit.user_name || '') : (bill.voided_by || ''),
      patient_no: bill.patient_no || '',
      patient_name: bill.patient_name || '',
      doctor_tag: bill.doctor_tag || '',
      doctor_name: bill.doctor_name || ''
    };
  }

  function voidBillVoidDateKey(isoStr) {
    if (!isoStr) return '';
    var raw = String(isoStr).trim();
    if (raw.indexOf('T') >= 0) return raw.split('T')[0].slice(0, 10);
    return raw.slice(0, 10);
  }

  function voidBillMatchesReportClinicFilter(row) {
    var tag = reportClinicTag();
    if (!tag) return true;
    var code = row.clinic ||
      (row.bill && (row.bill.clinic_tag || row.bill.clinic_code)) ||
      (row.audit && row.audit.clinic_tag) ||
      '';
    if (!code) return true;
    return clinicCodesMatch(code, tag);
  }

  function filteredVoidBillRows() {
    var pQ = String(_voidBillSearchPatient || '').trim().toLowerCase();
    var uQ = String(_voidBillSearchUser || '').trim().toLowerCase();
    var dQ = String(_voidBillSearchDoctor || '').trim().toLowerCase();
    var cQ = String(_voidBillSearchClinic || '').trim().toLowerCase();
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : '';
    var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : '';
    var rows = (_voidBillRows || []).filter(function (row) {
      if (from || to) {
        var vd = voidBillVoidDateKey(row.voided_at);
        if (!vd) return false;
        if (from && vd < from) return false;
        if (to && vd > to) return false;
      }
      if (!voidBillMatchesReportClinicFilter(row)) return false;
      if (pQ) {
        var ph = (String(row.patient_no || '') + ' ' + String(row.patient_name || '')).toLowerCase();
        if (ph.indexOf(pQ) < 0) return false;
      }
      if (uQ) {
        var uh = (String(row.voided_by || '') + ' ' + String(row.user_name || '') + ' ' + String(row.user_id || '')).toLowerCase();
        if (uh.indexOf(uQ) < 0) return false;
      }
      if (dQ) {
        var dh = (String(row.doctor_tag || '') + ' ' + String(row.doctor_name || '')).toLowerCase();
        if (dh.indexOf(dQ) < 0) return false;
      }
      if (cQ) {
        var ch = String(row.clinic || '').toLowerCase();
        if (ch.indexOf(cQ) < 0) return false;
      }
      return true;
    });
    rows.sort(function (a, b) {
      var ta = a.voided_at ? new Date(a.voided_at).getTime() : 0;
      var tb = b.voided_at ? new Date(b.voided_at).getTime() : 0;
      return tb - ta;
    });
    return rows;
  }

  function updateVoidBillFilterSummary() {
    var el = g('rptVoidBillFilterSummary');
    if (!el) return;
    var clinic = reportClinicTag() || tr('report.audit.allClinics');
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : '';
    var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : '';
    var shown = filteredVoidBillRows().length;
    var total = (_voidBillRows || []).length;
    el.innerHTML =
      esc(clinic) + '<br>' +
      esc(from) + ' – ' + esc(to) + '<br>' +
      esc(trRepl('report.voidBills.summaryCount', { SHOWN: String(shown), TOTAL: String(total) }));
  }

  function voidBillDetailRow(label, value) {
    return '<div class="rpt-void-detail-row">' +
      '<div class="rpt-void-detail-label">' + esc(label) + '</div>' +
      '<div class="rpt-void-detail-value">' + esc(value || '—') + '</div>' +
      '</div>';
  }

  function renderVoidBillDetail(row) {
    var panel = g('rptVoidBillDetail');
    if (!panel) return;
    if (!row || !row.bill) {
      panel.innerHTML = '<div style="padding:14px;color:#888;font-size:12px;">' + esc(tr('report.voidBills.detailPlaceholder')) + '</div>';
      return;
    }
    var b = row.bill;
    var auditDetail = '';
    if (row.audit) {
      auditDetail = row.audit.changes_detail || '';
      if (!auditDetail && row.audit.payload) {
        try {
          auditDetail = typeof row.audit.payload === 'string'
            ? row.audit.payload
            : JSON.stringify(row.audit.payload, null, 2);
        } catch (eJson) {
          auditDetail = String(row.audit.payload);
        }
      }
    }
    var voidWhen = auditFmtServerDate(row.voided_at) + ' ' + auditFmtTime(row.voided_at);
    var userDisp = row.user_name || row.voided_by || row.user_id || '—';
    if (row.user_id && row.user_name && row.user_name !== row.user_id) {
      userDisp = row.user_name + ' (' + row.user_id + ')';
    }
    panel.innerHTML =
      '<div class="rpt-void-detail-head">' +
        '<div class="rpt-void-detail-title">' + esc(tr('report.voidBills.detailTitle')) + '</div>' +
        '<div class="rpt-void-detail-sub">' + esc(voidWhen) + '</div>' +
      '</div>' +
      '<div class="rpt-void-detail-body">' +
        '<div class="rpt-void-detail-section">' + esc(tr('report.voidBills.sectionVoidAction')) + '</div>' +
        voidBillDetailRow(tr('report.voidBills.field.voidDateTime'), voidWhen) +
        voidBillDetailRow(tr('report.voidBills.field.location'), row.client_host || tr('report.voidBills.locationUnknown')) +
        voidBillDetailRow(tr('report.voidBills.field.clinic'), row.clinic) +
        voidBillDetailRow(tr('report.voidBills.field.user'), userDisp) +
        '<div class="rpt-void-detail-section">' + esc(tr('report.voidBills.sectionPatient')) + '</div>' +
        voidBillDetailRow(tr('report.voidBills.field.patientNo'), row.patient_no) +
        voidBillDetailRow(tr('report.voidBills.field.patientName'), row.patient_name) +
        '<div class="rpt-void-detail-section">' + esc(tr('report.voidBills.sectionDoctor')) + '</div>' +
        voidBillDetailRow(tr('report.voidBills.field.doctor'), (row.doctor_name || row.doctor_tag || '')) +
        voidBillDetailRow(tr('report.voidBills.field.doctorTag'), row.doctor_tag) +
        '<div class="rpt-void-detail-section">' + esc(tr('report.voidBills.sectionBill')) + '</div>' +
        voidBillDetailRow(tr('report.voidBills.field.billId'), String(b.id || '').slice(0, 8)) +
        voidBillDetailRow(tr('report.voidBills.field.billDate'), b.bill_date || '') +
        voidBillDetailRow(tr('report.voidBills.field.billType'), b.bill_type || '') +
        voidBillDetailRow(tr('report.voidBills.field.total'), voidBillFmtMoney(b.total)) +
        voidBillDetailRow(tr('report.voidBills.field.paid'), voidBillFmtMoney(b.amount_paid)) +
        voidBillDetailRow(tr('report.voidBills.field.balance'), voidBillFmtMoney(b.balance)) +
        voidBillDetailRow(tr('report.voidBills.field.status'), b.status || '') +
        voidBillDetailRow(tr('report.voidBills.field.notes'), b.notes || '') +
        (auditDetail
          ? ('<div class="rpt-void-detail-section">' + esc(tr('report.voidBills.sectionAudit')) + '</div>' +
            '<pre class="rpt-void-audit-pre">' + esc(auditDetail) + '</pre>')
          : '') +
      '</div>';
  }

  function voidBillPageCount(total) {
    var n = Number(total || 0);
    if (n <= 0) return 1;
    return Math.max(1, Math.ceil(n / _voidBillPageSize));
  }

  function voidBillClampPageIndex(total) {
    var pageCount = voidBillPageCount(total);
    if (_voidBillPageIndex >= pageCount) _voidBillPageIndex = pageCount - 1;
    if (_voidBillPageIndex < 0) _voidBillPageIndex = 0;
  }

  function voidBillChangePage(delta) {
    var total = filteredVoidBillRows().length;
    if (!total) return;
    var pageCount = voidBillPageCount(total);
    var step = parseInt(delta, 10) || 0;
    if (!step) return;
    var target = _voidBillPageIndex + step;
    if (target < 0) target = 0;
    if (target >= pageCount) target = pageCount - 1;
    if (target === _voidBillPageIndex) return;
    _voidBillPageIndex = target;
    renderVoidBillsList();
  }

  function voidBillJumpToPage(rawValue) {
    var hint = g('rptVoidBillJumpHint');
    var total = filteredVoidBillRows().length;
    if (!total) return;
    var pageCount = voidBillPageCount(total);
    var raw = String(rawValue || '').trim();
    if (!raw) {
      if (hint) hint.textContent = tr('report.voidBills.page.jumpNeedNumber');
      return;
    }
    var n = parseInt(raw, 10);
    if (isNaN(n)) {
      if (hint) hint.textContent = tr('report.voidBills.page.jumpNeedNumber');
      return;
    }
    if (n < 1 || n > pageCount) {
      if (hint) hint.textContent = trRepl('report.voidBills.page.jumpRange', { MAX: String(pageCount) });
      return;
    }
    if (hint) hint.textContent = '';
    _voidBillPageIndex = n - 1;
    renderVoidBillsList();
  }

  function voidBillApplyPageSize() {
    var sel = g('rptVoidBillPageSize');
    if (!sel) return;
    var n = parseInt(sel.value, 10);
    if (VOID_BILL_PAGE_SIZE_OPTIONS.indexOf(n) < 0) {
      sel.value = String(_voidBillPageSize);
      return;
    }
    if (n === _voidBillPageSize) return;
    _voidBillPageSize = n;
    _voidBillPageIndex = 0;
    var hint = g('rptVoidBillJumpHint');
    if (hint) hint.textContent = '';
    renderVoidBillsList();
  }

  function voidBillPagerHtml(total, pageRows) {
    var pageCount = voidBillPageCount(total);
    var curPage = Math.min(_voidBillPageIndex + 1, pageCount);
    var from = total ? (_voidBillPageIndex * _voidBillPageSize + 1) : 0;
    var to = total ? (_voidBillPageIndex * _voidBillPageSize + (pageRows ? pageRows.length : 0)) : 0;
    var infoText = total
      ? trRepl('report.voidBills.page.summary', { FROM: String(from), TO: String(to), TOTAL: String(total) })
      : tr('report.voidBills.noVoidBills');
    var pageLabel = trRepl('report.voidBills.page.counter', { PAGE: String(curPage), PAGES: String(pageCount) });
    var sizeOpts = '';
    VOID_BILL_PAGE_SIZE_OPTIONS.forEach(function (n) {
      sizeOpts += '<option value="' + n + '"' + (n === _voidBillPageSize ? ' selected' : '') + '>' + n + '</option>';
    });
    return '<div class="patient-dir-pager rpt-void-pager">' +
      '<div id="rptVoidBillPagerInfo" class="patient-dir-pager-info">' + esc(infoText) + '</div>' +
      '<div class="patient-dir-pager-actions">' +
        '<label for="rptVoidBillPageSize" class="patient-dir-page-size-label">' + esc(tr('report.voidBills.page.sizeLabel')) + '</label>' +
        '<select id="rptVoidBillPageSize" class="patient-dir-page-size-select">' + sizeOpts + '</select>' +
        '<button type="button" id="rptVoidBillPrevBtn" class="patient-dir-page-btn" title="' + esc(tr('report.voidBills.page.prev')) + '"' +
          (_voidBillPageIndex <= 0 ? ' disabled' : '') + '>' + esc(tr('report.voidBills.page.prev')) + '</button>' +
        '<div id="rptVoidBillPageLabel" class="patient-dir-page-label">' + esc(pageLabel) + '</div>' +
        '<button type="button" id="rptVoidBillNextBtn" class="patient-dir-page-btn" title="' + esc(tr('report.voidBills.page.next')) + '"' +
          ((_voidBillPageIndex + 1) >= pageCount ? ' disabled' : '') + '>' + esc(tr('report.voidBills.page.next')) + '</button>' +
        '<label for="rptVoidBillJumpInput" class="patient-dir-jump-label">' + esc(tr('report.voidBills.page.jumpLabel')) + '</label>' +
        '<input type="number" id="rptVoidBillJumpInput" class="patient-dir-jump-input" min="1" max="' + pageCount + '" step="1" inputmode="numeric" placeholder="' + curPage + '">' +
        '<button type="button" id="rptVoidBillJumpBtn" class="patient-dir-page-btn">' + esc(tr('report.voidBills.page.go')) + '</button>' +
        '<span id="rptVoidBillJumpHint" class="patient-dir-jump-hint" aria-live="polite"></span>' +
      '</div>' +
    '</div>';
  }

  function wireVoidBillPager() {
    var prev = g('rptVoidBillPrevBtn');
    var next = g('rptVoidBillNextBtn');
    var jumpBtn = g('rptVoidBillJumpBtn');
    var jumpInp = g('rptVoidBillJumpInput');
    var pageSizeSel = g('rptVoidBillPageSize');
    if (prev) prev.onclick = function () { voidBillChangePage(-1); };
    if (next) next.onclick = function () { voidBillChangePage(1); };
    if (jumpBtn) {
      jumpBtn.onclick = function () {
        voidBillJumpToPage(jumpInp ? jumpInp.value : '');
      };
    }
    if (jumpInp) {
      jumpInp.onkeydown = function (e) {
        if (e.key === 'Enter') voidBillJumpToPage(jumpInp.value);
      };
    }
    if (pageSizeSel) pageSizeSel.onchange = voidBillApplyPageSize;
  }

  function selectVoidBillRow(id) {
    _voidBillSelectedId = id || null;
    var row = null;
    filteredVoidBillRows().some(function (r) {
      if (r.id === id) {
        row = r;
        return true;
      }
      return false;
    });
    if (!row) {
      (_voidBillRows || []).some(function (r) {
        if (r.id === id) {
          row = r;
          return true;
        }
        return false;
      });
    }
    renderVoidBillsList();
    renderVoidBillDetail(row);
  }

  function renderVoidBillsList() {
    var list = g('rptVoidBillList');
    if (!list) return;
    var rows = filteredVoidBillRows();
    updateVoidBillFilterSummary();
    if (!rows.length) {
      var emptyMsg = (_voidBillRows || []).length
        ? tr('report.voidBills.noMatchFilters')
        : tr('report.voidBills.noVoidBills');
      list.innerHTML = '<div style="padding:16px;color:#888;line-height:1.5;">' + esc(emptyMsg) + '</div>';
      renderVoidBillDetail(null);
      return;
    }
    voidBillClampPageIndex(rows.length);
    var start = _voidBillPageIndex * _voidBillPageSize;
    var pageRows = rows.slice(start, start + _voidBillPageSize);
    var th = 'padding:8px 10px;background:#fef2f2;color:#b91c1c;font-size:11px;font-weight:900;border-bottom:2px solid #fecaca;text-align:left;white-space:nowrap;';
    var td = 'padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;vertical-align:top;';
    var html = '<div style="overflow:auto;max-height:420px;"><table style="width:100%;border-collapse:collapse;min-width:860px;"><thead><tr>' +
      '<th style="' + th + '">' + esc(tr('report.voidBills.col.voidTime')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.voidBills.col.patient')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.voidBills.col.doctor')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.voidBills.col.clinic')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.voidBills.col.user')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.voidBills.col.location')) + '</th>' +
      '<th style="' + th + '">' + esc(tr('report.voidBills.col.bill')) + '</th>' +
      '</tr></thead><tbody>';
    pageRows.forEach(function (r) {
      var sel = (_voidBillSelectedId === r.id);
      var bg = sel ? '#fee2e2' : '#fff';
      var pat = (r.patient_name || '—') + (r.patient_no ? ' #' + r.patient_no : '');
      var dr = r.doctor_name || r.doctor_tag || '—';
      var usr = r.user_name || r.voided_by || r.user_id || '—';
      var billLbl = (r.bill && r.bill.bill_date ? r.bill.bill_date + ' ' : '') +
        voidBillFmtMoney(r.bill && r.bill.total);
      html += '<tr data-void-bill-id="' + esc(String(r.id)) + '" style="cursor:pointer;background:' + bg + ';" onclick="REPORT.selectVoidBillRow(this.getAttribute(\'data-void-bill-id\'))">' +
        '<td style="' + td + '">' + esc(auditFmtServerDate(r.voided_at)) + ' ' + esc(auditFmtTime(r.voided_at)) + '</td>' +
        '<td style="' + td + '">' + esc(pat) + '</td>' +
        '<td style="' + td + '">' + esc(dr) + '</td>' +
        '<td style="' + td + '">' + esc(r.clinic || '') + '</td>' +
        '<td style="' + td + '">' + esc(usr) + '</td>' +
        '<td style="' + td + '">' + esc(r.client_host || '') + '</td>' +
        '<td style="' + td + '">' + esc(billLbl) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>' + voidBillPagerHtml(rows.length, pageRows);
    list.innerHTML = html;
    wireVoidBillPager();
    if (!_voidBillSelectedId && pageRows.length) {
      selectVoidBillRow(pageRows[0].id);
    } else {
      var active = null;
      rows.some(function (r) {
        if (r.id === _voidBillSelectedId) {
          active = r;
          return true;
        }
        return false;
      });
      renderVoidBillDetail(active);
    }
  }

  function wireVoidBillSearchInputs() {
    function bind(id, key) {
      var el = g(id);
      if (!el) return;
      el.oninput = function () {
        if (key === 'patient') _voidBillSearchPatient = el.value || '';
        else if (key === 'user') _voidBillSearchUser = el.value || '';
        else if (key === 'doctor') _voidBillSearchDoctor = el.value || '';
        else if (key === 'clinic') _voidBillSearchClinic = el.value || '';
        _voidBillPageIndex = 0;
        renderVoidBillsList();
      };
    }
    bind('rptVoidSearchPatient', 'patient');
    bind('rptVoidSearchUser', 'user');
    bind('rptVoidSearchDoctor', 'doctor');
    bind('rptVoidSearchClinic', 'clinic');
  }

  async function fetchBillsByIdsKeepVoid(billIds) {
    billIds = uniqIds((billIds || []).filter(Boolean));
    if (!billIds.length) return [];
    var selectFull =
      'id,bill_date,bill_type,total,amount_paid,balance,items,notes,status,' +
      'patient_id,patient_no,patient_name,doctor_id,doctor_name,doctor_tag,' +
      'appointment_id,clinic_tag,clinic_code,created_at,voided_at,voided_by';
    var selectNoVoidedBy = selectFull.replace(',voided_by', '');
    var selectNoDoctor =
      'id,bill_date,bill_type,total,amount_paid,balance,items,notes,status,' +
      'patient_id,patient_no,patient_name,appointment_id,clinic_tag,created_at,voided_at';
    var selectLegacy =
      'id,bill_date,bill_type,total,amount_paid,balance,items,notes,status,' +
      'patient_id,patient_no,patient_name,appointment_id,created_at,voided_at';
    var out = [];
    var CHUNK = 80;
    for (var i = 0; i < billIds.length; i += CHUNK) {
      var chunk = billIds.slice(i, i + CHUNK);
      var res = await SB.from('bills').select(selectFull).in('id', chunk);
      if (res.error) {
        var m = String(res.error.message || '').toLowerCase();
        if (m.indexOf('voided_by') >= 0) {
          res = await SB.from('bills').select(selectNoVoidedBy).in('id', chunk);
        }
        if (res.error) {
          m = String(res.error.message || '').toLowerCase();
          if (m.indexOf('doctor_id') >= 0 || m.indexOf('doctor_name') >= 0 || m.indexOf('doctor_tag') >= 0 ||
              m.indexOf('clinic_code') >= 0) {
            res = await SB.from('bills').select(selectNoDoctor).in('id', chunk);
          }
        }
        if (res.error) {
          m = String(res.error.message || '').toLowerCase();
          if (m.indexOf('clinic_tag') >= 0) {
            res = await SB.from('bills').select(selectLegacy).in('id', chunk);
          }
        }
      }
      if (res.error) throw new Error(res.error.message);
      out = out.concat(res.data || []);
    }
    return out;
  }

  async function fetchVoidedBillsFromDb() {
    var selects = [
      'id,bill_date,bill_type,total,amount_paid,balance,items,notes,status,patient_id,patient_no,patient_name,doctor_id,doctor_name,doctor_tag,appointment_id,clinic_tag,clinic_code,created_at,voided_at,voided_by',
      'id,bill_date,bill_type,total,amount_paid,balance,items,notes,status,patient_id,patient_no,patient_name,doctor_id,doctor_name,doctor_tag,appointment_id,clinic_tag,created_at,voided_at',
      'id,bill_date,bill_type,total,amount_paid,balance,items,notes,status,patient_id,patient_no,patient_name,appointment_id,clinic_tag,created_at,voided_at',
      'id,bill_date,bill_type,total,amount_paid,balance,items,notes,status,patient_id,patient_no,patient_name,appointment_id,created_at,voided_at'
    ];
    var si;
    for (si = 0; si < selects.length; si++) {
      var res = await SB.from('bills')
        .select(selects[si])
        .not('voided_at', 'is', null)
        .order('voided_at', { ascending: false })
        .limit(1500);
      if (!res.error) return res.data || [];
      var msg = String(res.error.message || '').toLowerCase();
      if (msg.indexOf('voided_at') >= 0) return [];
    }
    return [];
  }

  async function fetchVoidBillAuditRows() {
    var res = await SB.from('audit_trail')
      .select('*')
      .eq('table_name', 'bills')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (res.error) return [];
    return (res.data || []).filter(auditRowIsBillVoid);
  }

  async function enrichVoidBillPatientNames(rows) {
    var needIds = [];
    (rows || []).forEach(function (row) {
      if (!row || !row.bill || !row.bill.patient_id) return;
      if (!row.patient_name || !row.patient_no) needIds.push(row.bill.patient_id);
    });
    needIds = uniqIds(needIds);
    if (!needIds.length) return;
    var pr = await SB.from('patients')
      .select('id,patient_no,full_name,chinese_name')
      .in('id', needIds);
    if (pr.error) return;
    var pmap = {};
    (pr.data || []).forEach(function (p) {
      if (p && p.id) pmap[p.id] = p;
    });
    rows.forEach(function (row) {
      if (!row || !row.bill || !row.bill.patient_id) return;
      var p = pmap[row.bill.patient_id];
      if (!p) return;
      if (!row.patient_no) row.patient_no = p.patient_no || '';
      if (!row.patient_name) row.patient_name = p.full_name || p.chinese_name || '';
    });
  }

  async function loadVoidBillsManager() {
    _voidBillRows = [];
    _voidBillPageIndex = 0;
    var list = g('rptVoidBillList');
    if (list) list.innerHTML = '<div style="padding:12px;color:#888;">' + esc(tr('report.loading')) + '</div>';

    var _voidPar = await Promise.all([
      fetchVoidBillAuditRows(),
      fetchVoidedBillsFromDb()
    ]);
    var auditRows = _voidPar[0];
    var bills = _voidPar[1];
    var billMap = {};
    bills.forEach(function (b) {
      if (b && b.id) billMap[b.id] = b;
    });

    var auditOnlyIds = [];
    auditRows.forEach(function (a) {
      var rid = String(a.record_id || '').trim();
      if (!rid || billMap[rid]) return;
      auditOnlyIds.push(rid);
    });
    if (auditOnlyIds.length) {
      var extra = await fetchBillsByIdsKeepVoid(uniqIds(auditOnlyIds));
      extra.forEach(function (b) {
        if (!b || !b.id || billMap[b.id]) return;
        billMap[b.id] = b;
        bills.push(b);
      });
    }

    var auditMap = buildVoidBillAuditMap(auditRows, bills);
    bills.forEach(function (b) {
      if (!b || !b.id || b.voided_at) return;
      var a = auditMap[b.id];
      if (a && a.created_at) b.voided_at = a.created_at;
    });

    bills.sort(function (a, b) {
      var ta = a.voided_at ? new Date(a.voided_at).getTime() : 0;
      var tb = b.voided_at ? new Date(b.voided_at).getTime() : 0;
      return tb - ta;
    });

    _voidBillRows = bills.map(function (b) {
      return enrichVoidBillRow(b, auditMap[b.id]);
    });
    await enrichVoidBillPatientNames(_voidBillRows);
    renderVoidBillsList();
  }

  function renderAuditTrailShell() {
    var wrap = g('rptTableWrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div id="rptAuditShell">' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">' +
          '<button type="button" id="rptAuditSubTabVoid" style="' + auditSubTabBtnStyle(_auditSubTab === 'voidBills') + '" ' +
            'onclick="REPORT.switchAuditSubTab(\'voidBills\')">' + esc(tr('report.audit.subTab.voidBills')) + '</button>' +
          '<button type="button" id="rptAuditSubTabLog" style="' + auditSubTabBtnStyle(_auditSubTab !== 'voidBills') + '" ' +
            'onclick="REPORT.switchAuditSubTab(\'log\')">' + esc(tr('report.audit.subTab.log')) + '</button>' +
        '</div>' +
        '<div id="rptAuditLogPanel">' +
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
        '</div>' +
        '<div id="rptAuditVoidPanel" style="display:none;">' +
          '<div class="rpt-void-dock-head">' +
            '<div class="rpt-void-dock-title" data-i18n="report.voidBills.dockTitle"></div>' +
            '<div class="rpt-void-dock-hint" data-i18n="report.voidBills.dockHint"></div>' +
          '</div>' +
          '<div class="rpt-void-filters">' +
            '<div class="rpt-void-search-field">' +
              '<label data-i18n="report.voidBills.searchPatient"></label>' +
              '<input type="search" id="rptVoidSearchPatient" placeholder="" data-i18n-placeholder="report.voidBills.searchPatientPh">' +
            '</div>' +
            '<div class="rpt-void-search-field">' +
              '<label data-i18n="report.voidBills.searchUser"></label>' +
              '<input type="search" id="rptVoidSearchUser" placeholder="" data-i18n-placeholder="report.voidBills.searchUserPh">' +
            '</div>' +
            '<div class="rpt-void-search-field">' +
              '<label data-i18n="report.voidBills.searchDoctor"></label>' +
              '<input type="search" id="rptVoidSearchDoctor" placeholder="" data-i18n-placeholder="report.voidBills.searchDoctorPh">' +
            '</div>' +
            '<div class="rpt-void-search-field">' +
              '<label data-i18n="report.voidBills.searchClinic"></label>' +
              '<input type="search" id="rptVoidSearchClinic" placeholder="" data-i18n-placeholder="report.voidBills.searchClinicPh">' +
            '</div>' +
            '<div class="rpt-void-filter-summary" id="rptVoidBillFilterSummary">—</div>' +
          '</div>' +
          '<div class="rpt-void-grid">' +
            '<div id="rptVoidBillList" class="rpt-void-list">' +
              '<div style="padding:12px;color:#888;">' + esc(tr('report.loading')) + '</div>' +
            '</div>' +
            '<div id="rptVoidBillDetail" class="rpt-void-detail">' +
              '<div style="padding:14px;color:#888;font-size:12px;" data-i18n="report.voidBills.detailPlaceholder"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(wrap);
    updateAuditSubTabUi();
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
    var vp = g('rptVoidSearchPatient');
    var vu = g('rptVoidSearchUser');
    var vd = g('rptVoidSearchDoctor');
    var vc = g('rptVoidSearchClinic');
    if (vp) vp.value = _voidBillSearchPatient || '';
    if (vu) vu.value = _voidBillSearchUser || '';
    if (vd) vd.value = _voidBillSearchDoctor || '';
    if (vc) vc.value = _voidBillSearchClinic || '';
    wireVoidBillSearchInputs();
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
    _auditTrailDataLoaded = false;
    _auditAllRows = [];
    var list = g('rptAuditList');
    if (list && _auditSubTab === 'log') {
      list.innerHTML = '<div style="padding:12px;color:#888;">' + esc(tr('report.loading')) + '</div>';
    }
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
        _auditTrailDataLoaded = true;
        if (_auditSubTab === 'log') renderAuditTrailList();
        return;
      }
      throw new Error(res.error.message || tr('report.error.loadingDataNote'));
    }
    _auditAllRows = res.data || [];
    _auditTrailDataLoaded = true;
    fillAuditFilterSelects();
    if (_auditSubTab === 'log') renderAuditTrailList();
  }

  async function refresh() {
    _rptClearCycleCache();
    // Claim this refresh slot.  Any refresh that starts later will increment
    // _refreshSeq further, making our captured mySeq stale.  We abort before
    // touching the DOM whenever mySeq !== _refreshSeq.
    var mySeq = ++_refreshSeq;
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
      if (_tab !== 'monthlyIncome') showMonthlyIncomeTools(false);

      if (_tab === 'auditTrail') {
        showPatientDirTools(false);
        var auditHint = (_auditSubTab === 'voidBills')
          ? tr('report.hint.voidBills')
          : tr('report.hint.auditTrail');
        setHeader(tr('report.title.auditTrail'), auditHint);
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
        await Promise.all([
          loadAuditTrail(),
          loadVoidBillsManager()
        ]);
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

        // Abort before touching the DOM if a newer refresh has already started.
        if (mySeq !== _refreshSeq) return;
        renderDailySummaryShell();
        await buildDailySummary(mySeq);
        return;
      }

      if (_tab === 'drDaily') {
        showPatientDirTools(false);
        setHeader(tr('report.title.drDaily'), tr('report.hint.drDaily'));
        showChartColumn(false);
        destroyChart();
        setChartNote(tr('report.chart.disabledDrDaily'));
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        if (mySeq !== _refreshSeq) return;
        await buildDrDaily();
        return;
      }

      if (_tab === 'drMonthly') {
        showPatientDirTools(false);
        setHeader(tr('report.title.drMonthly'), tr('report.hint.drMonthly'));
        showChartColumn(false);
        destroyChart();
        setChartNote(tr('report.chart.disabledDrMonthly'));
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = 'none';
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        if (mySeq !== _refreshSeq) return;
        await buildDrMonthly();
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
        if (mySeq !== _refreshSeq) return;
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

      // txStats: bills in date range, income allocated from payment (not bill line prices).
      if (_tab === 'txStats') {
        setHeader(tr('report.title.txStats'), tr('report.hint.txStats'));
        var bills = await loadBills(from, to);
        if (mySeq !== _refreshSeq) return;
        var byItem = {};
        bills.forEach(function (b) {
          var paid = reportBillPaidValue(b);
          if (paid <= 0.005) return;
          accumulateTreatmentStatsMap(byItem, b.items, paid);
        });
        _rows = Object.keys(byItem)
          .map(function (k) {
            return { item: k, qty: byItem[k].frequency, amount: byItem[k].amount_num };
          })
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

      if (_tab === 'monthlyIncome') {
        showMonthlyIncomeTools(true);
        ensureMonthlyIncomeRangeInitialized();
        applyMonthlyIncomeMonthRange(_monthlyIncomeFromMonth, _monthlyIncomeToMonth);
        from = g('rptFrom') ? g('rptFrom').value : from;
        to = g('rptTo') ? g('rptTo').value : to;
        setHeader(tr('report.title.monthlyIncome'), tr('report.hint.monthlyIncome'));
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = '';
      }

      var paymentSlices = await loadReportPaymentSlices(from, to);
      if (mySeq !== _refreshSeq) return;

      if (_tab === 'dailyIncome') {
        setHeader(tr('report.title.dailyIncome'), tr('report.hint.dailyIncome'));
        var dailyKeyFn = function (s) { return s.paid_date; };
        if (isReportAllClinicsSelected()) {
          renderIncomeByClinic(paymentSlices, dailyKeyFn, 'date', tr('report.col.date'));
          return;
        }
        var grouped = groupPaymentSlicesBy(paymentSlices, dailyKeyFn);
        _rows = grouped.map(function (g) { return { date: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'date', label: tr('report.col.date') }, { key: 'total', label: tr('report.col.paidHkd') }], _rows);
        renderChartFromRows('date', 'total');
        return;
      }

      if (_tab === 'weeklyIncome') {
        setHeader(tr('report.title.weeklyIncome'), tr('report.hint.weeklyIncome'));
        var weeklyKeyFn = function (s) { return weekStartFridayIso(s.paid_date); };
        if (isReportAllClinicsSelected()) {
          renderIncomeByClinic(paymentSlices, weeklyKeyFn, 'week_start', tr('report.col.weekStart'));
          return;
        }
        var groupedW = groupPaymentSlicesBy(paymentSlices, weeklyKeyFn);
        _rows = groupedW.map(function (g) { return { week_start: g.key, total: g.value.toFixed(2) }; });
        renderTable([{ key: 'week_start', label: tr('report.col.weekStart') }, { key: 'total', label: tr('report.col.paidHkd') }], _rows);
        renderChartFromRows('week_start', 'total');
        return;
      }

      if (_tab === 'monthlyIncome') {
        if (g('rptPrintTableBtn')) g('rptPrintTableBtn').style.display = '';
        if (g('rptPrintChartBtn')) g('rptPrintChartBtn').style.display = '';
        var miFrom = _monthlyIncomeFromMonth || monthKeyOf(from) || monthKeyOf(todayISO());
        var miTo = _monthlyIncomeToMonth || monthKeyOf(to) || miFrom;
        setHeader(tr('report.title.monthlyIncome'), tr('report.hint.monthlyIncome'));
        renderMonthlyIncomeShell();
        var miBody = g('rptMonthlyIncomeBody');
        if (isReportAllClinicsSelected()) {
          renderMonthlyIncomeByClinic(paymentSlices, miFrom, miTo);
          return;
        }
        var monthlyKeyFn = function (s) { return String(s.paid_date || '').slice(0, 7); };
        var groupedM = groupPaymentSlicesBy(paymentSlices, monthlyKeyFn);
        var totalsMap = {};
        groupedM.forEach(function (row) { totalsMap[row.key] = row.value; });
        _rows = fillMonthlyIncomeRows(totalsMap, miFrom, miTo);
        renderTableInto(miBody || g('rptTableWrap'), [
          { key: 'month', label: tr('report.col.month') },
          { key: 'total', label: tr('report.col.paymentHkd') }
        ], _rows);
        renderChartFromRows('month', 'total');
        return;
      }

      if (_tab === 'payStats') {
        setHeader(tr('report.title.payStats'), tr('report.hint.payStats'));
        var groupedP = groupPaymentSlicesBy(paymentSlices, function (s) { return s.method; });
        _rows = groupedP.filter(function (g) { return !reportPayMethodIsUnsettled(g.key); }).map(function (g) {
          return { method: dispPayMethod(g.key), total: g.value.toFixed(2) };
        });
        renderTable([{ key: 'method', label: tr('report.col.paymentMethod') }, { key: 'total', label: tr('report.col.paidHkd') }], _rows);
        renderChartFromRows('method', 'total');
        return;
      }

      // fallback
      setHeader(tr('report.title.default'), tr('report.hint.default'));
      setChartNote('—');
    } catch (e) {
      if (_tab === 'drDaily') {
        try { await ensureDrDoctorsLoaded(); renderDrDailyShell(); } catch (_) {}
        var drBody = g('rptDrDailyBody');
        if (drBody) {
          drBody.innerHTML = '<div style="padding:14px;color:#dc2626;">' + esc(e.message || tr('report.error.loadingDataNote')) + '</div>';
        }
        setChartNote(tr('report.error.loadingDataNote'));
        return;
      }
      if (_tab === 'drMonthly') {
        try { await ensureDrDoctorsLoaded(); renderDrMonthlyShell(); } catch (_) {}
        var drMoBody = g('rptDrMonthlyBody');
        if (drMoBody) {
          drMoBody.innerHTML = '<div style="padding:14px;color:#dc2626;">' + esc(e.message || tr('report.error.loadingDataNote')) + '</div>';
        }
        setChartNote(tr('report.error.loadingDataNote'));
        return;
      }
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
    if (key === 'auditTrail' && _tab !== 'auditTrail') _auditSubTab = 'voidBills';
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

  function wireReportDateInputsOnce() {
    if (_reportDateInputsWired) return;
    ['rptFrom', 'rptTo'].forEach(function (id) {
      var el = g(id);
      if (!el) return;
      el.addEventListener('change', function () {
        if (!_reportInitialized) return;
        if (_tab === 'dailySummary') {
          syncDailySummaryStateFromReportDates(
            g('rptFrom') ? g('rptFrom').value : '',
            g('rptTo') ? g('rptTo').value : ''
          );
        }
        refresh();
      });
    });
    _reportDateInputsWired = true;
  }

  function exportDailySummaryCsvFormatted() {
    if (_dailySummaryView === 'monthly' && !_dailySummaryDetailMode) {
      exportDailySummaryClinicIncomeExcel();
      return;
    }
    if (_dailySummaryView === 'daily' && !_dailySummaryDetailMode) {
      exportDailySummarySimpleDailyExcel(_dailySummaryIncomeExport);
      return;
    }
    if (_dailySummaryDetailMode) {
      var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : todayISO();
      var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : from;
      var suffix = dailySummaryExportSuffix(from, to);
      exportClinicIncomeDetailExcel(_clinicIncomeDetailExport, 'daily_summary_' + suffix, { includeDoctor: false });
      return;
    }
    _dailySummaryIncomeExport = null;
    _clinicIncomeDetailExport = null;
    if (!_rows || !_rows.length) {
      alert(tr('report.alert.exportNoData'));
      return;
    }
    var from = (g('rptFrom') && g('rptFrom').value) ? g('rptFrom').value : todayISO();
    var to = (g('rptTo') && g('rptTo').value) ? g('rptTo').value : from;
    var range = normalizeReportDateRange(from, to);
    var suffix = dailySummaryExportSuffix(from, to);
    var includeDateCol = range.from !== range.to || _dailySummaryView === 'monthly';
    var mappedRows = (_rows || []).map(function (r) {
      return Object.assign({}, r, {
        bill_total: Number(r.bill_total || 0).toFixed(2),
        bill_paid: Number(r.bill_paid != null ? r.bill_paid : r.amount || 0).toFixed(2),
        bill_balance: Number(r.bill_balance || 0).toFixed(2)
      });
    });
    function withOptionalDateCol(cols) {
      if (!includeDateCol) return cols;
      return [{ key: 'payment_date', label: tr('report.col.date') }].concat(cols);
    }
    downloadCSV('daily_summary_' + suffix, withOptionalDateCol([
      { key: 'patient_no', label: tr('report.csv.patientNo') },
      { key: 'patient_chinese', label: tr('report.csv.patientChinese') },
      { key: 'patient_name', label: tr('report.csv.patientEnglish') },
      { key: 'doctor_display', label: tr('report.csv.doctor') },
      { key: 'payment_method', label: tr('report.csv.paymentMethod') },
      { key: 'bill_paid', label: tr('report.csv.paid') },
      { key: 'remarks', label: tr('report.csv.remarks') }
    ]), mappedRows.map(function (r) {
      return Object.assign({}, r, {
        bill_paid: Number(r.bill_paid != null ? r.bill_paid : r.amount || 0).toFixed(2)
      });
    }));
  }

  function init() {
    if (_reportInitialized) {
      // Already wired — re-opening the section.
      // Just reset to the default daily summary tab so the user always lands on
      // a clean daily view without triggering a second full init cycle.
      switchTab('dailySummary');
      return;
    }
    if (typeof initReportModuleClinic === 'function') initReportModuleClinic();
    refreshReportChartTypeSelect();
    wireReportTabButtons();
    wireReportDateInputsOnce();
    wireMonthlyIncomeToolsOnce();
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
    refreshForWorkingDate: refreshForWorkingDate,
    printTable: printTable,
    printChart: printChart,
    magnifyChart: magnifyChart,
    exportCSV: exportCSV,
    selectAuditRow: selectAuditRow,
    switchAuditSubTab: switchAuditSubTab,
    selectVoidBillRow: selectVoidBillRow,
    voidBillChangePage: voidBillChangePage,
    voidBillJumpToPage: voidBillJumpToPage,
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
      setDateInputs(_dailySummaryDate, _dailySummaryDate);
      if (_tab === 'dailySummary') refresh();
    },
    setDailySummaryMonth: function (yyyyMm) {
      _dailySummaryMonth = String(yyyyMm || '').slice(0, 7) || monthKeyOf(todayISO());
      var base = parseDateToLocal(_dailySummaryMonth + '-01');
      setDateInputs(iso(firstDayOfMonth(base)), iso(lastDayOfMonth(base)));
      if (_tab === 'dailySummary') refresh();
    },
    setDailySummaryAllClinicsLayout: function (mode) {
      _dailySummaryAllClinicsLayout = (mode === 'altogether') ? 'altogether' : 'byDoctor';
      if (_tab === 'dailySummary') refresh();
    },
    setDrDailyDoctor: function (doctorId) {
      _drDailyDoctorId = doctorId ? String(doctorId) : REPORT_ALL_DOCTORS_ID;
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
      _drMonthlyDoctorId = doctorId ? String(doctorId) : REPORT_ALL_DOCTORS_ID;
      if (_tab === 'drMonthly') refresh();
    },
    setDrMonthlyMonth: function (yyyyMm) {
      _drMonthlyMonth = String(yyyyMm || '').slice(0, 7) || monthKeyOf(todayISO());
      if (_tab === 'drMonthly') refresh();
    },
    setMonthlyIncomeRangeFromHeader: function (anchor) {
      setMonthlyIncomeRangeFromHeader(anchor, true);
    },
    exportDailySummaryExcel: exportDailySummaryCsvFormatted,
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
