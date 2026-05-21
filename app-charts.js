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
        if (idx2 >= 0) state.splice(idx2, 1);
        else            state.push(tool);
    }

    refreshToothSVG(tn);
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

    // Summary
    pane.appendChild(buildPerioSummary());

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
        { id: 'gm_l',  labelKey: 'chart.perio.gmLingual', surface: 'L',   type: 'threeval' },
        { id: 'pd_l',  labelKey: 'chart.perio.pdLingual', surface: 'L',   type: 'threeval' },
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
