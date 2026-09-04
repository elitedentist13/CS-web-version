// ════════════════════════════════════════════════════════════════
// CHARTING MODULE  (app-chart.js)
// ════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
var chartPatientId   = null;
var _toothTooltipTn  = null;
var chartPatientName = null;
var chartDate        = null;
var chartRecordId    = null;   // current saved record UUID

// Dental chart state  — key: tooth number (FDI), value: array of conditions
var dentalState = {};

// Perio chart state  — key: "tooth-surface", value: measurement array
var perioState  = {};

// Perio pane view mode: 'table' (data entry) or 'diagram' (pocket chart)
var perioViewMode = 'table';

// Active tool for dental charting
var activeTool  = 'missing';

function chartTr(key) {
    return (typeof t === 'function') ? t(key) : key;
}

function chartTrRepl(key, pairs) {
    var s = chartTr(key);
    if (pairs) {
        Object.keys(pairs).forEach(function(k) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        });
    }
    return s;
}

function chartToolLabel(id) {
    return chartTr('chart.tool.' + id);
}

function chartToolLegend(id) {
    var k = 'chart.toolLegend.' + id;
    var s = chartTr(k);
    return (s === k) ? id : s;
}

function refreshChartForLang() {
    if (!chartPatientId) return;
    var dn = g('dentalChartNotes');
    var pn = g('perioChartNotes');
    if (dn) dentalState.__notes__ = dn.value;
    if (pn) perioState.__notes__ = pn.value;
    var tab = 'dental';
    var stabP = g('stab-perio');
    if (stabP && stabP.classList.contains('active')) tab = 'perio';
    var dateIn = g('chartDateInput');
    if (dateIn && dateIn.value) chartDate = dateIn.value;
    renderChartShell();
    switchChartTab(tab);
    updatePerioSummary();
}

// ── Tool definitions ─────────────────────────────────────────
var DENTAL_TOOLS = [
    { id: 'missing',    color: '#e74c3c' },
    { id: 'caries',     color: '#e67e22' },
    { id: 'filled',     color: '#3498db' },
    { id: 'crown',      color: '#9b59b6' },
    { id: 'rct',        color: '#1abc9c' },
    { id: 'implant',    color: '#2ecc71' },
    { id: 'bridge',     color: '#f39c12' },
    { id: 'fractured',  color: '#e74c3c' },
    { id: 'watch',      color: '#95a5a6' },
    { id: 'veneer',     color: '#16a085' },
    { id: 'sealant',    color: '#8e44ad' },
    { id: 'eraser',     color: '#7f8c8d' }
];

// ── FDI tooth layout ─────────────────────────────────────────
//   Upper: 18-11 | 21-28      Lower: 48-41 | 31-38
var UPPER_RIGHT = [18,17,16,15,14,13,12,11];
var UPPER_LEFT  = [21,22,23,24,25,26,27,28];
var LOWER_RIGHT = [48,47,46,45,44,43,42,41];
var LOWER_LEFT  = [31,32,33,34,35,36,37,38];

/* Primary dentition · same quadrant orientation as permanent
   Letter A-E = tens digit quadrant + units 1-5 mesial→distal midline outward */
var PRIMARY_UPPER_RIGHT = [55, 54, 53, 52, 51];
var PRIMARY_UPPER_LEFT  = [61, 62, 63, 64, 65];
var PRIMARY_LOWER_RIGHT = [85, 84, 83, 82, 81];
var PRIMARY_LOWER_LEFT  = [71, 72, 73, 74, 75];

/** @returns {string} */
function primaryLetter(tn) {
    var map = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' };
    return map[tn % 10] || '';
}

function toothIsPrimary(tn) {
    var d = Math.floor(tn / 10);
    return d >= 5 && d <= 8;
}

function allDentalChartToothNums() {
    return UPPER_RIGHT.concat(UPPER_LEFT,
        LOWER_RIGHT, LOWER_LEFT,
        PRIMARY_UPPER_RIGHT, PRIMARY_UPPER_LEFT,
        PRIMARY_LOWER_RIGHT, PRIMARY_LOWER_LEFT);
}

// Perio surfaces per tooth
var PERIO_SURFACES  = ['B','L'];   // Buccal / Lingual(Palatal)
var PERIO_POSITIONS = ['D','M','C']; // Distal, Mid, Mesial

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
function initChart(patientId, patientName) {
    chartPatientId   = patientId;
    chartPatientName = patientName;
    chartDate        = todayISO();
    chartRecordId    = null;
    dentalState      = {};
    perioState       = {};

    renderChartShell();
    switchChartTab('dental');
    loadChartRecord();
}

// ════════════════════════════════════════════════════════════════
// SHELL
// ════════════════════════════════════════════════════════════════
function renderChartShell() {
    var wrap = g('chartingTabContent');
    if (!wrap) return;

    wrap.innerHTML =
        '<div id="chartShell" style="display:flex;flex-direction:column;' +
        'height:100%;gap:0;">' +

            // ── Sub-tab bar ────────────────────────────────
            '<div style="display:flex;align-items:center;gap:0;' +
            'border-bottom:2px solid #e8edf2;background:#f8fafc;' +
            'padding:0 20px;">' +
                '<button class="chart-subtab active" ' +
                'id="stab-dental" ' +
                'onclick="switchChartTab(\'dental\')">' +
                    chartTr('chart.subtab.dental') +
                '</button>' +
                '<button class="chart-subtab" ' +
                'id="stab-perio" ' +
                'onclick="switchChartTab(\'perio\')">' +
                    chartTr('chart.subtab.perio') +
                '</button>' +
                '<div style="flex:1;"></div>' +

                // Date selector + Save
                '<label style="font-size:12px;color:#888;margin-right:6px;">' +
                chartTr('chart.date') + '</label>' +
                '<input type="date" id="chartDateInput" ' +
                'value="' + chartDate + '" ' +
                'style="padding:4px 8px;border:1px solid #ddd;' +
                'border-radius:6px;font-size:13px;margin-right:10px;">' +
                '<button onclick="loadChartRecord()" ' +
                'style="padding:5px 12px;background:#f0f4ff;' +
                'border:1px solid var(--primary);color:var(--primary);' +
                'border-radius:6px;font-size:12px;cursor:pointer;' +
                'margin-right:6px;">' + chartTr('chart.load') + '</button>' +
                '<button onclick="saveChartRecord()" ' +
                'style="padding:5px 14px;background:var(--primary);' +
                'color:white;border:none;border-radius:6px;' +
                'font-size:12px;font-weight:600;cursor:pointer;">' +
                chartTr('chart.save') + '</button>' +
            '</div>' +

            // ── Pane: Dental ───────────────────────────────
            '<div id="chartPane-dental" style="flex:1;overflow-y:auto;' +
            'padding:16px 20px;">' +
            '</div>' +

            // ── Pane: Perio ────────────────────────────────
            '<div id="chartPane-perio" style="flex:1;overflow-y:auto;' +
            'padding:16px 20px;display:none;">' +
            '</div>' +

        '</div>';

    // Inject CSS once
    injectChartCSS();

    renderDentalPane();
    renderPerioPane();
}

// ════════════════════════════════════════════════════════════════
// CSS INJECTION
// ════════════════════════════════════════════════════════════════
function injectChartCSS() {
    if (g('chartStyleTag')) return;
    var s = document.createElement('style');
    s.id = 'chartStyleTag';
    s.textContent = `

/* Bridge connector overlay (cross-tooth spans) */
.chart-bridge-layer {
    pointer-events: none;
    overflow: visible;
    z-index: 2;
}

/* RCT block letter — ensured top stacking order in markup */
.chart-rct-letter {
    font-family: "Arial Black","Helvetica Neue",Arial,sans-serif;
}

/* ── Sub-tabs ─────────────────────────────── */
.chart-subtab {
    padding: 10px 22px;
    border: none;
    background: transparent;
    font-size: 13px;
    font-weight: 600;
    color: #888;
    cursor: pointer;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    transition: all .2s;
}
.chart-subtab.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
    background: #fff;
}

/* ── Tool palette ────────────────────────── */
.tool-palette {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 12px;
    background: #f8fafc;
    border: 1px solid #e8edf2;
    border-radius: 10px;
    margin-bottom: 14px;
}
.tool-btn {
    padding: 5px 11px;
    border-radius: 20px;
    border: 1.5px solid #ddd;
    background: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all .15s;
    white-space: nowrap;
}
.tool-btn:hover { opacity: .85; transform: translateY(-1px); }
.tool-btn.active {
    color: #fff !important;
    border-color: transparent;
    box-shadow: 0 2px 6px rgba(0,0,0,.18);
}

/* ── Legend ──────────────────────────────── */
.chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    font-size: 11px;
    color: #555;
    margin-bottom: 10px;
}
.legend-item { display: flex; align-items: center; gap: 5px; }
.legend-dot  {
    width: 12px; height: 12px;
    border-radius: 50%;
    display: inline-block;
}

/* ── Odontogram ──────────────────────────── */
.odontogram-wrap {
    background: #fff;
    border: 1px solid #e0e6ed;
    border-radius: 12px;
    padding: 16px;
    overflow-x: auto;
}
.arch-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    color: #aaa;
    text-align: center;
    margin: 4px 0;
    text-transform: uppercase;
}
.tooth-row {
    display: flex;
    justify-content: center;
    gap: 2px;
    margin: 2px 0;
}
.quadrant-divider {
    width: 3px;
    background: #ccc;
    border-radius: 2px;
    margin: 0 6px;
    align-self: stretch;
}

/* ── Tooth cell ──────────────────────────── */
.tooth-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 48px;
}
.tooth-num {
    font-size: 10px;
    color: #888;
    font-weight: 700;
    user-select: none;
}
.tooth-svg-wrap {
    width: 44px;
    height: 44px;
    cursor: pointer;
    border-radius: 4px;
    transition: background .15s;
    position: relative;
}
.tooth-svg-wrap:hover { background: #f0f4ff; }

/* Root area */
.tooth-root-wrap {
    width: 44px;
    height: 28px;
    cursor: pointer;
    display: flex;
    justify-content: center;
}

/* ── Midline ─────────────────────────────── */
.midline {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0;
    height: 20px;
    margin: 2px 0;
}
.midline-seg {
    height: 2px;
    width: 48px;
    background: #cbd5e1;
}
.midline-label {
    font-size: 10px;
    color: #94a3b8;
    padding: 0 8px;
    white-space: nowrap;
    font-style: italic;
}

/* ── Notes area ──────────────────────────── */
.chart-notes-area {
    margin-top: 14px;
    background: #f8fafc;
    border: 1px solid #e8edf2;
    border-radius: 10px;
    padding: 12px 14px;
}
.chart-notes-area textarea {
    width: 100%;
    min-height: 60px;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 8px;
    font-size: 13px;
    resize: vertical;
    box-sizing: border-box;
    font-family: inherit;
}

.primary-tooth-letter {
    display: block;
    font-size: 13px;
    font-weight: 900;
    color: #1d4ed8;
    letter-spacing: 0.03em;
    line-height: 1;
}
.primary-tooth-fdi {
    display: block;
    margin-top: 2px;
    font-size: 9px;
    font-weight: 700;
    color: #94a3b8;
}

/* ── Perio grid ──────────────────────────── */
.perio-section {
    margin-bottom: 24px;
}
.perio-section-title {
    font-size: 13px;
    font-weight: 700;
    color: #555;
    margin-bottom: 8px;
    padding: 4px 10px;
    background: #f0f4ff;
    border-left: 3px solid var(--primary);
    border-radius: 0 6px 6px 0;
}
.perio-table-wrap {
    overflow-x: auto;
    border: 1px solid #e0e6ed;
    border-radius: 10px;
}
.perio-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 11px;
    min-width: 900px;
}
.perio-table th {
    background: #f8fafc;
    padding: 4px 2px;
    text-align: center;
    font-weight: 700;
    color: #555;
    border: 1px solid #e0e6ed;
    font-size: 10px;
    white-space: nowrap;
}
.perio-table td {
    padding: 2px 1px;
    border: 1px solid #e8edf2;
    text-align: center;
    vertical-align: middle;
}
.perio-tooth-cell {
    background: #f0f4ff;
    font-weight: 700;
    color: var(--primary);
    font-size: 11px;
    padding: 3px 4px !important;
    white-space: nowrap;
}
.perio-input {
    width: 28px;
    padding: 2px 1px;
    text-align: center;
    border: 1px solid #ddd;
    border-radius: 3px;
    font-size: 11px;
    background: #fff;
}
.perio-input:focus {
    outline: none;
    border-color: var(--primary);
    background: #f0f4ff;
}
.perio-input.bleeding { background: #fff0f0 !important; }
.perio-input.deep     { background: #fff3e0 !important; color:#e74c3c; font-weight:700; }
.perio-input.shallow  { background: #f0fff4 !important; }

.perio-row-label {
    background: #f8fafc;
    font-size: 10px;
    font-weight: 700;
    color: #888;
    padding: 2px 6px !important;
    white-space: nowrap;
    min-width: 60px;
}
.perio-surface-b { border-top: 2px solid var(--primary) !important; }
.perio-surface-l { border-bottom: 2px solid var(--success) !important; }

/* tooth-tip tooltip */
.tooth-tooltip {
    position: fixed;
    background: rgba(20,20,40,.88);
    color: #fff;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 7px;
    pointer-events: none;
    z-index: 9999;
    max-width: 200px;
    line-height: 1.5;
    display: none;
}
    `;
    document.head.appendChild(s);
}

// ════════════════════════════════════════════════════════════════
// SUB-TAB SWITCH
// ════════════════════════════════════════════════════════════════
function switchChartTab(tab) {
    ['dental','perio'].forEach(function(t) {
        var btn  = g('stab-' + t);
        var pane = g('chartPane-' + t);
        var on   = (t === tab);
        if (btn)  btn.classList.toggle('active', on);
        if (pane) pane.style.display = on ? 'block' : 'none';
    });
}

// ════════════════════════════════════════════════════════════════
// DENTAL CHARTING PANE
// ════════════════════════════════════════════════════════════════
function renderDentalPane() {
    var pane = g('chartPane-dental');
    if (!pane) return;
    pane.innerHTML = '';

    // Tool palette
    var palette = document.createElement('div');
    palette.className = 'tool-palette';
    DENTAL_TOOLS.forEach(function(tool) {
        var btn = document.createElement('button');
        btn.className = 'tool-btn' + (tool.id === activeTool ? ' active' : '');
        btn.textContent = chartToolLabel(tool.id);
        btn.style.color      = tool.color;
        btn.style.borderColor = tool.color;
        if (tool.id === activeTool) btn.style.background = tool.color;
        btn.addEventListener('click', function() {
            activeTool = tool.id;
            renderDentalPane();
        });
        palette.appendChild(btn);
    });
    pane.appendChild(palette);

    // Legend
    var legend = document.createElement('div');
    legend.className = 'chart-legend';
    DENTAL_TOOLS.filter(function(t){ return t.id !== 'eraser'; })
    .forEach(function(tool) {
        var item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML =
            '<span class="legend-dot" ' +
            'style="background:' + tool.color + ';' +
            (tool.id === 'crown' || tool.id === 'watch'
                ? 'border:2px solid ' + tool.color + ';background:#fff;'
                : '') +
            '"></span>' + esc(chartToolLegend(tool.id));
        legend.appendChild(item);
    });
    pane.appendChild(legend);

    // Odontogram wrapper
    var wrap = document.createElement('div');
    wrap.className = 'odontogram-wrap';

    // Upper arch label
    var ul = document.createElement('div');
    ul.className = 'arch-label';
    ul.textContent = chartTr('chart.upperArch');
    wrap.appendChild(ul);

    // Upper row
    wrap.appendChild(buildToothRow(UPPER_RIGHT, UPPER_LEFT, 'upper'));

    // Midline
    wrap.appendChild(buildMidline());

    // Lower row
    wrap.appendChild(buildToothRow(LOWER_RIGHT, LOWER_LEFT, 'lower'));

    // Lower arch label
    var ll = document.createElement('div');
    ll.className = 'arch-label';
    ll.style.marginTop = '4px';
    ll.textContent = chartTr('chart.lowerArch');
    wrap.appendChild(ll);

    pane.appendChild(wrap);

    /* ── Primary dentition odontogram (FDI polygons + quadrant letters A-E) ─ */
    var pwrap = document.createElement('div');
    pwrap.className = 'odontogram-wrap';
    pwrap.style.marginTop = '20px';

    var psubtitle = document.createElement('div');
    psubtitle.className = 'arch-label';
    psubtitle.style.marginBottom = '6px';
    psubtitle.innerHTML = chartTr('chart.primarySubtitleHtml');
    pwrap.appendChild(psubtitle);

    var pud = document.createElement('div');
    pud.className = 'arch-label';
    pud.textContent = chartTr('chart.primaryUpper');
    pwrap.appendChild(pud);

    pwrap.appendChild(
        buildToothRow(PRIMARY_UPPER_RIGHT, PRIMARY_UPPER_LEFT,
            'upper', { primary: true }));

    pwrap.appendChild(buildMidline(chartTr('chart.primaryMidline')));

    pwrap.appendChild(
        buildToothRow(PRIMARY_LOWER_RIGHT, PRIMARY_LOWER_LEFT,
            'lower', { primary: true }));

    var plo = document.createElement('div');
    plo.className = 'arch-label';
    plo.style.marginTop = '6px';
    plo.textContent = chartTr('chart.primaryLower');
    pwrap.appendChild(plo);

    pane.appendChild(pwrap);

    // Notes
    var na = document.createElement('div');
    na.className = 'chart-notes-area';
    na.innerHTML =
        '<label style="font-size:12px;font-weight:700;' +
        'color:#555;display:block;margin-bottom:6px;">' +
        esc(chartTr('chart.dentalNotes')) + '</label>' +
        '<textarea id="dentalChartNotes" placeholder="' +
        esc(chartTr('chart.dentalNotesPh')) + '">' +
        (dentalState.__notes__ || '') +
        '</textarea>';
    pane.appendChild(na);

    // Tooltip div
    if (!g('toothTooltip')) {
        var tip = document.createElement('div');
        tip.id = 'toothTooltip';
        tip.className = 'tooth-tooltip';
        document.body.appendChild(tip);
    }

    scheduleRefreshBridgeConnectors();
}

// ── Build one quadrant pair row ───────────────────────────────
function buildToothRow(rightArr, leftArr, arch, opts) {
    opts = opts || {};
    var row = document.createElement('div');
    row.className = 'tooth-row';
    row.dataset.chartArch = arch;

    // Right quadrant (displayed left of midline)
    rightArr.forEach(function(tn) {
        row.appendChild(buildToothCell(tn, arch, opts));
    });

    // Quadrant divider
    var div = document.createElement('div');
    div.className = 'quadrant-divider';
    row.appendChild(div);

    // Left quadrant
    leftArr.forEach(function(tn) {
        row.appendChild(buildToothCell(tn, arch, opts));
    });

    return row;
}

// ── Build single tooth cell ───────────────────────────────────
function buildToothCell(tn, arch, opts) {
    opts = opts || {};
    var cell = document.createElement('div');
    cell.className = 'tooth-cell' +
        (opts.primary ? ' tooth-cell-primary' : '');
    cell.id = 'tooth-cell-' + tn;

    var numDiv = document.createElement('div');
    numDiv.className = 'tooth-num';
    if (opts.primary) {
        numDiv.innerHTML =
            '<span class="primary-tooth-letter">' + primaryLetter(tn) + '</span>' +
            '<span class="primary-tooth-fdi">' + tn + '</span>';
    } else {
        numDiv.textContent = tn;
    }

    var svgWrap = document.createElement('div');
    svgWrap.className = 'tooth-svg-wrap';
    svgWrap.id = 'tooth-svg-' + tn;

    var svg = buildToothSVG(tn, arch);
    svgWrap.appendChild(svg);

    var rootWrap = document.createElement('div');
    rootWrap.className = 'tooth-root-wrap';
    rootWrap.id = 'tooth-root-' + tn;
    var rootSvg = buildRootSVG(tn, arch);
    rootWrap.appendChild(rootSvg);

    if (arch === 'upper') {
        cell.appendChild(numDiv);
        cell.appendChild(svgWrap);
        cell.appendChild(rootWrap);
    } else {
        cell.appendChild(rootWrap);
        cell.appendChild(svgWrap);
        cell.appendChild(numDiv);
    }

    svgWrap.addEventListener('click', function() {
        applyTool(tn);
    });

    // Tooltip
    svgWrap.addEventListener('mouseenter', function(e) {
        showToothTooltip(tn, e);
    });
    svgWrap.addEventListener('mousemove', function(e) {
        moveTooltip(e);
    });
    svgWrap.addEventListener('mouseleave', function() {
        _toothTooltipTn = null;
        var tip = g('toothTooltip');
        if (tip) tip.style.display = 'none';
    });

    return cell;
}

// ── Bridge multi-unit connectors (horizontal, outside crown polygons) ──
var _bridgeRedrawTimer = null;

function scheduleRefreshBridgeConnectors() {
    clearTimeout(_bridgeRedrawTimer);
    _bridgeRedrawTimer = setTimeout(function() {
        _bridgeRedrawTimer = null;
        refreshBridgeRowConnectors();
    }, 0);
}

function toothHasBridgeMark(tn) {
    var st = dentalState[tn];
    return st && st.indexOf('bridge') >= 0;
}

function toothIsMissingMark(tn) {
    var st = dentalState[tn];
    return st && st.indexOf('missing') >= 0;
}

function refreshBridgeRowConnectors() {
    var pane = g('chartPane-dental');
    if (!pane) return;
    pane.querySelectorAll('.chart-bridge-layer').forEach(function(el) {
        el.remove();
    });

    pane.querySelectorAll('.tooth-row').forEach(function(rowEl) {
        drawBridgeConnectorsOnRow(rowEl);
    });
}

function drawBridgeConnectorsOnRow(rowEl) {
    var arch = rowEl.dataset.chartArch;
    if (!arch) return;

    var cells = rowEl.querySelectorAll('.tooth-cell');
    if (!cells.length) return;

    rowEl.style.position = 'relative';

    var order = [];
    for (var ci = 0; ci < cells.length; ci++) {
        var cid = cells[ci].id.replace('tooth-cell-', '');
        order.push(parseInt(cid, 10));
    }

    var spans = [];
    var idx = 0;
    while (idx < order.length) {
        while (idx < order.length &&
               (!toothHasBridgeMark(order[idx]) ||
                toothIsMissingMark(order[idx]))) {
            idx++;
        }
        if (idx >= order.length) break;

        var end = idx;
        while (
            end + 1 < order.length &&
            toothHasBridgeMark(order[end + 1]) &&
            !toothIsMissingMark(order[end + 1])) {
            end++;
        }
        spans.push({ a: idx, b: end });
        idx = end + 1;
    }

    if (!spans.length) return;

    var rr = rowEl.getBoundingClientRect();
    var ns = 'http://www.w3.org/2000/svg';
    var layer = document.createElementNS(ns, 'svg');
    layer.setAttribute('class', 'chart-bridge-layer');
    layer.setAttribute('xmlns', ns);
    layer.style.position = 'absolute';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.zIndex = '2';
    layer.style.width = '100%';
    layer.style.height = '100%';
    layer.style.pointerEvents = 'none';
    layer.style.overflow = 'visible';
    layer.setAttribute(
        'viewBox',
        '0 0 ' + Math.max(1, Math.round(rr.width)) + ' ' +
            Math.max(1, Math.round(rr.height))
    );
    layer.setAttribute(
        'width',
        String(Math.max(1, Math.round(rr.width)))
    );
    layer.setAttribute(
        'height',
        String(Math.max(1, Math.round(rr.height)))
    );

    var yFrac = arch === 'upper' ? 0.90 : 0.10;

    spans.forEach(function(sp) {
        var yAccum = 0;
        var nSub = 0;
        var k = 0;
        for (k = sp.a; k <= sp.b; k++) {
            var wEl = g('tooth-svg-' + order[k]);
            if (!wEl) continue;
            var bk = wEl.getBoundingClientRect();
            yAccum += bk.top + bk.height * yFrac - rr.top;
            nSub++;
        }
        if (!nSub) return;

        var lineY = yAccum / nSub;

        var wA = g('tooth-svg-' + order[sp.a]);
        var wB = g('tooth-svg-' + order[sp.b]);
        if (!wA || !wB) return;

        var rA = wA.getBoundingClientRect();
        var rB = wB.getBoundingClientRect();

        var x1 = rA.left - rr.left + 2;
        var x2 = rB.right - rr.left - 2;

        if (Math.abs(x2 - x1) < 8) return;

        var line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x1.toFixed(1));
        line.setAttribute('x2', x2.toFixed(1));
        line.setAttribute('y1', lineY.toFixed(1));
        line.setAttribute('y2', lineY.toFixed(1));
        line.setAttribute('stroke', '#d97706');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-linecap', 'round');
        layer.appendChild(line);
    });

    if (layer.childNodes.length) {
        rowEl.appendChild(layer);
    }
}

function surfaceShowsCaries(tn, surf, state) {
    if (dentalState[tn + '-' + surf + '-caries']) return true;
    if (state.indexOf('caries') >= 0) return true;
    return false;
}

/** Dark speckles inside carious fill for grayscale print contrast */
function appendCariesDots(svg, ns, surf) {
    var base = {
        occlusal: [22, 22],
        mesial  : [9, 22],
        distal  : [35, 22],
        buccal  : [22, 10],
        lingual : [22, 34]
    };
    var c = base[surf];
    if (!c) return;

    var offs = [
        [-5, -4],
        [4,  3 ],
        [-2, 5 ],
        [6,  -2],
        [-4, 2 ],
        [2,  -6],
        [0,  4 ]
    ];
    offs.forEach(function(off) {
        var dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', (c[0] + off[0]).toFixed(1));
        dot.setAttribute('cy', (c[1] + off[1]).toFixed(1));
        dot.setAttribute('r', '1.5');
        dot.setAttribute('fill', '#111');
        dot.setAttribute('opacity', '0.88');
        svg.appendChild(dot);
    });
}

function appendRCTBlockLetter(svg, ns) {
    var gRCT = document.createElementNS(ns, 'g');
    gRCT.setAttribute('class', 'chart-rct-mark');

    /* Thin backing plate so R stays legible on busy fills */
    var plate = document.createElementNS(ns, 'rect');
    plate.setAttribute('x', '9');
    plate.setAttribute('y', '8');
    plate.setAttribute('width', '26');
    plate.setAttribute('height', '28');
    plate.setAttribute('rx', '3');
    plate.setAttribute('fill', '#ffffff');
    plate.setAttribute('opacity', '0.78');
    gRCT.appendChild(plate);

    var t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '22');
    t.setAttribute('y', '30');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'chart-rct-letter');
    t.setAttribute('font-weight', '900');
    t.setAttribute('font-size', '22');
    t.setAttribute('fill', '#0f766e');
    t.setAttribute('stroke', '#042f2e');
    t.setAttribute('stroke-width', '1.2');
    t.setAttribute(
        'style',
        'paint-order: stroke fill'
    );
    t.textContent = chartTr('chart.symbol.rct');

    gRCT.appendChild(t);
    svg.appendChild(gRCT);
}

function appendVeneerBuccalBand(svg, ns, arch) {
    /*
     * Buccal = facial: upper rim of upper crowns, bottom rim on lowers.
     * Our diagram keeps buccal wedge at TOP of icon for BOTH arches —
     * for lowers, flip veneer to bottom band anatomically toward facial.
     */
    var vb = document.createElementNS(ns, 'rect');
    vb.setAttribute('rx', '2');
    vb.setAttribute('fill', '#119b7f');
    vb.setAttribute('opacity', '0.72');
    if (arch === 'upper') {
        vb.setAttribute('x', '4');
        vb.setAttribute('y', '2');
        vb.setAttribute('width', '36');
        vb.setAttribute('height', '9');
    } else {
        vb.setAttribute('x', '4');
        vb.setAttribute('y', '33');
        vb.setAttribute('width', '36');
        vb.setAttribute('height', '9');
    }
    svg.appendChild(vb);
}

// ── SVG: crown (5-surface box) ────────────────────────────────
function buildToothSVG(tn, arch) {
    var ns  = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width',  '44');
    svg.setAttribute('height', '44');
    svg.setAttribute('viewBox','0 0 44 44');
    svg.id = 'tsvg-' + tn;

    var state   = dentalState[tn] || [];
    var missing = state.indexOf('missing')   >= 0;
    var crown   = state.indexOf('crown')     >= 0;
    var implant = state.indexOf('implant')   >= 0;

    // Background
    var bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('x', '1'); bg.setAttribute('y', '1');
    bg.setAttribute('width', '42'); bg.setAttribute('height', '42');
    bg.setAttribute('rx', '5');
    bg.setAttribute('fill', missing ? '#fdecea' : crown ? '#f3e5f5' : '#fff');
    bg.setAttribute('stroke', missing ? '#e74c3c' : '#ccd6e0');
    bg.setAttribute('stroke-width', missing ? '2' : '1.2');
    svg.appendChild(bg);

    if (missing) {
        // Big X
        var x1 = document.createElementNS(ns, 'line');
        x1.setAttribute('x1','8'); x1.setAttribute('y1','8');
        x1.setAttribute('x2','36'); x1.setAttribute('y2','36');
        x1.setAttribute('stroke','#e74c3c'); x1.setAttribute('stroke-width','3');
        svg.appendChild(x1);
        var x2 = document.createElementNS(ns, 'line');
        x2.setAttribute('x1','36'); x2.setAttribute('y1','8');
        x2.setAttribute('x2','8');  x2.setAttribute('y2','36');
        x2.setAttribute('stroke','#e74c3c'); x2.setAttribute('stroke-width','3');
        svg.appendChild(x2);
    } else if (implant) {
        // Hexagon symbol
        drawHexagon(svg, ns, 22, 22, 15, '#2ecc71');
        var it = document.createElementNS(ns, 'text');
        it.setAttribute('x','22'); it.setAttribute('y','27');
        it.setAttribute('text-anchor','middle');
        it.setAttribute('font-size','10');
        it.setAttribute('fill','#2ecc71');
        it.setAttribute('font-weight','bold');
        it.textContent = chartTr('chart.symbol.implant');
        svg.appendChild(it);
    } else {
        draw5Surface(svg, ns, tn, state, arch);
    }

    // Crown circle overlay
    if (crown && !missing) {
        var cc = document.createElementNS(ns, 'circle');
        cc.setAttribute('cx','22'); cc.setAttribute('cy','22');
        cc.setAttribute('r','19');
        cc.setAttribute('fill','none');
        cc.setAttribute('stroke','#9b59b6');
        cc.setAttribute('stroke-width','2.5');
        svg.appendChild(cc);
    }

    // Watch dot
    if (state.indexOf('watch') >= 0 && !missing) {
        var wd = document.createElementNS(ns, 'circle');
        wd.setAttribute('cx','38'); wd.setAttribute('cy','6');
        wd.setAttribute('r','4');
        wd.setAttribute('fill','#95a5a6');
        svg.appendChild(wd);
    }

    // Fractured zigzag
    if (state.indexOf('fractured') >= 0 && !missing) {
        var fp = document.createElementNS(ns, 'polyline');
        fp.setAttribute('points','10,1 18,15 12,15 22,43');
        fp.setAttribute('fill','none');
        fp.setAttribute('stroke','#e74c3c');
        fp.setAttribute('stroke-width','2');
        svg.appendChild(fp);
    }

    /*
     * Veneer: buccal (facial) band — upper = top rim, lower = bottom rim
     * (bridge units use row-level connectors; no per-tooth orange bar.)
     */
    if (state.indexOf('veneer') >= 0 && !missing) {
        appendVeneerBuccalBand(svg, ns, arch);
    }

    /* RCT — block letter R last so it stacks above polygons & other marks */
    if (state.indexOf('rct') >= 0 && !missing) {
        appendRCTBlockLetter(svg, ns);
    }

    return svg;
}

// ── 5-surface crown diagram ───────────────────────────────────
function draw5Surface(svg, ns, tn, state, arch) {
    arch = arch || toothArchFromNum(tn);

    // Surfaces: occlusal(center), mesial(left), distal(right),
    //           buccal(top), lingual(bottom)
    var surfaces = {
        occlusal: { points: '16,16 28,16 28,28 16,28', key: 'oc' },
        mesial:   { points: '1,1 16,16 16,28 1,43',    key: 'me' },
        distal:   { points: '43,1 28,16 28,28 43,43',  key: 'di' },
        buccal:   { points: '1,1 43,1 28,16 16,16',    key: 'bu' },
        lingual:  { points: '1,43 43,43 28,28 16,28',  key: 'li' }
    };

    Object.keys(surfaces).forEach(function(surf) {
        var s    = surfaces[surf];
        var col  = getSurfaceColor(tn, surf, state);
        var poly = document.createElementNS(ns, 'polygon');
        poly.setAttribute('points',        s.points);
        poly.setAttribute('fill',          col || '#f4f7fa');
        poly.setAttribute('stroke',        '#bcc9d6');
        poly.setAttribute('stroke-width',  '0.8');
        poly.dataset.surface = surf;
        poly.style.cursor = 'pointer';

        poly.addEventListener('click', function(e) {
            e.stopPropagation();
            applySurfaceTool(tn, surf);
        });
        svg.appendChild(poly);

        if (surfaceShowsCaries(tn, surf, state)) {
            appendCariesDots(svg, ns, surf);
        }
    });

    // Sealant dot in center
    if (state.indexOf('sealant') >= 0) {
        var sd = document.createElementNS(ns, 'circle');
        sd.setAttribute('cx','22'); sd.setAttribute('cy','22');
        sd.setAttribute('r','5');
        sd.setAttribute('fill','#8e44ad'); sd.setAttribute('opacity','.7');
        svg.appendChild(sd);
    }
}

function getSurfaceColor(tn, surf, state) {
    var key = tn + '-' + surf;
    if (dentalState[key + '-caries'])  return '#e67e22';
    if (dentalState[key + '-filled'])  return '#3498db';
    // Whole-tooth conditions
    if (state.indexOf('caries') >= 0)  return '#e67e22';
    if (state.indexOf('filled') >= 0)  return '#3498db';
    return null;
}

// ── Root SVG ─────────────────────────────────────────────────
function buildRootSVG(tn, arch) {
    var ns  = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width',  '44');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox','0 0 44 28');

    var state   = dentalState[tn] || [];
    var missing = state.indexOf('missing') >= 0;
    var rct     = state.indexOf('rct')     >= 0;
    var implant = state.indexOf('implant') >= 0;

    if (missing) return svg;  // no root shown

    // Root shape (1 or 2 roots simplified)
    var isMolar =
        [16,17,18,26,27,28,36,37,38,46,47,48].indexOf(tn) >= 0 ||
        [54,55,64,65,74,75,84,85].indexOf(tn) >= 0;

    if (isMolar) {
        // 2 roots
        var r1 = document.createElementNS(ns, 'ellipse');
        r1.setAttribute('cx','14'); r1.setAttribute('cy', arch==='upper'?'18':'10');
        r1.setAttribute('rx','7');  r1.setAttribute('ry','10');
        r1.setAttribute('fill', rct ? '#e8f8f5' : '#fafbfc');
        r1.setAttribute('stroke','#bcc9d6'); r1.setAttribute('stroke-width','1');
        svg.appendChild(r1);

        var r2 = document.createElementNS(ns, 'ellipse');
        r2.setAttribute('cx','30'); r2.setAttribute('cy', arch==='upper'?'18':'10');
        r2.setAttribute('rx','7');  r2.setAttribute('ry','10');
        r2.setAttribute('fill', rct ? '#e8f8f5' : '#fafbfc');
        r2.setAttribute('stroke','#bcc9d6'); r2.setAttribute('stroke-width','1');
        svg.appendChild(r2);
    } else {
        // 1 root
        var r = document.createElementNS(ns, 'ellipse');
        r.setAttribute('cx','22'); r.setAttribute('cy', arch==='upper'?'18':'10');
        r.setAttribute('rx','9');  r.setAttribute('ry','13');
        r.setAttribute('fill', rct ? '#e8f8f5' : '#fafbfc');
        r.setAttribute('stroke','#bcc9d6'); r.setAttribute('stroke-width','1');
        svg.appendChild(r);
    }

    // Implant post
    if (implant) {
        var ip = document.createElementNS(ns, 'rect');
        ip.setAttribute('x','19'); ip.setAttribute('y','2');
        ip.setAttribute('width','6'); ip.setAttribute('height','24');
        ip.setAttribute('rx','2');
        ip.setAttribute('fill','#2ecc71'); ip.setAttribute('opacity','.6');
        svg.appendChild(ip);
    }

    return svg;
}

// ── Hexagon helper ────────────────────────────────────────────
function drawHexagon(svg, ns, cx, cy, r, color) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
        var ang = Math.PI / 180 * (60 * i - 30);
        pts.push((cx + r * Math.cos(ang)).toFixed(1) + ',' +
                 (cy + r * Math.sin(ang)).toFixed(1));
    }
    var hex = document.createElementNS(ns, 'polygon');
    hex.setAttribute('points', pts.join(' '));
    hex.setAttribute('fill',   'none');
    hex.setAttribute('stroke', color);
    hex.setAttribute('stroke-width', '2');
    svg.appendChild(hex);
}

// ════════════════════════════════════════════════════════════════
// APPLY TOOL  (whole-tooth)
// ════════════════════════════════════════════════════════════════
function applyTool(tn) {
    if (!dentalState[tn]) dentalState[tn] = [];
    var state = dentalState[tn];
    var tool  = activeTool;

    if (tool === 'eraser') {
        dentalState[tn] = [];
        delete dentalState[tn + '_missingReason'];
        // Clear surface-specific states
        ['occlusal','mesial','distal','buccal','lingual'].forEach(function(s) {
            delete dentalState[tn + '-' + s + '-caries'];
            delete dentalState[tn + '-' + s + '-filled'];
        });
    } else if (tool === 'caries' || tool === 'filled' ||
               tool === 'sealant') {
        // Surface tools: applied via individual surface click
        // Whole-tooth click: apply to all surfaces
        var idx = state.indexOf(tool);
        if (idx >= 0) state.splice(idx, 1);
        else           state.push(tool);
    } else {
        var idx2 = state.indexOf(tool);
        if (idx2 >= 0) {
            state.splice(idx2, 1);
            if (tool === 'missing') delete dentalState[tn + '_missingReason'];
        } else {
            state.push(tool);
            if (tool === 'missing') promptMissingToothReason(tn);
        }
    }

    refreshToothSVG(tn);
}

// ── Tooth-loss reason tag (used by Tonetti staging) ──────────
var TOOTH_MISSING_REASONS = ['periodontal', 'caries', 'trauma', 'other'];

function promptMissingToothReason(tn) {
    var existing = g('toothMissingReasonPopup');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var pop = document.createElement('div');
    pop.id = 'toothMissingReasonPopup';
    pop.style.cssText =
        'position:fixed;z-index:99998;background:#fff;border:1px solid #d0dcf8;' +
        'border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.2);padding:14px 16px;' +
        'font-size:12px;left:50%;top:50%;transform:translate(-50%,-50%);min-width:280px;';
    pop.innerHTML =
        '<div style="font-weight:700;margin-bottom:10px;color:#333;">' +
            esc(chartTrRepl('chart.missingReason.title', { TN: String(tn) })) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
        TOOTH_MISSING_REASONS.map(function(r) {
            return '<button type="button" data-reason="' + esc(r) + '" style="' +
                'padding:6px 10px;border:1px solid #d0dcf8;border-radius:6px;' +
                'background:#f0f4ff;color:var(--primary);font-size:11px;font-weight:600;' +
                'cursor:pointer;">' + esc(chartTr('chart.missingReason.' + r)) + '</button>';
        }).join('') +
        '<button type="button" data-reason="" style="padding:6px 10px;border:1px solid #ddd;' +
            'border-radius:6px;background:#f8fafc;color:#888;font-size:11px;cursor:pointer;">' +
            esc(chartTr('chart.missingReason.skip')) + '</button>' +
        '</div>';
    document.body.appendChild(pop);

    Array.prototype.forEach.call(pop.querySelectorAll('button'), function(btn) {
        btn.addEventListener('click', function() {
            var reason = btn.getAttribute('data-reason');
            if (reason) dentalState[tn + '_missingReason'] = reason;
            else delete dentalState[tn + '_missingReason'];
            if (pop.parentNode) pop.parentNode.removeChild(pop);
        });
    });
}

// ════════════════════════════════════════════════════════════════
// APPLY TOOL  (per surface)
// ════════════════════════════════════════════════════════════════
function applySurfaceTool(tn, surf) {
    if (activeTool === 'eraser') {
        delete dentalState[tn + '-' + surf + '-caries'];
        delete dentalState[tn + '-' + surf + '-filled'];
        return refreshToothSVG(tn);
    }
    if (activeTool !== 'caries' && activeTool !== 'filled') {
        // For non-surface tools, apply to whole tooth
        applyTool(tn);
        return;
    }
    var key = tn + '-' + surf + '-' + activeTool;
    if (dentalState[key]) delete dentalState[key];
    else                   dentalState[key] = true;
    refreshToothSVG(tn);
}

// ════════════════════════════════════════════════════════════════
// REFRESH SINGLE TOOTH SVG
// ════════════════════════════════════════════════════════════════
function toothArchFromNum(tn) {
    var up = ([21,22,23,24,25,26,27,28,
        11,12,13,14,15,16,17,18,
        51,52,53,54,55,61,62,63,64,65].indexOf(tn) >= 0);
    return up ? 'upper' : 'lower';
}

function refreshToothSVG(tn) {
    var arch = toothArchFromNum(tn);

    var svgWrap  = g('tooth-svg-'  + tn);
    var rootWrap = g('tooth-root-' + tn);
    if (svgWrap) {
        svgWrap.innerHTML = '';
        svgWrap.appendChild(buildToothSVG(tn, arch));
    }
    if (rootWrap) {
        rootWrap.innerHTML = '';
        rootWrap.appendChild(buildRootSVG(tn, arch));
    }
    scheduleRefreshBridgeConnectors();
}

// ════════════════════════════════════════════════════════════════
// TOOLTIP
// ════════════════════════════════════════════════════════════════
function buildToothTooltipHtml(tn) {
    var state = dentalState[tn] || [];
    if (!state.length) return '';
    var lbl = toothIsPrimary(tn)
        ? '<strong>' + esc(chartTrRepl('chart.tooltip.toothPrimary',
            { N: String(tn), L: primaryLetter(tn) })) + '</strong>'
        : '<strong>' + esc(chartTrRepl('chart.tooltip.tooth', { N: String(tn) })) + '</strong>';
    return lbl + '<br>' + state.map(function (id) {
        return esc(chartToolLegend(id));
    }).join(', ');
}

function showToothTooltip(tn, e) {
    var tip   = g('toothTooltip');
    if (!tip) return;
    var state = dentalState[tn] || [];
    if (!state.length) {
        _toothTooltipTn = null;
        tip.style.display = 'none';
        return;
    }
    _toothTooltipTn = tn;
    tip.innerHTML = buildToothTooltipHtml(tn);
    tip.style.display = 'block';
    moveTooltip(e);
}

function refreshToothTooltipForLang() {
    if (_toothTooltipTn == null) return;
    var tip = g('toothTooltip');
    if (!tip || tip.style.display === 'none') return;
    var html = buildToothTooltipHtml(_toothTooltipTn);
    if (!html) {
        _toothTooltipTn = null;
        tip.style.display = 'none';
        return;
    }
    tip.innerHTML = html;
}

function moveTooltip(e) {
    var tip = g('toothTooltip');
    if (!tip || tip.style.display === 'none') return;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY - 10) + 'px';
}

// ════════════════════════════════════════════════════════════════
// MIDLINE
// ════════════════════════════════════════════════════════════════
function buildMidline(centerLabel) {
    var label = centerLabel || chartTr('chart.midline');
    var mid = document.createElement('div');
    mid.className = 'midline';
    mid.innerHTML =
        '<div class="midline-seg"></div>' +
        '<div class="midline-label">' + esc(label) + '</div>' +
        '<div class="midline-seg"></div>';
    return mid;
}

// ════════════════════════════════════════════════════════════════
// PERIODONTAL CHARTING PANE
// ════════════════════════════════════════════════════════════════
function renderPerioPane() {
    var pane = g('chartPane-perio');
    if (!pane) return;
    pane.innerHTML = '';

    // View toolbar: Enter Data / Chart View toggle + Print
    pane.appendChild(buildPerioViewToolbar());

    if (perioViewMode === 'diagram') {
        // Legend (diagram-specific)
        var dLegend = document.createElement('div');
        dLegend.style.cssText =
            'display:flex;flex-wrap:wrap;gap:8px 20px;font-size:11px;' +
            'color:#555;margin-bottom:12px;padding:8px 12px;' +
            'background:#f8fafc;border:1px solid #e8edf2;border-radius:8px;';
        dLegend.innerHTML = chartTr('chart.perio.diagramLegendHtml');
        pane.appendChild(dLegend);

        // Upper arch diagram
        var upDSec = document.createElement('div');
        upDSec.className = 'perio-section';
        var upDTitle = document.createElement('div');
        upDTitle.className = 'perio-section-title';
        upDTitle.textContent = chartTr('chart.upperMaxillary');
        upDSec.appendChild(upDTitle);
        upDSec.appendChild(buildPerioArchDiagram(
            UPPER_RIGHT.concat(UPPER_LEFT), 'upper'));
        pane.appendChild(upDSec);

        // Lower arch diagram
        var loDSec = document.createElement('div');
        loDSec.className = 'perio-section';
        var loDTitle = document.createElement('div');
        loDTitle.className = 'perio-section-title';
        loDTitle.textContent = chartTr('chart.lowerMandibular');
        loDSec.appendChild(loDTitle);
        loDSec.appendChild(buildPerioArchDiagram(
            LOWER_RIGHT.concat(LOWER_LEFT), 'lower'));
        pane.appendChild(loDSec);
    } else {
        // Legend
        var legend = document.createElement('div');
        legend.style.cssText =
            'display:flex;flex-wrap:wrap;gap:8px 20px;font-size:11px;' +
            'color:#555;margin-bottom:12px;padding:8px 12px;' +
            'background:#f8fafc;border:1px solid #e8edf2;border-radius:8px;';
        legend.innerHTML = chartTr('chart.perio.legendHtml');
        pane.appendChild(legend);

        // Upper teeth section
        var upSec = document.createElement('div');
        upSec.className = 'perio-section';
        var upTitle = document.createElement('div');
        upTitle.className = 'perio-section-title';
        upTitle.textContent = chartTr('chart.upperMaxillary');
        upSec.appendChild(upTitle);
        upSec.appendChild(buildPerioTable(
            UPPER_RIGHT.concat(UPPER_LEFT), 'upper'));
        pane.appendChild(upSec);

        // Lower teeth section
        var loSec = document.createElement('div');
        loSec.className = 'perio-section';
        var loTitle = document.createElement('div');
        loTitle.className = 'perio-section-title';
        loTitle.textContent = chartTr('chart.lowerMandibular');
        loSec.appendChild(loTitle);
        loSec.appendChild(buildPerioTable(
            LOWER_RIGHT.concat(LOWER_LEFT), 'lower'));
        pane.appendChild(loSec);
    }

    // Summary
    pane.appendChild(buildPerioSummary());

    // Tonetti (2018 EFP/AAP) staging & grading — decision-support estimate
    pane.appendChild(buildTonettiPanel());

    // Notes
    var na = document.createElement('div');
    na.className = 'chart-notes-area';
    na.innerHTML =
        '<label style="font-size:12px;font-weight:700;' +
        'color:#555;display:block;margin-bottom:6px;">' +
        esc(chartTr('chart.perioNotes')) + '</label>' +
        '<textarea id="perioChartNotes" ' +
        'placeholder="' + esc(chartTr('chart.perioNotesPh')) + '">' +
        (perioState.__notes__ || '') +
        '</textarea>';
    pane.appendChild(na);
}

// ── View toolbar: Enter Data / Chart View toggle + Print ─────
function buildPerioViewToolbar() {
    var bar = document.createElement('div');
    bar.style.cssText =
        'display:flex;align-items:center;gap:10px;margin-bottom:12px;';

    var toggle = document.createElement('div');
    toggle.style.cssText =
        'display:flex;border:1px solid #d0dcf8;border-radius:8px;' +
        'overflow:hidden;background:#f0f4ff;';

    var btnTable = document.createElement('button');
    btnTable.type = 'button';
    btnTable.textContent = chartTr('chart.perio.viewTable');
    btnTable.style.cssText =
        'padding:6px 14px;border:none;font-size:12px;font-weight:600;' +
        'cursor:pointer;transition:all .15s;' +
        (perioViewMode === 'table'
            ? 'background:var(--primary);color:#fff;'
            : 'background:transparent;color:var(--primary);');
    btnTable.addEventListener('click', function() {
        if (perioViewMode === 'table') return;
        perioViewMode = 'table';
        renderPerioPane();
        updatePerioSummary();
    });

    var btnDiagram = document.createElement('button');
    btnDiagram.type = 'button';
    btnDiagram.textContent = chartTr('chart.perio.viewDiagram');
    btnDiagram.style.cssText =
        'padding:6px 14px;border:none;font-size:12px;font-weight:600;' +
        'cursor:pointer;transition:all .15s;' +
        (perioViewMode === 'diagram'
            ? 'background:var(--primary);color:#fff;'
            : 'background:transparent;color:var(--primary);');
    btnDiagram.addEventListener('click', function() {
        if (perioViewMode === 'diagram') return;
        perioViewMode = 'diagram';
        renderPerioPane();
        updatePerioSummary();
    });

    toggle.appendChild(btnTable);
    toggle.appendChild(btnDiagram);
    bar.appendChild(toggle);

    var spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    var printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.textContent = chartTr('chart.perio.printBtn');
    printBtn.style.cssText =
        'padding:6px 14px;background:#fff;border:1px solid #d0dcf8;' +
        'color:var(--primary);border-radius:8px;font-size:12px;' +
        'font-weight:600;cursor:pointer;';
    printBtn.addEventListener('click', function() { printPerioChart(); });
    bar.appendChild(printBtn);

    var archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.id = 'perioArchiveBtn';
    archiveBtn.textContent = chartTr('chart.perio.archiveBtn');
    archiveBtn.style.cssText =
        'padding:6px 14px;background:#fff;border:1px solid #d0dcf8;' +
        'color:var(--primary);border-radius:8px;font-size:12px;' +
        'font-weight:600;cursor:pointer;';
    archiveBtn.addEventListener('click', function() { archivePerioChartToRecord(); });
    bar.appendChild(archiveBtn);

    return bar;
}

// ── Build perio table for a set of teeth ─────────────────────
function buildPerioTable(teeth, arch) {
    var wrap = document.createElement('div');
    wrap.className = 'perio-table-wrap';

    var table = document.createElement('table');
    table.className = 'perio-table';

    // Row definitions
    var ROWS = [
        { id: 'mob',   labelKey: 'chart.perio.mobility',  surface: null,  type: 'select',
          options: ['0','I','II','III'] },
        { id: 'frc',   labelKey: 'chart.perio.furcation', surface: null,  type: 'select',
          options: ['—','I','II','III'] },
        { id: 'bop_b', labelKey: 'chart.perio.bopB',      surface: 'B',   type: 'bop' },
        { id: 'pd_b',  labelKey: 'chart.perio.pdBuccal',  surface: 'B',   type: 'threeval' },
        { id: 'gm_b',  labelKey: 'chart.perio.gmBuccal',  surface: 'B',   type: 'threeval' },
        { id: 'cal_b', labelKey: 'chart.perio.calBuccal', surface: 'B',   type: 'calc',
          a: 'pd_b', b: 'gm_b' },
        { id: 'bl_b',  labelKey: 'chart.perio.blBuccal',  surface: 'B',   type: 'threeval' },
        { id: 'gm_l',  labelKey: 'chart.perio.gmLingual', surface: 'L',   type: 'threeval' },
        { id: 'pd_l',  labelKey: 'chart.perio.pdLingual', surface: 'L',   type: 'threeval' },
        { id: 'bl_l',  labelKey: 'chart.perio.blLingual', surface: 'L',   type: 'threeval' },
        { id: 'bop_l', labelKey: 'chart.perio.bopL',      surface: 'L',   type: 'bop' },
    ];

    // Header row
    var thead = document.createElement('thead');
    var htr   = document.createElement('tr');
    var th0   = document.createElement('th');
    th0.textContent = chartTr('chart.measurement');
    th0.style.textAlign = 'left';
    th0.style.minWidth  = '90px';
    htr.appendChild(th0);

    teeth.forEach(function(tn) {
        var th = document.createElement('th');
        th.colSpan = 3;
        th.className = 'perio-tooth-cell';
        th.style.borderBottom = '2px solid var(--primary)';
        th.textContent = tn;
        htr.appendChild(th);
    });
    thead.appendChild(htr);

    // Sub-header: D M Me positions
    var sub = document.createElement('tr');
    var sh0 = document.createElement('th');
    sh0.textContent = '';
    sub.appendChild(sh0);
    teeth.forEach(function() {
        ['D','M','Me'].forEach(function(pos) {
            var th = document.createElement('th');
            th.textContent = pos;
            th.style.color = '#999';
            th.style.fontSize = '9px';
            sub.appendChild(th);
        });
    });
    thead.appendChild(sub);
    table.appendChild(thead);

    // Body
    var tbody = document.createElement('tbody');

    ROWS.forEach(function(row) {
        var tr = document.createElement('tr');

        // Row label
        var lbl = document.createElement('td');
        lbl.className = 'perio-row-label';
        if (row.surface === 'B') lbl.classList.add('perio-surface-b');
        if (row.surface === 'L') lbl.classList.add('perio-surface-l');
        lbl.textContent = chartTr(row.labelKey);
        tr.appendChild(lbl);

        teeth.forEach(function(tn) {
            if (row.type === 'threeval' || row.type === 'bop') {
                ['d','m','me'].forEach(function(pos) {
                    var td  = document.createElement('td');
                    var key = tn + '_' + row.id + '_' + pos;

                    if (row.type === 'bop') {
                        var cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.id   = 'perio_' + key;
                        cb.style.cursor = 'pointer';
                        cb.style.width  = '14px';
                        cb.style.height = '14px';
                        cb.checked = !!(perioState[key]);
                        cb.addEventListener('change', function() {
                            perioState[key] = cb.checked;
                            td.style.background = cb.checked ? '#fff0f0' : '';
                            updatePerioSummary();
                        });
                        if (perioState[key]) td.style.background = '#fff0f0';
                        td.appendChild(cb);
                    } else {
                        var inp = document.createElement('input');
                        inp.type        = 'number';
                        inp.className   = 'perio-input';
                        inp.id          = 'perio_' + key;
                        inp.min         = '0';
                        inp.max         = '15';
                        inp.placeholder = '—';
                        inp.value       = perioState[key] != null
                                          ? perioState[key] : '';
                        inp.addEventListener('input', function() {
                            var v = parseInt(inp.value) || 0;
                            perioState[key] = v || null;
                            inp.className = 'perio-input';
                            if (v >= 4)  inp.classList.add('deep');
                            else if (v <= 2 && v > 0) inp.classList.add('shallow');
                            // Auto-calc CAL
                            calcCAL(tn, pos);
                            updatePerioSummary();
                        });
                        // Initial colour
                        var iv = parseInt(inp.value) || 0;
                        if (iv >= 4)      inp.classList.add('deep');
                        else if (iv <= 2 && iv > 0) inp.classList.add('shallow');
                        td.appendChild(inp);
                    }
                    tr.appendChild(td);
                });
            } else if (row.type === 'calc') {
                // CAL = PD − GM  (auto)
                ['d','m','me'].forEach(function(pos) {
                    var td  = document.createElement('td');
                    var key = tn + '_' + row.id + '_' + pos;
                    var sp  = document.createElement('span');
                    sp.id   = 'perio_' + key;
                    sp.style.fontSize    = '11px';
                    sp.style.fontWeight  = '600';
                    sp.style.color       = '#555';
                    sp.textContent = perioState[key] != null
                                     ? perioState[key] : '—';
                    td.appendChild(sp);
                    tr.appendChild(td);
                });
            } else if (row.type === 'select') {
                // Spans 3 columns
                var td = document.createElement('td');
                td.colSpan = 3;
                var key = tn + '_' + row.id;
                var sel = document.createElement('select');
                sel.style.cssText =
                    'width:100%;border:1px solid #ddd;border-radius:3px;' +
                    'font-size:11px;padding:2px;background:#fff;';
                row.options.forEach(function(opt) {
                    var o = document.createElement('option');
                    o.value = opt; o.textContent = opt;
                    sel.appendChild(o);
                });
                sel.value = perioState[key] || row.options[0];
                sel.addEventListener('change', function() {
                    perioState[key] = sel.value;
                });
                td.appendChild(sel);
                tr.appendChild(td);
            }
        });
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

// ── Auto-calculate CAL ────────────────────────────────────────
function calcCAL(tn, pos) {
    ['b','l'].forEach(function(surf) {
        var pdKey  = 'perio_' + tn + '_pd_'  + surf + '_' + pos;
        var gmKey  = 'perio_' + tn + '_gm_'  + surf + '_' + pos;
        var calKey = 'perio_' + tn + '_cal_' + surf + '_' + pos;

        var pdEl = g(pdKey);
        var gmEl = g(gmKey);
        var calEl = g(calKey);
        if (!pdEl || !gmEl || !calEl) return;

        var pd = parseInt(pdEl.value) || 0;
        var gm = parseInt(gmEl.value) || 0;
        var cal = pd - gm;
        perioState[tn + '_cal_' + surf + '_' + pos] = cal;
        calEl.textContent = cal !== 0 ? cal : '—';
        calEl.style.color = cal > 3 ? '#e74c3c' : '#555';
    });
}

// ── Perio summary bar ─────────────────────────────────────────
function buildPerioSummary() {
    var wrap = document.createElement('div');
    wrap.id = 'perioSummary';
    wrap.style.cssText =
        'display:flex;gap:16px;flex-wrap:wrap;padding:10px 14px;' +
        'background:#f0f4ff;border:1px solid #d0dcf8;' +
        'border-radius:10px;margin:12px 0;font-size:12px;';
    wrap.innerHTML = chartTr('chart.perio.summaryHtml');
    return wrap;
}

function updatePerioSummary() {
    var bopCount  = 0;
    var deepCount = 0;
    var pdVals    = [];

    Object.keys(perioState).forEach(function(k) {
        if (k.indexOf('_bop_') >= 0 && perioState[k]) bopCount++;
        if ((k.indexOf('_pd_b_') >= 0 || k.indexOf('_pd_l_') >= 0) &&
             perioState[k]) {
            var v = parseInt(perioState[k]) || 0;
            if (v > 0) {
                pdVals.push(v);
                if (v >= 4) deepCount++;
            }
        }
    });

    var summBOP  = g('summBOP');
    var summDeep = g('summDeep');
    var summAvg  = g('summAvgPD');
    var summMax  = g('summMaxPD');

    if (summBOP)  summBOP.textContent  = bopCount;
    if (summDeep) summDeep.textContent = deepCount;
    if (summAvg)  summAvg.textContent  =
        pdVals.length
            ? (pdVals.reduce(function(a,b){return a+b;},0) / pdVals.length)
              .toFixed(1)
            : '—';
    if (summMax)  summMax.textContent  =
        pdVals.length ? Math.max.apply(null, pdVals) : '—';
}

// ════════════════════════════════════════════════════════════════
// POCKET DIAGRAM  (periodontalchart-online.com-style visualisation)
// ════════════════════════════════════════════════════════════════
// Layout constants (all in SVG user units == px at scale 1)
var PD_SITE_W     = 22;   // width per D/M/Me site column
var PD_TOOTH_GAP  = 3;    // gap between adjacent tooth groups
var PD_MID_GAP    = 14;   // extra gap inserted at the midline (after 8 teeth)
var PD_MM_PX      = 8;    // px per millimetre of depth
var PD_MAX_MM     = 14;   // vertical scale range shown (0–14mm)
var PD_AXIS_W     = 20;   // left gutter reserved for the mm scale
var PD_LABEL_H    = 14;   // height of the "Buccal" / "Lingual" caption row
var PD_MID_ROW_H  = 40;   // height of the tooth-number / mob / furcation row
var PD_STRIP_H    = PD_MAX_MM * PD_MM_PX;

/** x position (left edge) of tooth at index i within its arch's 16-tooth row. */
function pdToothX(i) {
    var x = i * (3 * PD_SITE_W + PD_TOOTH_GAP);
    if (i >= 8) x += PD_MID_GAP;
    return x;
}

/** x centre of one D/M/Me site column (s = 0,1,2) for tooth index i. */
function pdSiteX(i, s) {
    return pdToothX(i) + s * PD_SITE_W + PD_SITE_W / 2;
}

/** Reads one perio value (gm/pd) for tooth+surface+position, default 0. */
function pdGetSiteVal(tn, surface, pos, field) {
    var v = perioState[tn + '_' + field + '_' + surface + '_' + pos];
    return (v === null || v === undefined || v === '') ? 0 : (parseFloat(v) || 0);
}

function pdGetBop(tn, surface, pos) {
    return !!perioState[tn + '_bop_' + surface + '_' + pos];
}

/** Builds the {x, gm, al, bop} site-point series for one arch + surface. */
function pdBuildPoints(teeth, surface) {
    var pts = [];
    teeth.forEach(function(tn, i) {
        ['d', 'm', 'me'].forEach(function(pos, s) {
            var gm = pdGetSiteVal(tn, surface, pos, 'gm');
            var pd = pdGetSiteVal(tn, surface, pos, 'pd');
            pts.push({
                x:   pdSiteX(i, s),
                gm:  gm,
                al:  gm + pd,
                bl:  pdGetSiteVal(tn, surface, pos, 'bl'),
                bop: pdGetBop(tn, surface, pos)
            });
        });
    });
    return pts;
}

function pdPolylinePoints(pts, field) {
    return pts.map(function(p) {
        return (PD_AXIS_W + p.x).toFixed(1) + ',' + (p[field] * PD_MM_PX).toFixed(1);
    }).join(' ');
}

/** Closed polygon between the GM line (forward) and AL line (reversed) = pocket. */
function pdPocketPath(pts) {
    if (!pts.length) return '';
    var fwd = pts.map(function(p) {
        return (PD_AXIS_W + p.x).toFixed(1) + ' ' + (p.gm * PD_MM_PX).toFixed(1);
    }).join(' L ');
    var bwd = pts.slice().reverse().map(function(p) {
        return (PD_AXIS_W + p.x).toFixed(1) + ' ' + (p.al * PD_MM_PX).toFixed(1);
    }).join(' L ');
    return 'M ' + fwd + ' L ' + bwd + ' Z';
}

/** SVG markup for one horizontal strip (buccal or lingual) — local coord space, y=0 at top. */
function pdStripSVG(pts, width) {
    var grid = '';
    for (var mm = 0; mm <= PD_MAX_MM; mm += 2) {
        var y = mm * PD_MM_PX;
        grid += '<line x1="' + PD_AXIS_W + '" y1="' + y + '" x2="' + (width - 2) +
            '" y2="' + y + '" stroke="#eef1f6" stroke-width="1"/>' +
            '<text x="1" y="' + (y + 3) + '" font-size="8" fill="#aaa">' + mm + '</text>';
    }
    var bop = pts.filter(function(p) { return p.bop; }).map(function(p) {
        return '<circle cx="' + (PD_AXIS_W + p.x).toFixed(1) + '" cy="' +
            (p.al * PD_MM_PX).toFixed(1) + '" r="2.6" fill="#e11d48" stroke="#fff" stroke-width="0.6"/>';
    }).join('');
    var hasBoneData = pts.some(function(p) { return p.bl > 0; });
    var boneLine = hasBoneData
        ? '<polyline points="' + pdPolylinePoints(pts, 'bl') +
          '" fill="none" stroke="#374151" stroke-width="1.3" stroke-dasharray="4,3"/>'
        : '';
    return grid +
        '<path d="' + pdPocketPath(pts) + '" fill="#bfe3ff" fill-opacity="0.55" stroke="none"/>' +
        '<polyline points="' + pdPolylinePoints(pts, 'gm') + '" fill="none" stroke="#dc2626" stroke-width="1.6"/>' +
        '<polyline points="' + pdPolylinePoints(pts, 'al') + '" fill="none" stroke="#2563eb" stroke-width="1.6"/>' +
        boneLine +
        bop;
}

/** SVG markup for the tooth-number / mobility / furcation row between the two strips. */
function pdMidRowSVG(teeth) {
    var out = '';
    teeth.forEach(function(tn, i) {
        var cx  = PD_AXIS_W + pdToothX(i) + 1.5 * PD_SITE_W;
        var mob = perioState[tn + '_mob'];
        var frc = perioState[tn + '_frc'];
        var hasMob = mob && mob !== '0';
        out += '<text x="' + cx + '" y="16" font-size="11" font-weight="700" ' +
            'text-anchor="middle" fill="#1d4ed8">' + tn + '</text>';
        if (hasMob) {
            out += '<text x="' + cx + '" y="28" font-size="8.5" text-anchor="middle" ' +
                'fill="#7c3aed">M:' + esc(String(mob)) + '</text>';
        }
        if (frc && frc !== '—' && frc !== '-') {
            out += '<text x="' + cx + '" y="' + (hasMob ? 38 : 28) + '" font-size="8.5" ' +
                'text-anchor="middle" fill="#b45309">F:' + esc(String(frc)) + '</text>';
        }
    });
    var midX = PD_AXIS_W + pdToothX(8) - PD_MID_GAP / 2;
    out += '<line x1="' + midX + '" y1="2" x2="' + midX + '" y2="' + (PD_MID_ROW_H - 2) +
        '" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="2,2"/>';
    return out;
}

/** Full pocket-diagram SVG markup for one arch: Buccal strip / tooth row / Lingual strip. */
function pdBuildArchDiagramSVG(teeth) {
    var width = PD_AXIS_W + pdToothX(teeth.length - 1) + 3 * PD_SITE_W + 8;
    var totalH = PD_LABEL_H + PD_STRIP_H + PD_MID_ROW_H + PD_LABEL_H + PD_STRIP_H;

    var buccalPts  = pdBuildPoints(teeth, 'b');
    var lingualPts = pdBuildPoints(teeth, 'l');

    var yBuccalStrip  = PD_LABEL_H;
    var yMidRow       = yBuccalStrip + PD_STRIP_H;
    var yLingualLabel = yMidRow + PD_MID_ROW_H;
    var yLingualStrip = yLingualLabel + PD_LABEL_H;

    return '<svg viewBox="0 0 ' + width + ' ' + totalH + '" width="' + width +
        '" height="' + totalH + '" style="display:block;background:#fff;">' +
        '<text x="1" y="' + (PD_LABEL_H - 3) + '" font-size="9" font-weight="700" ' +
            'fill="#64748b">' + esc(chartTr('chart.perio.diagramBuccal')) + '</text>' +
        '<g transform="translate(0,' + yBuccalStrip + ')">' + pdStripSVG(buccalPts, width) + '</g>' +
        '<g transform="translate(0,' + yMidRow + ')">' + pdMidRowSVG(teeth) + '</g>' +
        '<text x="1" y="' + (yLingualLabel + PD_LABEL_H - 3) + '" font-size="9" font-weight="700" ' +
            'fill="#64748b">' + esc(chartTr('chart.perio.diagramLingual')) + '</text>' +
        '<g transform="translate(0,' + yLingualStrip + ')">' + pdStripSVG(lingualPts, width) + '</g>' +
        '</svg>';
}

/** DOM wrapper (horizontally scrollable) around one arch's pocket-diagram SVG. */
function buildPerioArchDiagram(teeth, arch) {
    var wrap = document.createElement('div');
    wrap.className = 'perio-diagram-wrap';
    wrap.style.cssText =
        'overflow-x:auto;border:1px solid #e0e6ed;border-radius:10px;' +
        'background:#fff;padding:6px 4px;';
    wrap.innerHTML = pdBuildArchDiagramSVG(teeth);
    return wrap;
}

// ════════════════════════════════════════════════════════════════
// TONETTI (2018 EFP/AAP) STAGING & GRADING — decision-support only
// ════════════════════════════════════════════════════════════════
// Approximate average root lengths (mm) per FDI tooth number, used only
// to convert an entered bone-loss mm value into a % of root length.
// These are textbook averages, not patient-specific measurements.
var TONETTI_ROOT_LENGTH_MM = {
    11:13, 21:13, 12:13, 22:13, 13:17, 23:17, 14:14, 24:14, 15:14, 25:14,
    16:13, 26:13, 17:11, 27:11, 18:11, 28:11,
    41:12.5, 31:12.5, 42:14, 32:14, 43:16, 33:16, 44:14, 34:14, 45:15, 35:15,
    46:13, 36:13, 47:11, 37:11, 48:11, 38:11
};

function tonettiRootLengthMm(tn) {
    return TONETTI_ROOT_LENGTH_MM[tn] || 13;
}

/** Best-effort patient age (years) from the consultation module, if it's showing the same patient. */
function chartPatientAgeYears() {
    try {
        if (perioState && perioState.__tonettiAgeOverride) {
            var ov = parseInt(perioState.__tonettiAgeOverride, 10);
            if (ov > 0) return ov;
        }
        if (typeof conPatientData !== 'undefined' && conPatientData &&
            String(conPatientData.id || '') === String(chartPatientId || '') &&
            typeof patientAgeYears === 'function') {
            return patientAgeYears(conPatientData.dob);
        }
    } catch (e) {}
    return null;
}

/**
 * Simplified periodontal Stage (I-IV) / Grade (A-C) estimate per the 2018
 * EFP/AAP classification, based on data already captured in this chart.
 * This is a decision-support ESTIMATE only — always confirm clinically.
 */
function computeTonettiAssessment() {
    var maxCAL = 0;
    var maxBoneLossPct = 0;
    var allPerioTeeth = UPPER_RIGHT.concat(UPPER_LEFT, LOWER_RIGHT, LOWER_LEFT);

    allPerioTeeth.forEach(function(tn) {
        ['b', 'l'].forEach(function(surface) {
            ['d', 'm', 'me'].forEach(function(pos) {
                var gm = pdGetSiteVal(tn, surface, pos, 'gm');
                var pd = pdGetSiteVal(tn, surface, pos, 'pd');
                var bl = pdGetSiteVal(tn, surface, pos, 'bl');
                var cal = gm + pd;
                if (cal > maxCAL) maxCAL = cal;
                if (bl > 0) {
                    var pct = (bl / tonettiRootLengthMm(tn)) * 100;
                    if (pct > maxBoneLossPct) maxBoneLossPct = pct;
                }
            });
        });
    });

    var teethLostToPerio = 0;
    allDentalChartToothNums().forEach(function(tn) {
        var st = dentalState[tn];
        if (st && st.indexOf('missing') >= 0 &&
            dentalState[tn + '_missingReason'] === 'periodontal') {
            teethLostToPerio++;
        }
    });

    // Severity/extent staging (simplified — greater of CAL or RBL decides the band)
    var stage = null;
    if (maxCAL > 0 || maxBoneLossPct > 0) {
        stage = 'I';
        if (maxCAL >= 3 || (maxBoneLossPct >= 15 && maxBoneLossPct < 33)) stage = 'II';
        if (maxCAL >= 5 || maxBoneLossPct >= 33) stage = 'III';
        if (maxBoneLossPct >= 66 || teethLostToPerio >= 5) stage = 'IV';
    }

    // Grading from % bone loss at the worst site divided by age (rate of progression)
    var age  = chartPatientAgeYears();
    var rate = null;
    var grade = null;
    if (age && age > 0 && maxBoneLossPct > 0) {
        rate = maxBoneLossPct / age;
        grade = rate < 0.25 ? 'A' : (rate <= 1.0 ? 'B' : 'C');
    }

    var stageOverride = perioState.__tonettiStageOverride || '';
    var gradeOverride = perioState.__tonettiGradeOverride || '';

    return {
        maxCAL: maxCAL,
        maxBoneLossPct: maxBoneLossPct,
        teethLostToPerio: teethLostToPerio,
        age: age,
        rate: rate,
        autoStage: stage,
        autoGrade: grade,
        finalStage: stageOverride || stage,
        finalGrade: gradeOverride || grade,
        stageOverridden: !!stageOverride,
        gradeOverridden: !!gradeOverride
    };
}

/** Builds the Tonetti staging/grading panel DOM node for the perio pane. */
function buildTonettiPanel() {
    var a = computeTonettiAssessment();
    var wrap = document.createElement('div');
    wrap.id = 'tonettiPanel';
    wrap.style.cssText =
        'margin:14px 0;padding:14px 16px;background:#fef9f0;' +
        'border:1px solid #f3d9a8;border-radius:10px;font-size:12px;color:#333;';

    var stageOptions = ['', 'I', 'II', 'III', 'IV'];
    var gradeOptions  = ['', 'A', 'B', 'C'];

    function optionsHtml(opts, current, autoLabel) {
        return opts.map(function(o) {
            var label = o === '' ? autoLabel : o;
            return '<option value="' + esc(o) + '"' +
                (o === current ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('');
    }

    wrap.innerHTML =
        '<div style="font-weight:700;font-size:13px;margin-bottom:4px;color:#92610e;">' +
            esc(chartTr('chart.tonetti.title')) + '</div>' +
        '<div style="font-size:11px;color:#8a6d3b;font-style:italic;margin-bottom:10px;">' +
            esc(chartTr('chart.tonetti.disclaimer')) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:14px 22px;margin-bottom:10px;">' +
            '<span>' + esc(chartTr('chart.tonetti.maxCal')) + ': <strong>' +
                (a.maxCAL > 0 ? a.maxCAL.toFixed(0) + ' mm' : '—') + '</strong></span>' +
            '<span>' + esc(chartTr('chart.tonetti.maxBoneLoss')) + ': <strong>' +
                (a.maxBoneLossPct > 0 ? a.maxBoneLossPct.toFixed(0) + '%' : '—') + '</strong></span>' +
            '<span>' + esc(chartTr('chart.tonetti.teethLost')) + ': <strong>' + a.teethLostToPerio + '</strong></span>' +
            '<span>' + esc(chartTr('chart.tonetti.age')) + ': ' +
                '<input type="number" id="tonettiAgeInput" min="1" max="120" placeholder="' +
                esc(chartTr('chart.tonetti.ageUnknownPh')) + '" value="' +
                (perioState.__tonettiAgeOverride || '') + '" style="width:52px;padding:2px 4px;' +
                'border:1px solid #ddd;border-radius:4px;font-size:11px;"> ' +
                (a.age && !perioState.__tonettiAgeOverride
                    ? '<span style="color:#999;">(' + esc(chartTr('chart.tonetti.fromRecord')) + ')</span>' : '') +
            '</span>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:18px;align-items:center;">' +
            '<label>' + esc(chartTr('chart.tonetti.stage')) + ': ' +
                '<select id="tonettiStageSelect" style="padding:3px 6px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:12px;margin-left:4px;">' +
                optionsHtml(stageOptions, perioState.__tonettiStageOverride || '',
                    chartTr('chart.tonetti.auto') + (a.autoStage ? ' (' + a.autoStage + ')' : ' (—)')) +
                '</select></label>' +
            '<label>' + esc(chartTr('chart.tonetti.grade')) + ': ' +
                '<select id="tonettiGradeSelect" style="padding:3px 6px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:12px;margin-left:4px;">' +
                optionsHtml(gradeOptions, perioState.__tonettiGradeOverride || '',
                    chartTr('chart.tonetti.auto') + (a.autoGrade ? ' (' + a.autoGrade + ')' : ' (—)')) +
                '</select></label>' +
            '<span style="font-weight:700;color:#92610e;">' +
                esc(chartTr('chart.tonetti.result')) + ': ' +
                (a.finalStage || '—') + ' / ' + (a.finalGrade || '—') +
            '</span>' +
        '</div>';

    var ageInput = wrap.querySelector('#tonettiAgeInput');
    if (ageInput) {
        ageInput.addEventListener('change', function() {
            var v = parseInt(ageInput.value, 10);
            if (v > 0) perioState.__tonettiAgeOverride = v;
            else delete perioState.__tonettiAgeOverride;
            refreshTonettiPanel();
        });
    }
    var stageSel = wrap.querySelector('#tonettiStageSelect');
    if (stageSel) {
        stageSel.addEventListener('change', function() {
            if (stageSel.value) perioState.__tonettiStageOverride = stageSel.value;
            else delete perioState.__tonettiStageOverride;
            refreshTonettiPanel();
        });
    }
    var gradeSel = wrap.querySelector('#tonettiGradeSelect');
    if (gradeSel) {
        gradeSel.addEventListener('change', function() {
            if (gradeSel.value) perioState.__tonettiGradeOverride = gradeSel.value;
            else delete perioState.__tonettiGradeOverride;
            refreshTonettiPanel();
        });
    }

    return wrap;
}

/** Re-renders just the Tonetti panel in place (avoids losing focus in the wider pane on every keystroke). */
function refreshTonettiPanel() {
    var old = g('tonettiPanel');
    if (!old || !old.parentNode) return;
    var fresh = buildTonettiPanel();
    old.parentNode.replaceChild(fresh, old);
}

// ── Print the pocket diagram (both arches) in a dedicated popup ─
function printPerioChart() {
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;

    var dateEl = g('chartDateInput');
    var date   = dateEl ? dateEl.value : chartDate;
    var isZh   = typeof printUiLangIsChinese === 'function' && printUiLangIsChinese();
    var clinicName = typeof currentActiveClinicLabelForPrinting === 'function'
        ? currentActiveClinicLabelForPrinting(isZh) : '';
    var patientName = chartPatientName || '';

    var upperSVG = pdBuildArchDiagramSVG(UPPER_RIGHT.concat(UPPER_LEFT));
    var lowerSVG = pdBuildArchDiagramSVG(LOWER_RIGHT.concat(LOWER_LEFT));
    var tonetti  = computeTonettiAssessment();

    var popup = window.open('', '_blank',
        'width=1100,height=780,left=60,top=32,toolbar=0,menubar=0,scrollbars=1,resizable=1');
    if (!popup) {
        alert(chartTr('chart.perio.alertPopupBlocked'));
        return;
    }

    var css =
        '* { margin:0; padding:0; box-sizing:border-box; }' +
        '@page { size:A4 landscape; margin:10mm; }' +
        'html,body { font-family:"Segoe UI",system-ui,Arial,sans-serif; color:#111; padding:14px; background:#fff; }' +
        'h1 { font-size:16px; margin-bottom:2px; }' +
        '.meta { font-size:11px; color:#555; margin-bottom:14px; }' +
        '.arch-block { margin-bottom:20px; }' +
        '.arch-title { font-size:12px; font-weight:700; color:#555; margin-bottom:4px; }' +
        '.legend { font-size:10px; color:#555; margin-top:10px; display:flex; flex-wrap:wrap; gap:6px 16px; }' +
        '.tonetti { font-size:10px; color:#92610e; margin-top:10px; font-style:italic; }' +
        '@media print { .arch-block { page-break-inside:avoid; } }';

    popup.document.write(
        '<!DOCTYPE html><html lang="' + (isZh ? 'zh-HK' : 'en') + '"><head><meta charset="UTF-8">' +
        (typeof appCjkFontLinkHtml === 'function' ? appCjkFontLinkHtml() : '') +
        '<title>' + esc(chartTr('chart.perio.printTitle')) + '</title>' +
        '<style>' + css + '</style></head><body>' +
        '<h1>' + esc(chartTr('chart.perio.printTitle')) + '</h1>' +
        '<div class="meta">' +
            esc(patientName) + (clinicName ? ' &middot; ' + esc(clinicName) : '') +
            ' &middot; ' + esc(chartTr('chart.date')) + ': ' + esc(date) +
        '</div>' +
        '<div class="arch-block"><div class="arch-title">' + esc(chartTr('chart.upperMaxillary')) +
            '</div>' + upperSVG + '</div>' +
        '<div class="arch-block"><div class="arch-title">' + esc(chartTr('chart.lowerMandibular')) +
            '</div>' + lowerSVG + '</div>' +
        '<div class="legend">' + chartTr('chart.perio.diagramLegendHtml') + '</div>' +
        '<div class="tonetti">' + esc(chartTr('chart.tonetti.title')) + ': ' +
            (tonetti.finalStage || '—') + ' / ' + (tonetti.finalGrade || '—') +
            ' &mdash; ' + esc(chartTr('chart.tonetti.disclaimer')) +
        '</div>' +
        '<script>' +
        (typeof printPopupAutoCloseInlineScript === 'function' ? printPopupAutoCloseInlineScript() : '') +
        'window.onload=function(){try{window.focus();}catch(e){}' +
        'setTimeout(function(){try{window.print();}catch(e2){if(typeof __ppClose==="function")__ppClose();}},350);};' +
        '<\/script>' +
        '</body></html>'
    );
    popup.document.close();
    if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(popup);
    try { popup.focus(); } catch (ePrintFocus) {}
}

// ── Archive the pocket diagram as a PDF into the patient's permanent record ─
function archivePerioChartToRecord() {
    if (!chartPatientId) { alert(chartTr('chart.alert.noPatient')); return; }
    if (typeof PDFEDITOR === 'undefined' || typeof PDFEDITOR.exportFormsHtmlToPatient !== 'function') {
        alert(chartTr('chart.perio.archiveUnavailable'));
        return;
    }

    var btn = g('perioArchiveBtn');
    var origLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = chartTr('chart.perio.archiving'); }

    var dateEl = g('chartDateInput');
    var date   = dateEl ? dateEl.value : chartDate;
    var isZh   = typeof printUiLangIsChinese === 'function' && printUiLangIsChinese();
    var clinicName = typeof currentActiveClinicLabelForPrinting === 'function'
        ? currentActiveClinicLabelForPrinting(isZh) : '';
    var patientName = chartPatientName || '';
    var tonetti = computeTonettiAssessment();

    var upperSVG = pdBuildArchDiagramSVG(UPPER_RIGHT.concat(UPPER_LEFT));
    var lowerSVG = pdBuildArchDiagramSVG(LOWER_RIGHT.concat(LOWER_LEFT));

    var bodyHtml =
        '<h2 style="margin:0 0 4px;font-size:16px;">' + esc(chartTr('chart.perio.printTitle')) + '</h2>' +
        '<div style="font-size:11px;color:#555;margin-bottom:14px;">' +
            esc(patientName) + (clinicName ? ' &middot; ' + esc(clinicName) : '') +
            ' &middot; ' + esc(chartTr('chart.date')) + ': ' + esc(date) +
        '</div>' +
        '<div style="margin-bottom:6px;font-size:12px;font-weight:700;color:#555;">' +
            esc(chartTr('chart.upperMaxillary')) + '</div>' + upperSVG +
        '<div style="margin:16px 0 6px;font-size:12px;font-weight:700;color:#555;">' +
            esc(chartTr('chart.lowerMandibular')) + '</div>' + lowerSVG +
        '<div style="margin-top:10px;font-size:10px;color:#555;">' +
            chartTr('chart.perio.diagramLegendHtml') + '</div>' +
        '<div style="margin-top:8px;font-size:10px;color:#92610e;font-style:italic;">' +
            esc(chartTr('chart.tonetti.title')) + ': ' +
            (tonetti.finalStage || '—') + ' / ' + (tonetti.finalGrade || '—') +
            ' &mdash; ' + esc(chartTr('chart.tonetti.disclaimer')) +
        '</div>';

    var docName = chartTrRepl('chart.perio.archiveDocName', { DATE: date });

    PDFEDITOR.exportFormsHtmlToPatient({
        patientId: chartPatientId,
        html: bodyHtml,
        documentName: docName,
        download: false,
        template: {
            template_code: 'perio_chart',
            template_name: chartTr('chart.perio.printTitle'),
            template_type: 'pdf'
        }
    }).then(function() {
        showChartToast(chartTr('chart.perio.archiveSaved'));
    }).catch(function(e) {
        alert(chartTrRepl('chart.perio.archiveError', { MSG: (e && e.message) || String(e) }));
    }).finally(function() {
        if (btn) { btn.disabled = false; btn.textContent = origLabel || chartTr('chart.perio.archiveBtn'); }
    });
}

// ════════════════════════════════════════════════════════════════
// SAVE / LOAD  (Supabase)
// ════════════════════════════════════════════════════════════════
function saveChartRecord() {
    if (!chartPatientId) { alert(chartTr('chart.alert.noPatient')); return; }

    var dateEl = g('chartDateInput');
    var date   = dateEl ? dateEl.value : todayISO();

    // Collect notes
    var denNotes = g('dentalChartNotes') ? g('dentalChartNotes').value : '';
    var perNotes = g('perioChartNotes')  ? g('perioChartNotes').value  : '';

    // Snapshot state (exclude __notes__ from storage keys)
    var denSnap = JSON.parse(JSON.stringify(dentalState));
    var perSnap = JSON.parse(JSON.stringify(perioState));

    var payload = {
        patient_id:    chartPatientId,
        chart_date:    date,
        dental_data:   JSON.stringify(denSnap),
        perio_data:    JSON.stringify(perSnap),
        dental_notes:  denNotes || null,
        perio_notes:   perNotes || null
    };

    var promise;
    if (chartRecordId) {
        promise = SB.from('dental_charts')
            .update(payload)
            .eq('id', chartRecordId);
    } else {
        promise = SB.from('dental_charts')
            .insert([payload])
            .select();
    }

    promise.then(function(r) {
        if (r.error) {
            alert(chartTrRepl('chart.alert.saveError', { MSG: r.error.message }));
            return;
        }
        if (!chartRecordId && r.data && r.data[0]) {
            chartRecordId = r.data[0].id;
        }
        showChartToast(chartTrRepl('chart.toast.saved', { DATE: date }));
    });
}

function loadChartRecord() {
    if (!chartPatientId) return;

    var dateEl = g('chartDateInput');
    var date   = dateEl ? dateEl.value : todayISO();
    chartDate  = date;

    SB.from('dental_charts')
        .select('*')
        .eq('patient_id', chartPatientId)
        .eq('chart_date', date)
        .order('created_at', { ascending: false })
        .limit(1)
    .then(function(r) {
        if (r.error) {
            console.warn('Chart load error:', r.error.message); return;
        }
        if (!r.data || !r.data.length) {
            // No record: reset to blank
            dentalState   = {};
            perioState    = {};
            chartRecordId = null;
            var dnBlank = g('dentalChartNotes');
            if (dnBlank) dnBlank.value = '';
            refreshAllTeeth();
            refreshPerioInputs();
            showChartToast(chartTrRepl('chart.toast.noRecord', { DATE: date }));
            return;
        }
        var rec = r.data[0];
        chartRecordId = rec.id;

        try { dentalState = JSON.parse(rec.dental_data || '{}'); }
        catch(e) { dentalState = {}; }
        try { perioState  = JSON.parse(rec.perio_data  || '{}'); }
        catch(e) { perioState  = {}; }

        // Notes live outside dentalState/perioState in the DB (separate
        // columns), but renderPerioPane() re-renders its textarea from
        // perioState.__notes__ on every refresh — keep both in sync so a
        // reload doesn't get clobbered back to blank on the next re-render.
        dentalState.__notes__ = rec.dental_notes || '';
        perioState.__notes__  = rec.perio_notes  || '';

        var dn = g('dentalChartNotes');
        var pn = g('perioChartNotes');
        if (dn) dn.value = rec.dental_notes || '';
        if (pn) pn.value = rec.perio_notes  || '';

        refreshAllTeeth();
        refreshPerioInputs();
        updatePerioSummary();
        showChartToast(chartTrRepl('chart.toast.loaded', { DATE: date }));
    });
}

function refreshAllTeeth() {
    allDentalChartToothNums().forEach(function(tn) {
        refreshToothSVG(tn);
    });
}

function refreshPerioInputs() {
    // Re-render perio pane to pick up loaded state
    renderPerioPane();
}

// ── Toast notification ────────────────────────────────────────
function showChartToast(msg) {
    var toast = g('chartToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'chartToast';
        toast.style.cssText =
            'position:fixed;bottom:30px;left:50%;' +
            'transform:translateX(-50%) translateY(20px);' +
            'background:rgba(30,40,70,.92);color:#fff;' +
            'padding:10px 22px;border-radius:30px;' +
            'font-size:13px;font-weight:600;' +
            'opacity:0;transition:all .3s;z-index:99999;' +
            'pointer-events:none;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2600);
}

document.addEventListener('app-lang-change', function() {
    var pane = g('con-charting');
    var chartContent = g('chartingTabContent');
    if (typeof applyI18nInRoot === 'function') {
        if (typeof chartPatientId !== 'undefined' && chartPatientId) {
            if (pane) applyI18nInRoot(pane);
            if (chartContent) applyI18nInRoot(chartContent);
        } else if (pane) {
            var conSec = g('consultationSection');
            if (!conSec || conSec.style.display !== 'none') applyI18nInRoot(pane);
        }
    }
    if (typeof chartPatientId !== 'undefined' && chartPatientId &&
        typeof refreshChartForLang === 'function') {
        refreshChartForLang();
    }
    var tip = g('toothTooltip');
    if (tip && tip.style.display !== 'none' && typeof refreshToothTooltipForLang === 'function') {
        refreshToothTooltipForLang();
    }
});
