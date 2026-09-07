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

// Compact recall/PD-BOP view: hides GM/CAL/Bone-level rows, keeps only
// Mobility/Implant/Furcation/BOP/Plaque/PD — mirrors the "PD/BOP" shortened
// view described in the periodontalchart-online.com manual for supportive
// periodontal therapy visits.
var perioCompactMode = false;

// Active tool for dental charting
var activeTool  = 'missing';

// ── Perio Settings (persisted clinic-wide in Supabase — like periodontal
// chart-online.com's Settings window: GM sign convention, tooth-numbering
// system, mirrored tooth orientation, and a named probing-sequence preset —
// stored in public.app_config, the same generic key/value config table used
// elsewhere in the app, NOT localStorage, so every computer/browser in the
// clinic sees the same settings instead of each PC having its own). ──────
var PERIO_SETTINGS_KEY = 'banana_perio_chart_settings';

function perioSettingsDefaults() {
    return {
        numbering: 'fdi',        // 'fdi' | 'universal'
        mirrorViews: true,       // maxilla roots up / mandible roots down (anatomically correct default)
        probingSequence: 'bern'  // 'bern' | 'rightToLeft' | 'paperTable'
    };
}

function perioSettingsNormalize(parsed) {
    parsed = parsed || {};
    return {
        numbering: parsed.numbering === 'universal' ? 'universal' : 'fdi',
        mirrorViews: !!parsed.mirrorViews,
        probingSequence: parsed.probingSequence || 'bern'
    };
}

var perioSettings = perioSettingsDefaults();
var perioSettingsLoaded = false;

/**
 * Loads the clinic-wide perio chart settings from Supabase (public.app_config
 * — key/value TEXT columns, same table the Poster Maker uses for its API
 * keys). Falls back silently to the built-in defaults if the row/table
 * doesn't exist yet or the request fails offline. Re-renders the charting
 * pane in place if it's already open once the real settings arrive, so a
 * clinic-wide change (made from another computer) shows up on refresh.
 */
function loadPerioSettingsFromSupabase() {
    if (typeof SB === 'undefined') { perioSettingsLoaded = true; return Promise.resolve(); }
    return SB.from('app_config')
        .select('key, value')
        .eq('key', PERIO_SETTINGS_KEY)
        .then(function(r) {
            perioSettingsLoaded = true;
            if (r.error || !r.data || !r.data.length || !r.data[0].value) return;
            try { perioSettings = perioSettingsNormalize(JSON.parse(r.data[0].value)); }
            catch (e) { /* ignore malformed stored value, keep defaults */ }
            var pane = g('chartPane-perio');
            if (pane && pane.offsetParent !== null) renderPerioPane();
        })
        .catch(function() { perioSettingsLoaded = true; });
}

/**
 * Saves the clinic-wide perio chart settings to Supabase (public.app_config).
 * Returns a promise resolving to { ok, error } so the Settings modal can
 * show a clear error (e.g. table missing) instead of failing silently.
 */
function savePerioSettings() {
    if (typeof SB === 'undefined') return Promise.resolve({ ok: false, error: 'Supabase not available' });
    var row = { key: PERIO_SETTINGS_KEY, value: JSON.stringify(perioSettings), updated_at: new Date().toISOString() };
    return SB.from('app_config')
        .upsert([row], { onConflict: 'key' })
        .then(function(r) {
            if (r.error) return { ok: false, error: r.error.message };
            return { ok: true, error: null };
        })
        .catch(function(err) {
            return { ok: false, error: (err && err.message) ? err.message : String(err) };
        });
}

// Kick off the initial clinic-wide load right away — perioSettings already
// holds sane defaults synchronously so nothing that reads it early breaks.
loadPerioSettingsFromSupabase();

// FDI ↔ Universal (American) tooth-numbering conversion, display only —
// all internal state keys always stay FDI-based.
var FDI_TO_UNIVERSAL = {
    18:1, 17:2, 16:3, 15:4, 14:5, 13:6, 12:7, 11:8,
    21:9, 22:10, 23:11, 24:12, 25:13, 26:14, 27:15, 28:16,
    38:17, 37:18, 36:19, 35:20, 34:21, 33:22, 32:23, 31:24,
    41:25, 42:26, 43:27, 44:28, 45:29, 46:30, 47:31, 48:32
};

function pdToothLabel(tn) {
    if (perioSettings.numbering === 'universal' && FDI_TO_UNIVERSAL[tn]) {
        return String(FDI_TO_UNIVERSAL[tn]);
    }
    return String(tn);
}

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
                'font-size:12px;font-weight:600;cursor:pointer;' +
                'margin-right:6px;">' +
                chartTr('chart.save') + '</button>' +
                '<button onclick="openChartHistoryModal()" ' +
                'title="' + esc(chartTr('chart.history.btnTitle')) + '" ' +
                'style="padding:5px 12px;background:#f8fafc;' +
                'border:1px solid #cbd5e1;color:#334155;' +
                'border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">' +
                chartTr('chart.history.btn') + '</button>' +
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
    width: 22px;
    padding: 1px 0;
    text-align: center;
    border: 1px solid #ddd;
    border-radius: 3px;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.1;
    background: #fff;
}
.perio-input:focus {
    outline: none;
    background: rgba(250, 204, 21, 0.35);
}
/* Users type the number directly — the native up/down spinner just eats
   space and is never used, so hide it (Chrome/Edge + Firefox). */
.perio-input::-webkit-outer-spin-button,
.perio-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.perio-input[type="number"] { -moz-appearance: textfield; }
.perio-input.bleeding { background: #fff0f0 !important; }
.perio-input.deep     { background: #fff3e0 !important; color:#e74c3c; font-weight:700; }
.perio-input.shallow  { background: #f0fff4 !important; }

/* BOP / Plaque cells: the whole box is the click target — one click fills
   it (light red for Bleeding on Probing, light blue for Plaque), another
   click clears it. No inner checkbox to aim for. */
.perio-bop-cell { cursor: pointer; }
.perio-bop-cell:hover { background: #fee2e2; }
.perio-bop-cell.on { background: #f87171 !important; }
.perio-bop-cell.perio-plaque-cell:hover { background: #dbeafe; }
.perio-bop-cell.perio-plaque-cell.on { background: #60a5fa !important; }
.perio-bop-cell:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgba(250, 204, 21, 0.5); }

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

/* Full-width partition line marking the Buccal → Lingual/Palatal boundary
   (applies to every cell in the row, not just the row-label column). */
.perio-bl-divider td { border-top: 3px solid #1e293b !important; }
.perio-bl-divider .perio-row-label { position: relative; }

/* ── Compact per-arch data panel: one tooth = one column (no D/M/Me
   sub-columns), Buccal grid → tooth diagram → Lingual grid, sized to fit
   one page/screen width for the whole 16-tooth arch, matching
   periodontalchart-online.com's printed layout. ────────────────────── */
.perio-arch-panel { border: 1px solid #e0e6ed; border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; }
.perio-ctable-wrap { overflow-x: auto; }
.perio-ctable { border-collapse: collapse; table-layout: fixed; font-size: 11px; }
.perio-ctable th, .perio-ctable td { border: 1px solid #e8edf2; padding: 1px; text-align: center; }
.perio-ctable thead th {
    background: #f8fafc; font-weight: 700; color: #555; font-size: 11px;
    padding: 3px 1px; white-space: nowrap;
}
.perio-ctable thead th.perio-tooth-cell { cursor: pointer; color: var(--primary); }
.perio-ctable tbody th {
    background: #f8fafc; font-size: 10px; font-weight: 700; color: #777;
    text-align: left; padding: 2px 6px; white-space: nowrap; width: 100px;
    overflow: hidden; text-overflow: ellipsis;
}
.perio-ctri { display: flex; align-items: stretch; height: 18px; }
.perio-ctri > * { flex: 1 1 0; min-width: 0; border-right: 1px solid #eef1f6; }
.perio-ctri > *:last-child { border-right: none; }
.perio-ctable .perio-input {
    width: 100%; height: 100%; border: none; border-radius: 0;
    font-size: 11px; padding: 0;
}
.perio-ctable select, .perio-ctable button.perio-c-btn {
    width: 100%; height: 20px; border: none; background: transparent;
    font-size: 11px; font-weight: 700; cursor: pointer;
}
.perio-ctable .perio-calc-span { display: block; font-size: 10px; font-weight: 700; color: #555; line-height: 18px; }
.perio-ctable .perio-note-input {
    width: 100%; height: 20px; border: none; background: transparent;
    font-size: 10px; font-weight: 500; color: #334155; padding: 0 3px;
    text-align: left;
}
/* Active data-entry highlight: whichever mini box currently has keyboard
   focus (typing a number, editing a note) lights up a bright, light,
   transparent yellow so it's unmistakable which cell is "live" while
   charting a full arch of tiny boxes — without turning fully opaque/solid,
   so the value underneath still reads clearly. Just the fill — no outline/
   border ring around the box. */
.perio-ctable .perio-input:focus,
.perio-ctable .perio-note-input:focus {
    background: rgba(250, 204, 21, 0.4) !important;
    color: #1f2937;
    outline: none;
    position: relative;
    z-index: 2;
}
.perio-ctable select:focus-visible,
.perio-ctable button.perio-c-btn:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px rgba(250, 204, 21, 0.4);
}

/* Missing tooth → the entire column is inactivated: blank white, no
   value, no input — nothing can be charted for a tooth that isn't there.
   (The tooth itself is shown crossed out with a diagonal hatch in the
   diagram between the Buccal/Lingual grids — see pdMissingToothHatchSVG.) */
.perio-ctable td.perio-missing-cell {
    background: #ffffff;
    cursor: not-allowed;
}
/* Dedicated midline gap column (same width as the diagram's own midline
   gap) carrying a single centered semi-solid light partition line — a real
   column rather than a border, so the gap's width — and therefore every
   tooth column after it — lines up pixel-for-pixel with the tooth diagram. */
.perio-ctable th.perio-gap-col,
.perio-ctable td.perio-gap-col { border-left: none; border-right: none; padding: 0; background: transparent; }
.perio-ctable .perio-gap-line { width: 2px; height: 100%; min-height: 18px; margin: 0 auto; background: rgba(100,116,139,.55); }
.perio-arch-panel-divider {
    display: flex; align-items: center; gap: 8px; margin: 2px 0 10px;
    font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em;
}
.perio-arch-panel-divider::before, .perio-arch-panel-divider::after {
    content: ''; flex: 1; height: 1px; background: #e2e8f0;
}

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
    var implantBefore = pdDentalImplantCharted(tn);

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

    var implantAfter = pdDentalImplantCharted(tn);
    var perioImplantChanged = false;
    if (!implantBefore && implantAfter) {
        perioImplantChanged = pdApplyPerioImplantFromDental(tn);
    } else if (implantBefore && !implantAfter) {
        perioImplantChanged = pdRemovePerioImplantFromDental(tn);
    }

    refreshToothSVG(tn);
    if (typeof refreshPerioLivePreview === 'function') refreshPerioLivePreview();
    if (perioImplantChanged && chartPerioTabActive()) renderPerioPane();
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
    pdSyncAllPerioImplantsFromDentalOnLoad();
    pdSanitizeImplantExcludedFields();
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

        // Upper arch panel — editable Buccal grid, then the tooth diagram
        // (pocket outline / attachment-level plot, updating live as values
        // are typed), then the editable Lingual/Palatal grid, all sized to
        // one page width — periodontalchart-online.com's layout.
        var upSec = document.createElement('div');
        upSec.className = 'perio-section';
        var upTitle = document.createElement('div');
        upTitle.className = 'perio-section-title';
        upTitle.textContent = chartTr('chart.upperMaxillary');
        upSec.appendChild(upTitle);
        upSec.appendChild(buildPerioArchPanel(UPPER_RIGHT.concat(UPPER_LEFT), 'upper'));
        pane.appendChild(upSec);

        // Lower arch panel
        var loSec = document.createElement('div');
        loSec.className = 'perio-section';
        var loTitle = document.createElement('div');
        loTitle.className = 'perio-section-title';
        loTitle.textContent = chartTr('chart.lowerMandibular');
        loSec.appendChild(loTitle);
        loSec.appendChild(buildPerioArchPanel(LOWER_RIGHT.concat(LOWER_LEFT), 'lower'));
        pane.appendChild(loSec);
    }

    // Summary
    pane.appendChild(buildPerioSummary());
    updatePerioSummary();

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

    // PD/BOP compact recall view — its label always names the view the next
    // click leads to, exactly like the reference chart's toggle.
    var compactBtn = document.createElement('button');
    compactBtn.type = 'button';
    compactBtn.textContent = chartTr(perioCompactMode ? 'chart.perio.statusLabel' : 'chart.perio.pdBopLabel');
    compactBtn.title = chartTr('chart.perio.pdBopTitle');
    compactBtn.style.cssText =
        'padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;' +
        'cursor:pointer;border:1px solid #d0dcf8;' +
        (perioCompactMode
            ? 'background:var(--primary);color:#fff;'
            : 'background:#fff;color:var(--primary);');
    compactBtn.addEventListener('click', function() {
        perioCompactMode = !perioCompactMode;
        renderPerioPane();
    });
    bar.appendChild(compactBtn);

    var settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.textContent = chartTr('chart.perio.settingsBtn');
    settingsBtn.style.cssText =
        'padding:6px 14px;background:#fff;border:1px solid #d0dcf8;' +
        'color:var(--primary);border-radius:8px;font-size:12px;' +
        'font-weight:600;cursor:pointer;';
    settingsBtn.addEventListener('click', function() { openPerioSettingsModal(); });
    bar.appendChild(settingsBtn);

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

// ── Perio Settings modal ──────────────────────────────────────
function openPerioSettingsModal() {
    var body = g('perioSettingsBody');
    if (!body) return;

    var seqOptions = [
        { id: 'bern',        labelKey: 'chart.perio.seqBern' },
        { id: 'rightToLeft', labelKey: 'chart.perio.seqRightToLeft' },
        { id: 'paperTable',  labelKey: 'chart.perio.seqPaperTable' }
    ];

    body.innerHTML =
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;' +
            'padding:8px 10px;font-size:12px;color:#92400e;">' +
            esc(chartTr('chart.perio.gmSignNote')) +
        '</div>' +
        '<div>' +
            '<div style="font-weight:600;margin-bottom:6px;">' + esc(chartTr('chart.perio.setNumbering')) + '</div>' +
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px;">' +
                '<input type="radio" name="perioSetNumbering" value="fdi"' +
                    (perioSettings.numbering !== 'universal' ? ' checked' : '') + '>' +
                '<span>' + esc(chartTr('chart.perio.numberingFdi')) + '</span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">' +
                '<input type="radio" name="perioSetNumbering" value="universal"' +
                    (perioSettings.numbering === 'universal' ? ' checked' : '') + '>' +
                '<span>' + esc(chartTr('chart.perio.numberingUniversal')) + '</span>' +
            '</label>' +
        '</div>' +
        '<div>' +
            '<div style="font-weight:600;margin-bottom:6px;">' + esc(chartTr('chart.perio.setProbingSequence')) + '</div>' +
            '<select id="perioSetProbingSeq" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:6px;">' +
                seqOptions.map(function(o) {
                    return '<option value="' + o.id + '"' +
                        (perioSettings.probingSequence === o.id ? ' selected' : '') + '>' +
                        esc(chartTr(o.labelKey)) + '</option>';
                }).join('') +
            '</select>' +
        '</div>';

    var saveBtn = g('perioSettingsSaveBtn');
    if (saveBtn) {
        saveBtn.onclick = function() {
            var numRadio = document.querySelector('input[name="perioSetNumbering"]:checked');
            perioSettings.numbering = numRadio ? numRadio.value : 'fdi';
            var seqSel = g('perioSetProbingSeq');
            perioSettings.probingSequence = seqSel ? seqSel.value : 'bern';

            var origLabel = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = chartTr('chart.perio.settingsSaving');
            savePerioSettings().then(function(res) {
                saveBtn.disabled = false;
                saveBtn.textContent = origLabel;
                closeModal('perioSettingsModal');
                renderPerioPane();
                if (res && res.ok) {
                    showChartToast(chartTr('chart.perio.settingsSaved'));
                } else {
                    alert(chartTrRepl('chart.perio.settingsSaveError', { MSG: (res && res.error) || '' }));
                }
            });
        };
    }

    openModal('perioSettingsModal');
}

// ── Build perio table for a set of teeth ─────────────────────
/**
 * Re-render only the compact live pocket-diagram preview shown above the
 * data-entry tables (table/"Enter Data" view). Called on every PD/GM/bone/
 * mobility/furcation/BOP change so the pocket outline plots immediately,
 * without touching focus in the table below.
 */
// Redraws the tooth-diagram SVG embedded between each arch's Buccal and
// Lingual grids (in-place, by id) so the pocket outline / attachment-level
// plot updates immediately as PD, GM, and bone-level values are typed —
// no separate "live preview" box needed since the diagram now lives inside
// the compact arch panel itself, in both "Enter Data" and "Chart View".
function refreshPerioLivePreview() {
    var upWrap = g('perioArchDiagramWrap-upper');
    if (upWrap) upWrap.innerHTML = pdBuildArchDiagramSVG(UPPER_RIGHT.concat(UPPER_LEFT), 'upper');
    var loWrap = g('perioArchDiagramWrap-lower');
    if (loWrap) loWrap.innerHTML = pdBuildArchDiagramSVG(LOWER_RIGHT.concat(LOWER_LEFT), 'lower');
}

/**
 * Keyboard navigation for the "tiny" per-site data-entry cells: ArrowLeft /
 * ArrowRight move focus to the previous/next site cell within the same
 * measurement row, spanning across tooth boundaries (D/M/Me of one tooth,
 * then straight into D of the next tooth), the way a spreadsheet behaves.
 */
function pdWireArrowNavRow(tr) {
    var els = Array.prototype.slice.call(
        tr.querySelectorAll('.perio-input, .perio-bop-cell'));
    els.forEach(function(el, idx) {
        el.addEventListener('keydown', function(e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            var target = els[idx + (e.key === 'ArrowLeft' ? -1 : 1)];
            if (!target) return;
            e.preventDefault();
            target.focus();
            if (target.select) target.select();
        });
    });
}

// Row definitions — order and content follow the reference chart:
// Tooth / Mobility / Implant / Furcation / BOP / Plaque / GM / PD / AL,
// with GM/CAL/Bone-level dropped in the compact "PD/BOP" recall view.
// Shared between the interactive data-entry table (buildPerioTable) and the
// static print/PDF table renderer (pdBuildDataTableHtml) so both stay in sync.
function perioRowDefs() {
    return [
        { id: 'mob',      labelKey: 'chart.perio.mobility',  surface: null, type: 'select',
          options: ['0','I','II','III'] },
        { id: 'implant',  labelKey: 'chart.perio.implant',   surface: null, type: 'implant' },
        { id: 'frc',      labelKey: 'chart.perio.furcation', surface: null, type: 'furcation',
          options: ['—','I','II','III'] },
        { id: 'note',     labelKey: 'chart.perio.note',      surface: null, type: 'text' },
        { id: 'bop_b',    labelKey: 'chart.perio.bopB',      surface: 'B',  type: 'bop' },
        { id: 'pi_b',     labelKey: 'chart.perio.plaqueB',   surface: 'B',  type: 'bop' },
        { id: 'pd_b',     labelKey: 'chart.perio.pdBuccal',  surface: 'B',  type: 'threeval' },
        { id: 'gm_b',     labelKey: 'chart.perio.gmBuccal',  surface: 'B',  type: 'threeval', compactHide: true },
        { id: 'cal_b',    labelKey: 'chart.perio.calBuccal', surface: 'B',  type: 'calc', compactHide: true,
          a: 'pd_b', b: 'gm_b' },
        { id: 'bl_b',     labelKey: 'chart.perio.blBuccal',  surface: 'B',  type: 'threeval', compactHide: true },
        { id: 'gm_l',     labelKey: 'chart.perio.gmLingual', surface: 'L',  type: 'threeval', compactHide: true },
        { id: 'pd_l',     labelKey: 'chart.perio.pdLingual', surface: 'L',  type: 'threeval' },
        { id: 'cal_l',    labelKey: 'chart.perio.calLingual', surface: 'L', type: 'calc', compactHide: true,
          a: 'pd_l', b: 'gm_l' },
        { id: 'bl_l',     labelKey: 'chart.perio.blLingual', surface: 'L',  type: 'threeval', compactHide: true },
        { id: 'pi_l',     labelKey: 'chart.perio.plaqueL',   surface: 'L',  type: 'bop' },
        { id: 'bop_l',    labelKey: 'chart.perio.bopL',      surface: 'L',  type: 'bop' },
    ];
}

function buildPerioTable(teeth, arch) {
    var wrap = document.createElement('div');
    wrap.className = 'perio-table-wrap';

    var table = document.createElement('table');
    table.className = 'perio-table';

    var ROWS = perioRowDefs();
    var visibleRows = perioCompactMode
        ? ROWS.filter(function(r) { return !r.compactHide; })
        : ROWS;

    // Header row — clicking a tooth number toggles it missing, exactly like
    // "Tooth Number – one click marks the tooth as missing" in the manual.
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
        th.style.cursor = 'pointer';
        th.title = chartTr('chart.perio.clickMissingTitle');
        th.textContent = pdToothLabel(tn);
        if (pdToothIsMissing(tn)) {
            th.style.color = '#9ca3af';
            th.style.textDecoration = 'line-through';
            th.style.background = '#f3f4f6';
        }
        th.addEventListener('click', function() { pdToggleMissingTooth(tn); });
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
    var prevRowSurface = null;

    visibleRows.forEach(function(row) {
        var tr = document.createElement('tr');

        // Full-width partition line right at the Buccal → Lingual/Palatal
        // handover (first Lingual row after one or more Buccal rows).
        if (row.surface === 'L' && prevRowSurface === 'B') {
            tr.classList.add('perio-bl-divider');
        }
        prevRowSurface = row.surface;

        // Row label
        var lbl = document.createElement('td');
        lbl.className = 'perio-row-label';
        if (row.surface === 'B') lbl.classList.add('perio-surface-b');
        if (row.surface === 'L') lbl.classList.add('perio-surface-l');
        lbl.textContent = chartTr(row.labelKey);
        tr.appendChild(lbl);

        // BOP/Plaque rows: click the label to fill the whole row, Shift+click
        // to clear it — "A click on the row label fills the entire row,
        // shift and click clears it again."
        if (row.type === 'bop') {
            lbl.style.cursor = 'pointer';
            lbl.title = chartTr('chart.perio.rowFillTitle');
            lbl.addEventListener('click', function(e) {
                var fillVal = !e.shiftKey;
                teeth.forEach(function(tn2) {
                    ['d','m','me'].forEach(function(pos2) {
                        perioState[tn2 + '_' + row.id + '_' + pos2] = fillVal;
                    });
                });
                renderPerioPane();
                updatePerioSummary();
            });
        }

        teeth.forEach(function(tn) {
            var implantActive = pdPerioImplantActive(tn);

            if (row.type === 'threeval' || row.type === 'bop') {
                ['d','m','me'].forEach(function(pos) {
                    var td  = document.createElement('td');
                    var key = tn + '_' + row.id + '_' + pos;

                    if (row.type === 'bop') {
                        // Whole cell is the click target (not a tiny checkbox
                        // inside it) — one click anywhere in the box fills it
                        // (red for Bleeding on Probing, blue for Plaque),
                        // another click clears it.
                        var isPlaqueRow = row.id === 'pi_b' || row.id === 'pi_l';
                        td.id = 'perio_' + key;
                        td.className = isPlaqueRow ? 'perio-bop-cell perio-plaque-cell' : 'perio-bop-cell';
                        td.tabIndex = 0;
                        td.setAttribute('role', 'checkbox');
                        var setBopVisual = function(on) {
                            td.classList.toggle('on', !!on);
                            td.setAttribute('aria-checked', on ? 'true' : 'false');
                        };
                        setBopVisual(!!perioState[key]);
                        var toggleBop = function() {
                            var on = !perioState[key];
                            perioState[key] = on;
                            setBopVisual(on);
                            updatePerioSummary();
                            refreshPerioLivePreview();
                        };
                        td.addEventListener('click', toggleBop);
                        td.addEventListener('keydown', function(e) {
                            if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                toggleBop();
                            }
                        });
                    } else {
                        var isGmRow = row.id === 'gm_b' || row.id === 'gm_l';
                        var inp = document.createElement('input');
                        inp.type        = 'number';
                        inp.className   = 'perio-input';
                        inp.id          = 'perio_' + key;
                        inp.min         = isGmRow ? '-15' : '0';
                        inp.max         = '15';
                        inp.placeholder = '—';
                        if (isGmRow) inp.title = chartTr('chart.perio.gmSignNote');
                        var storedVal = perioState[key];
                        inp.value = storedVal != null ? storedVal : '';
                        inp.addEventListener('input', function() {
                            var v = parseInt(inp.value) || 0;
                            perioState[key] = v || null;
                            inp.className = 'perio-input';
                            if (v >= 4)  inp.classList.add('deep');
                            else if (v <= 2 && v > 0) inp.classList.add('shallow');
                            // Auto-calc CAL
                            calcCAL(tn, pos);
                            updatePerioSummary();
                            refreshPerioLivePreview();
                        });
                        // Initial colour
                        var iv = parseInt(storedVal) || 0;
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
                // Spans 3 columns. Mobility is hidden while an implant is
                // charted at this tooth — "As long as an implant is set,
                // the application hides the tooth mobility."
                var td = document.createElement('td');
                td.colSpan = 3;
                if (row.id === 'mob' && implantActive) {
                    td.innerHTML = pdImplantDisabledCellContent();
                    tr.appendChild(td);
                    return;
                }
                var key = tn + '_' + row.id;
                var sel = document.createElement('select');
                sel.style.cssText =
                    'width:100%;border:1px solid #ddd;border-radius:3px;' +
                    'font-size:14px;font-weight:700;padding:2px;background:#fff;';
                row.options.forEach(function(opt) {
                    var o = document.createElement('option');
                    o.value = opt; o.textContent = opt;
                    sel.appendChild(o);
                });
                sel.value = perioState[key] || row.options[0];
                sel.addEventListener('change', function() {
                    perioState[key] = sel.value;
                    refreshPerioLivePreview();
                });
                td.appendChild(sel);
                tr.appendChild(td);
            } else if (row.type === 'implant') {
                // Spans 3 columns. Click-cycles: none → implant → red
                // (peri-implantitis) → green (treated) → back to natural
                // tooth, exactly as described for the Implant button.
                var tdI = document.createElement('td');
                tdI.colSpan = 3;
                var keyI = tn + '_implant';
                var btnI = document.createElement('button');
                btnI.type = 'button';
                btnI.style.cssText =
                    'width:100%;border:1px solid #ddd;border-radius:3px;' +
                    'font-size:13px;padding:2px;cursor:pointer;background:#fff;font-weight:700;';
                var implColors = ['#cbd5e1', '#334155', '#dc2626', '#16a34a'];
                var implTitleKeys = ['chart.perio.implantState0', 'chart.perio.implantState1',
                    'chart.perio.implantState2', 'chart.perio.implantState3'];
                function renderImplantBtn() {
                    var v = parseInt(perioState[keyI]) || 0;
                    btnI.textContent = v === 0 ? '—' : '◯';
                    btnI.style.color = implColors[v];
                    btnI.title = chartTr(implTitleKeys[v]);
                }
                renderImplantBtn();
                btnI.addEventListener('click', function() {
                    pdApplyImplantCycle(tn);
                    renderPerioPane();
                    refreshPerioLivePreview();
                });
                tdI.appendChild(btnI);
                tr.appendChild(tdI);
            } else if (row.type === 'furcation') {
                // Spans 3 columns. Hidden while an implant is charted — furcation
                // does not apply to implant fixtures.
                var tdF = document.createElement('td');
                tdF.colSpan = 3;
                if (implantActive) {
                    tdF.innerHTML = pdImplantDisabledCellContent();
                    tr.appendChild(tdF);
                    return;
                }
                var keyF = tn + '_frc';
                var btnF = document.createElement('button');
                btnF.type = 'button';
                btnF.style.cssText =
                    'width:100%;border:1px solid #ddd;border-radius:3px;' +
                    'font-size:11px;padding:2px;cursor:pointer;background:#fff;' +
                    'font-weight:700;color:#b45309;';
                function renderFrcBtn() {
                    var cur = perioState[keyF] || '—';
                    btnF.textContent = cur;
                }
                renderFrcBtn();
                btnF.addEventListener('click', function() {
                    var opts = row.options;
                    var cur  = perioState[keyF] || '—';
                    var next = opts[(opts.indexOf(cur) + 1) % opts.length];
                    perioState[keyF] = next === '—' ? null : next;
                    renderFrcBtn();
                    refreshPerioLivePreview();
                });
                tdF.appendChild(btnF);
                tr.appendChild(tdF);
            }
        });
        if (row.type === 'threeval' || row.type === 'bop') pdWireArrowNavRow(tr);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

// ════════════════════════════════════════════════════════════════
// COMPACT INTERACTIVE DATA-ENTRY PANEL — one tooth = one column (no D/M/Me
// sub-columns/headers), Buccal grid → tooth diagram → Lingual grid, all
// sized to fit one page/screen width for a whole 16-tooth arch. This is the
// live, editable counterpart of the compact print panel below, and is what
// "Enter Data" mode now renders per arch, matching periodontalchart-
// online.com's layout (grid / diagram / grid, stacked, single page wide).
// ════════════════════════════════════════════════════════════════
var PERIO_BUCCAL_ROW_IDS  = ['mob', 'implant', 'frc', 'bop_b', 'pi_b', 'pd_b', 'gm_b', 'cal_b', 'bl_b'];
var PERIO_LINGUAL_ROW_IDS = ['gm_l', 'pd_l', 'cal_l', 'bl_l', 'pi_l', 'bop_l', 'frc', 'note'];

/** One interactive D/M/Me site cell — number input (threeval), clickable
 *  fill-cell (bop/plaque), or read-only calculated span (CAL). */
function perioCompactSiteCell(row, tn, pos) {
    var key = tn + '_' + row.id + '_' + pos;

    if (row.type === 'bop') {
        var isPlaqueRow = row.id === 'pi_b' || row.id === 'pi_l';
        var cell = document.createElement('div');
        cell.id = 'perio_' + key;
        cell.className = isPlaqueRow ? 'perio-bop-cell perio-plaque-cell' : 'perio-bop-cell';
        cell.tabIndex = 0;
        cell.setAttribute('role', 'checkbox');
        var setVisual = function(on) {
            cell.classList.toggle('on', !!on);
            cell.setAttribute('aria-checked', on ? 'true' : 'false');
        };
        setVisual(!!perioState[key]);
        var toggle = function() {
            var on = !perioState[key];
            perioState[key] = on;
            setVisual(on);
            updatePerioSummary();
            refreshPerioLivePreview();
        };
        cell.addEventListener('click', toggle);
        cell.addEventListener('keydown', function(e) {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
        });
        return cell;
    }

    if (row.type === 'calc') {
        var sp = document.createElement('span');
        sp.id = 'perio_' + key;
        sp.className = 'perio-calc-span';
        sp.textContent = perioState[key] != null ? perioState[key] : '—';
        return sp;
    }

    // threeval (PD / GM / Bone level)
    var isGmRow = row.id === 'gm_b' || row.id === 'gm_l';
    var inp = document.createElement('input');
    inp.type        = 'number';
    inp.className   = 'perio-input';
    inp.id          = 'perio_' + key;
    inp.min         = isGmRow ? '-15' : '0';
    inp.max         = '15';
    // GM has one, hard convention, always — a MINUS sign means recession
    // (margin apical to the CEJ, root exposed), a plain positive number
    // means gum overgrowth (margin coronal to the CEJ). No per-clinic
    // "invert" setting anymore, so the sign the user types is exactly what
    // gets stored and used for CAL — never silently re-interpreted.
    if (isGmRow) inp.title = chartTr('chart.perio.gmSignNote');
    var storedVal = perioState[key];
    inp.value = storedVal != null ? storedVal : '';
    inp.addEventListener('input', function() {
        var v = parseInt(inp.value) || 0;
        perioState[key] = v || null;
        inp.className = 'perio-input';
        if (v >= 4) inp.classList.add('deep');
        else if (v <= 2 && v > 0) inp.classList.add('shallow');
        calcCAL(tn, pos);
        updatePerioSummary();
        refreshPerioLivePreview();
    });
    var iv = parseInt(storedVal) || 0;
    if (iv >= 4) inp.classList.add('deep');
    else if (iv <= 2 && iv > 0) inp.classList.add('shallow');
    return inp;
}

/** One tooth's cell for a given row — a tight D/M/Me triple for
 *  threeval/bop/calc rows, or a single control spanning the whole column
 *  for tooth-level rows (mobility / implant / furcation). */
function buildPerioCompactRowCell(row, tn) {
    var td = document.createElement('td');
    if (pdToothIsMissing(tn)) {
        // Missing tooth → the whole column is inactivated: blank white,
        // no controls rendered at all, no data can be entered for a tooth
        // that isn't there.
        td.className = 'perio-missing-cell';
        return td;
    }
    var implantActive = pdPerioImplantActive(tn);

    if (row.type === 'select') {
        if (row.id === 'mob' && implantActive) {
            td.innerHTML = pdImplantDisabledCellContent();
            return td;
        }
        var key = tn + '_' + row.id;
        var sel = document.createElement('select');
        row.options.forEach(function(opt) {
            var o = document.createElement('option');
            o.value = opt; o.textContent = opt;
            sel.appendChild(o);
        });
        sel.value = perioState[key] || row.options[0];
        sel.addEventListener('change', function() {
            perioState[key] = sel.value;
            refreshPerioLivePreview();
        });
        td.appendChild(sel);
        return td;
    }

    if (row.type === 'implant') {
        var keyI = tn + '_implant';
        var btnI = document.createElement('button');
        btnI.type = 'button';
        btnI.className = 'perio-c-btn';
        var implColors = ['#cbd5e1', '#334155', '#dc2626', '#16a34a'];
        var implTitleKeys = ['chart.perio.implantState0', 'chart.perio.implantState1',
            'chart.perio.implantState2', 'chart.perio.implantState3'];
        function renderImplantBtn() {
            var v = parseInt(perioState[keyI]) || 0;
            btnI.textContent = v === 0 ? '—' : '◯';
            btnI.style.color = implColors[v];
            btnI.title = chartTr(implTitleKeys[v]);
        }
        renderImplantBtn();
        btnI.addEventListener('click', function() {
            pdApplyImplantCycle(tn);
            renderPerioPane();
            refreshPerioLivePreview();
        });
        td.appendChild(btnI);
        return td;
    }

    if (row.type === 'furcation') {
        if (implantActive) {
            td.innerHTML = pdImplantDisabledCellContent();
            return td;
        }
        var keyF = tn + '_frc';
        var btnF = document.createElement('button');
        btnF.type = 'button';
        btnF.className = 'perio-c-btn';
        btnF.style.color = '#b45309';
        btnF.textContent = perioState[keyF] || '—';
        btnF.addEventListener('click', function() {
            var opts = row.options;
            var cur  = perioState[keyF] || '—';
            var next = opts[(opts.indexOf(cur) + 1) % opts.length];
            perioState[keyF] = next === '—' ? null : next;
            // Furcation is a single tooth-level value shown on both the
            // Buccal and Lingual grids — a full re-render keeps both
            // buttons for this tooth in sync instead of just this one.
            renderPerioPane();
            refreshPerioLivePreview();
        });
        td.appendChild(btnF);
        return td;
    }

    if (row.type === 'text') {
        var keyN = tn + '_note';
        var inpN = document.createElement('input');
        inpN.type = 'text';
        inpN.className = 'perio-note-input';
        inpN.id = 'perio_' + tn + '_note';
        inpN.value = perioState[keyN] || '';
        inpN.title = chartTr('chart.perio.note');
        inpN.addEventListener('input', function() {
            perioState[keyN] = inpN.value || null;
        });
        td.appendChild(inpN);
        return td;
    }

    // threeval / bop / calc — tight D/M/Me triple, one flex row per cell
    var tri = document.createElement('div');
    tri.className = 'perio-ctri';
    ['d', 'm', 'me'].forEach(function(pos) {
        tri.appendChild(perioCompactSiteCell(row, tn, pos));
    });
    td.appendChild(tri);
    return td;
}

/** One compact interactive grid (subset of rows, one column per tooth) —
 *  used above (Buccal) and below (Lingual) the arch's tooth diagram. */
function buildPerioCompactTable(rowIds, teeth) {
    var byId = {};
    perioRowDefs().forEach(function(r) { byId[r.id] = r; });
    var visibleIds = rowIds.filter(function(id) {
        var r = byId[id];
        return r && (!perioCompactMode || !r.compactHide);
    });

    var wrap = document.createElement('div');
    wrap.className = 'perio-ctable-wrap';
    var table = document.createElement('table');
    table.className = 'perio-ctable';

    // Column widths are pinned to the exact same per-tooth pitch and midline
    // gap used by the tooth diagram (PD_SITE_W/PD_TOOTH_GAP/PD_MID_GAP), and
    // the table is left at its natural (not width:100%) size — so tooth "15"
    // in this grid sits at the same x as tooth "15" in the diagram, instead
    // of drifting apart as flexible 100%-width columns vs. the diagram's
    // fixed-pixel geometry would otherwise cause.
    var toothColW = 3 * PD_SITE_W + PD_TOOTH_GAP;
    // A <table> with width:auto is a block-level box, so per CSS its used
    // width is max(containing-block width, sum of column widths) — i.e. the
    // browser will happily *stretch* our fixed-pixel columns to fill any
    // leftover space in the panel, silently breaking the pitch-for-pitch
    // match with the diagram below. Pin an explicit table width (= exact sum
    // of the colgroup) so every column renders at precisely its declared
    // pixel width, never stretched, never shrunk.
    var totalTableW = 100 + teeth.length * toothColW + PD_MID_GAP;
    table.style.width = totalTableW + 'px';
    var colgroup = document.createElement('colgroup');
    var col0 = document.createElement('col');
    col0.style.width = '100px';
    colgroup.appendChild(col0);
    teeth.forEach(function(tn, i) {
        if (i === 8) {
            var colGap = document.createElement('col');
            colGap.style.width = PD_MID_GAP + 'px';
            colgroup.appendChild(colGap);
        }
        var col = document.createElement('col');
        col.style.width = toothColW + 'px';
        colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    function gapCell(tag) {
        var cell = document.createElement(tag);
        cell.className = 'perio-gap-col';
        var line = document.createElement('div');
        line.className = 'perio-gap-line';
        cell.appendChild(line);
        return cell;
    }

    var thead = document.createElement('thead');
    var htr   = document.createElement('tr');
    htr.appendChild(document.createElement('th'));
    teeth.forEach(function(tn, i) {
        if (i === 8) htr.appendChild(gapCell('th'));
        var th = document.createElement('th');
        th.className = 'perio-tooth-cell';
        th.title = chartTr('chart.perio.clickMissingTitle');
        th.textContent = pdToothLabel(tn);
        if (pdToothIsMissing(tn)) {
            th.style.color = '#9ca3af';
            th.style.textDecoration = 'line-through';
            th.style.background = '#f3f4f6';
        }
        th.addEventListener('click', function() { pdToggleMissingTooth(tn); });
        htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    visibleIds.forEach(function(id) {
        var row = byId[id];
        if (!row) return;
        var tr = document.createElement('tr');

        var lbl = document.createElement('th');
        lbl.className = 'perio-row-label';
        lbl.textContent = chartTr(row.labelKey);
        if (row.type === 'bop') {
            lbl.style.cursor = 'pointer';
            lbl.title = chartTr('chart.perio.rowFillTitle');
            lbl.addEventListener('click', function(e) {
                var fillVal = !e.shiftKey;
                teeth.forEach(function(tn2) {
                    ['d', 'm', 'me'].forEach(function(pos2) {
                        perioState[tn2 + '_' + row.id + '_' + pos2] = fillVal;
                    });
                });
                renderPerioPane();
                updatePerioSummary();
            });
        }
        tr.appendChild(lbl);

        teeth.forEach(function(tn, i) {
            if (i === 8) tr.appendChild(gapCell('td'));
            var cell = buildPerioCompactRowCell(row, tn);
            tr.appendChild(cell);
        });

        if (row.type === 'threeval' || row.type === 'bop') pdWireArrowNavRow(tr);
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

/** One arch = one panel: editable Buccal grid → live tooth diagram (Buccal
 *  + Lingual mirrored pair) → editable Lingual grid — the interactive,
 *  single-page-width counterpart of pdBuildCompactArchPanelHtml. */
function buildPerioArchPanel(teeth, arch) {
    var panel = document.createElement('div');
    panel.className = 'perio-arch-panel';
    panel.appendChild(buildPerioCompactTable(PERIO_BUCCAL_ROW_IDS, teeth));
    panel.appendChild(buildPerioArchDiagram(teeth, arch));
    panel.appendChild(buildPerioCompactTable(PERIO_LINGUAL_ROW_IDS, teeth));
    return panel;
}

// ════════════════════════════════════════════════════════════════
// STATIC DATA-TABLE RENDERING (print popup + archived PDF)
// Self-contained markup/CSS (no dependency on the live app stylesheet)
// so it renders correctly both in a real print popup window and inside
// the isolated export iframe used by PDFEDITOR.htmlToPdfBytes.
// ════════════════════════════════════════════════════════════════
function pdDataTableCss() {
    return (
        '.pd-dtable{border-collapse:collapse;width:100%;font-size:9px;table-layout:fixed;}' +
        '.pd-dtable th,.pd-dtable td{border:1px solid #d8dee6;padding:3px 1px;text-align:center;}' +
        '.pd-dtable thead th{background:#f1f5f9;font-weight:700;color:#334155;white-space:nowrap;}' +
        '.pd-dtable thead tr.pd-dtable-sub th{font-size:7px;color:#94a3b8;font-weight:600;padding:1px;}' +
        '.pd-dtable tbody th{background:#f8fafc;font-size:8px;font-weight:700;color:#64748b;' +
            'text-align:left;padding:3px 6px;white-space:nowrap;}' +
        '.pd-dtable td.pd-dtable-deep{color:#dc2626;font-weight:700;}' +
        '.pd-dtable td.pd-dtable-bop{background:#ffe4e6;color:#e11d48;font-weight:700;}' +
        '.pd-dtable tr.pd-dtable-divider th,.pd-dtable tr.pd-dtable-divider td{border-top:2px solid #1e293b;}'
    );
}

function pdDataTableSpanValueHtml(row, tn) {
    var implantActive = pdPerioImplantActive(tn);
    if (row.id === 'mob') {
        if (implantActive) return '<td colspan="3" style="color:#cbd5e1;">—</td>';
        var mv = perioState[tn + '_mob'] || '0';
        return '<td colspan="3">' + esc(mv) + '</td>';
    }
    if (row.type === 'implant') {
        var iv = pdPerioImplantVal(tn);
        if (!iv) return '<td colspan="3" style="color:#cbd5e1;">—</td>';
        var implLabels = ['—', chartTr('chart.perio.implant'), '⚠', '✓'];
        var implColors = ['#cbd5e1', '#334155', '#dc2626', '#16a34a'];
        return '<td colspan="3" style="color:' + implColors[iv] + ';font-weight:700;">' +
            esc(implLabels[iv]) + '</td>';
    }
    if (row.type === 'furcation') {
        if (implantActive) return '<td colspan="3" style="color:#cbd5e1;">—</td>';
        var fv = perioState[tn + '_frc'] || '—';
        return '<td colspan="3" style="color:#b45309;font-weight:700;">' + esc(fv) + '</td>';
    }
    if (row.type === 'text') {
        var nv = perioState[tn + '_note'] || '';
        return '<td colspan="3" style="text-align:left;">' + esc(nv) + '</td>';
    }
    return '<td colspan="3">—</td>';
}

function pdDataTablePosValueHtml(row, tn, pos) {
    var key = tn + '_' + row.id + '_' + pos;
    if (row.type === 'bop') {
        return perioState[key] ? '<td class="pd-dtable-bop">●</td>' : '<td></td>';
    }
    if (row.type === 'threeval') {
        var v = perioState[key];
        var cls = (v != null && v >= 4 && row.id.indexOf('pd_') === 0) ? ' class="pd-dtable-deep"' : '';
        return '<td' + cls + '>' + (v != null ? esc(String(v)) : '—') + '</td>';
    }
    if (row.type === 'calc') {
        var cv = perioState[key];
        var cls2 = (cv != null && cv > 3) ? ' class="pd-dtable-deep"' : '';
        return '<td' + cls2 + '>' + (cv != null ? esc(String(cv)) : '—') + '</td>';
    }
    return '<td>—</td>';
}

/** Full static HTML table (one arch) mirroring the interactive data-entry
 *  grid — used for the print popup and the archived PDF's "data" page. */
function pdBuildDataTableHtml(teeth) {
    var rows = perioRowDefs(); // archival record: always the full row set

    var theadTop = '<tr><th style="text-align:left;min-width:70px;">' +
        esc(chartTr('chart.measurement')) + '</th>' +
        teeth.map(function(tn) {
            var missing = pdToothIsMissing(tn);
            return '<th colspan="3"' + (missing ? ' style="color:#9ca3af;text-decoration:line-through;"' : '') + '>' +
                esc(pdToothLabel(tn)) + '</th>';
        }).join('') + '</tr>';

    var theadSub = '<tr class="pd-dtable-sub"><th></th>' +
        teeth.map(function() { return '<th>D</th><th>M</th><th>Me</th>'; }).join('') +
        '</tr>';

    var prevSurface = null;
    var bodyRows = rows.map(function(row) {
        var trCls = (row.surface === 'L' && prevSurface === 'B') ? ' class="pd-dtable-divider"' : '';
        prevSurface = row.surface;

        var cells;
        if (row.type === 'select' || row.type === 'implant' || row.type === 'furcation' || row.type === 'text') {
            cells = teeth.map(function(tn) { return pdDataTableSpanValueHtml(row, tn); }).join('');
        } else {
            cells = teeth.map(function(tn) {
                return ['d','m','me'].map(function(pos) {
                    return pdDataTablePosValueHtml(row, tn, pos);
                }).join('');
            }).join('');
        }
        return '<tr' + trCls + '><th>' + esc(chartTr(row.labelKey)) + '</th>' + cells + '</tr>';
    }).join('');

    return '<table class="pd-dtable"><thead>' + theadTop + theadSub + '</thead><tbody>' +
        bodyRows + '</tbody></table>';
}

/** Both-arches data-table section, with heading/meta — the "page 2" content
 *  reused by both the print popup and the archived-to-record PDF. */
function pdBuildDataTablePageHtml(patientName, clinicName, date) {
    return (
        '<h2 style="margin:0 0 4px;font-size:16px;">' + esc(chartTr('chart.perio.printTitle')) +
            ' — ' + esc(chartTr('chart.measurement')) + '</h2>' +
        '<div style="font-size:11px;color:#555;margin-bottom:12px;">' +
            esc(patientName || '') + (clinicName ? ' &middot; ' + esc(clinicName) : '') +
            ' &middot; ' + esc(chartTr('chart.date')) + ': ' + esc(date || '') +
        '</div>' +
        pdBuildCompactArchPanelHtml(UPPER_RIGHT.concat(UPPER_LEFT), 'upper') +
        pdBuildCompactArchPanelHtml(LOWER_RIGHT.concat(LOWER_LEFT), 'lower')
    );
}

// ════════════════════════════════════════════════════════════════
// COMPACT DATA-CHARTING PANEL — one tooth = one column (no D/M/Me
// sub-columns/headers), with a small schematic tooth-row diagram sandwiched
// between the Buccal and Lingual grids. One panel per arch, sized to fit a
// single page width — this is what gets printed and archived to the PDF
// "data" page, and is meant to be easy to scan / present to patients.
// ════════════════════════════════════════════════════════════════
var PD_COMPACT_TOP_ROWS    = ['mob', 'implant', 'frc', 'bop_b', 'pi_b', 'pd_b', 'gm_b', 'cal_b'];
var PD_COMPACT_BOTTOM_ROWS = ['gm_l', 'pd_l', 'cal_l', 'pi_l', 'bop_l', 'frc', 'note'];

var PD_C_TOOTH_W  = 27;  // px per tooth column (table + diagram both use this)
var PD_C_GAP      = 1;   // small gap between tooth columns
var PD_C_MID_GAP  = 10;  // extra gap at the arch midline
var PD_C_CROWN_H  = 14;
var PD_C_ROOT_H   = 30;
var PD_C_AXIS_W   = 14;  // left gutter reserved for the "B" / "L" row captions

function pdCompactDataCss() {
    return (
        '.pd-cpanel{border:1px solid #d8dee6;border-radius:8px;padding:8px;margin-bottom:12px;' +
            'page-break-inside:avoid;}' +
        '.pd-cpanel-title{font-size:12px;font-weight:700;color:#334155;margin-bottom:4px;}' +
        // Deliberately NOT stretched to width:100% — the diagram SVG (and
        // the tables below) are rendered at their exact native pixel sizes
        // so a tooth column's x-position is identical between the tables
        // and the diagram sandwiched between them (see pdBuildCompactTableHtml).
        '.pd-cpanel-diagram{overflow:hidden;padding:2px 0;}' +
        '.pd-cpanel-diagram svg{display:block;}' +
        '.pd-ctable{border-collapse:collapse;font-size:9px;table-layout:fixed;}' +
        '.pd-ctable th,.pd-ctable td{border:1px solid #d8dee6;padding:2px 1px;text-align:center;}' +
        '.pd-ctable thead th{background:#f1f5f9;font-weight:700;color:#334155;font-size:9px;white-space:nowrap;}' +
        '.pd-ctable tbody th{background:#f8fafc;font-size:8px;font-weight:700;color:#64748b;' +
            'text-align:left;padding:2px 5px;white-space:nowrap;box-sizing:border-box;' +
            'overflow:hidden;text-overflow:ellipsis;}' +
        '.pd-ctable .pd-ctri{display:flex;justify-content:space-between;gap:1px;line-height:1;}' +
        '.pd-ctable .pd-ctri span{flex:1;font-size:8px;font-weight:600;color:#475569;}' +
        '.pd-ctri-deep{color:#dc2626 !important;font-weight:700;}' +
        '.pd-ctri-dot{display:inline-block;width:100%;height:7px;border-radius:1px;background:#e2e8f0;}' +
        '.pd-ctri-dot.on{background:#f87171;}' +
        '.pd-ctri-dot-plaque.on{background:#60a5fa;}' +
        '.pd-ctable th.pd-gap-col,.pd-ctable td.pd-gap-col{border-left:none;border-right:none;padding:0;background:transparent;}' +
        '.pd-gap-line{width:2px;height:100%;min-height:12px;margin:0 auto;background:rgba(100,116,139,.55);}'
    );
}

/** One compact cell (colspan=1) for tooth-level rows: mobility / implant / furcation. */
function pdCompactSpanCellHtml(row, tn, midline) {
    var cls = midline ? ' class="pd-midline"' : '';
    var implantActive = pdPerioImplantActive(tn);
    if (row.id === 'mob') {
        if (implantActive) return '<td' + cls + ' style="color:#cbd5e1;">—</td>';
        return '<td' + cls + '>' + esc(perioState[tn + '_mob'] || '0') + '</td>';
    }
    if (row.type === 'implant') {
        var iv = pdPerioImplantVal(tn);
        if (!iv) return '<td' + cls + ' style="color:#cbd5e1;">—</td>';
        var implLabels = ['—', chartTr('chart.perio.implant'), '⚠', '✓'];
        var implColors = ['#cbd5e1', '#334155', '#dc2626', '#16a34a'];
        return '<td' + cls + ' style="color:' + implColors[iv] + ';font-weight:700;">' + esc(implLabels[iv]) + '</td>';
    }
    if (row.type === 'furcation') {
        if (implantActive) return '<td' + cls + ' style="color:#cbd5e1;">—</td>';
        var fv = perioState[tn + '_frc'] || '—';
        return '<td' + cls + ' style="color:#b45309;font-weight:700;">' + esc(fv) + '</td>';
    }
    if (row.type === 'text') {
        var nv = perioState[tn + '_note'] || '';
        return '<td' + cls + ' style="font-size:8px;font-weight:500;color:#334155;text-align:left;' +
            'padding-left:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0;">' +
            esc(nv) + '</td>';
    }
    return '<td' + cls + '>—</td>';
}

/** One D/M/Me sub-value, packed tightly inside the parent tooth cell (no borders between sites). */
function pdCompactSiteHtml(row, tn, pos) {
    var key = tn + '_' + row.id + '_' + pos;
    if (row.type === 'bop') {
        var isPlaqueRow = row.id === 'pi_b' || row.id === 'pi_l';
        var dotCls = 'pd-ctri-dot' + (isPlaqueRow ? ' pd-ctri-dot-plaque' : '') +
            (perioState[key] ? ' on' : '');
        return '<span class="' + dotCls + '"></span>';
    }
    if (row.type === 'threeval') {
        var v = perioState[key];
        var cls = (v != null && v >= 4 && row.id.indexOf('pd_') === 0) ? ' class="pd-ctri-deep"' : '';
        return '<span' + cls + '>' + (v != null ? esc(String(v)) : '0') + '</span>';
    }
    if (row.type === 'calc') {
        var cv = perioState[key];
        var cls2 = (cv != null && cv > 3) ? ' class="pd-ctri-deep"' : '';
        return '<span' + cls2 + '>' + (cv != null ? esc(String(cv)) : '0') + '</span>';
    }
    return '<span>—</span>';
}

/** Full compact cell for one tooth — single value (colspan-like) or a tight D/M/Me triple. */
function pdCompactCellHtml(row, tn) {
    if (pdToothIsMissing(tn)) return '<td style="background:#fff;"></td>';
    if (row.type === 'select' || row.type === 'implant' || row.type === 'furcation' || row.type === 'text') {
        return pdCompactSpanCellHtml(row, tn, false);
    }
    var tri = ['d', 'm', 'me'].map(function(pos) { return pdCompactSiteHtml(row, tn, pos); }).join('');
    return '<td><div class="pd-ctri">' + tri + '</div></td>';
}

/** Dedicated midline gap cell — same width as the tooth diagram's own
 *  midline gap (PD_C_MID_GAP), carrying a single centered partition line —
 *  so tooth columns after it land at the exact same x as the diagram.
 *  Width is set explicitly only on the <th> (first row) since table-layout:
 *  fixed derives all columns' widths from that row alone. */
function pdGapCellHtml(tag) {
    var style = tag === 'th' ? ' style="width:' + PD_C_MID_GAP + 'px;"' : '';
    return '<' + tag + ' class="pd-gap-col"' + style + '><div class="pd-gap-line"></div></' + tag + '>';
}

/** One compact grid (subset of rows, one column per tooth) — used above/below the diagram.
 *  Column widths are pinned to the diagram's own per-tooth pitch (PD_C_TOOTH_W+PD_C_GAP)
 *  and midline gap (PD_C_MID_GAP), with the table left at its natural width (no
 *  width:100%) so tooth "15" here sits at the same x as tooth "15" in the diagram. */
function pdBuildCompactTableHtml(rowIds, teeth) {
    var byId = {};
    perioRowDefs().forEach(function(r) { byId[r.id] = r; });
    var toothColW = PD_C_TOOTH_W + PD_C_GAP;
    // table-layout:fixed only reliably honours per-column pixel widths when
    // the table itself also has an explicit total width — otherwise it
    // stretches to fill its container and scales the columns proportionally,
    // breaking the pixel-exact match with the diagram below.
    var totalW = 48 + teeth.length * toothColW + PD_C_MID_GAP;

    var theadTop = '<tr><th style="text-align:left;width:48px;">&nbsp;</th>' +
        teeth.map(function(tn, i) {
            var missing = pdToothIsMissing(tn);
            var gap = i === 8 ? pdGapCellHtml('th') : '';
            return gap + '<th style="width:' + toothColW + 'px;' +
                (missing ? 'color:#9ca3af;text-decoration:line-through;' : '') + '">' +
                esc(pdToothLabel(tn)) + '</th>';
        }).join('') + '</tr>';

    var bodyRows = rowIds.map(function(id) {
        var row = byId[id];
        if (!row) return '';
        var cells = teeth.map(function(tn, i) {
            var gap = i === 8 ? pdGapCellHtml('td') : '';
            return gap + pdCompactCellHtml(row, tn);
        }).join('');
        return '<tr><th>' + esc(chartTr(row.labelKey)) + '</th>' + cells + '</tr>';
    }).join('');

    return '<table class="pd-ctable" style="width:' + totalW + 'px;">' +
        '<thead>' + theadTop + '</thead><tbody>' + bodyRows + '</tbody></table>';
}

/** x (left edge) of tooth at index i in the compact schematic diagram. */
function pdCompactToothX(i) {
    var x = PD_C_AXIS_W + i * (PD_C_TOOTH_W + PD_C_GAP);
    if (i >= 8) x += PD_C_MID_GAP;
    return x;
}

/** Small schematic crown+root silhouette (same tooth-type shapes as the
 *  clinical diagram, re-scaled way down) — purely visual context, no
 *  per-site pocket/GM lines plotted on it. */
function pdCompactToothPath(cx, tn) {
    var geo = TOOTH_TYPE_GEOMETRY[pdToothType(tn)];
    // Blend each tooth type's real wCrownMul (0.42 lateral incisor .. 0.85
    // molar) toward a narrower target-width range (68%..90% of the column
    // pitch) — wide enough that neighbouring crowns nearly meet (touching
    // for molars, a small gap for incisors), without fully overlapping.
    var t = (geo.wCrownMul - 0.42) / (0.85 - 0.42);
    var targetFrac = 0.68 + t * (0.90 - 0.68);
    var fullCrownW = PD_C_TOOTH_W * targetFrac;
    var unit    = fullCrownW / (2 * geo.wCrownMul);
    var wCrown  = unit * geo.wCrownMul;
    var wNeck   = unit * geo.wNeckMul;
    var wApex   = geo.roots === 2 ? 1.6 : 2.0;
    var rootLen = PD_C_ROOT_H * geo.rootMul;
    var top     = -PD_C_CROWN_H;

    var crownPath;
    if (geo.crown === 'canine')        crownPath = pdCrownCanine(cx, wCrown, wNeck, top);
    else if (geo.crown === 'premolar') crownPath = pdCrownPremolar(cx, wCrown, wNeck, top);
    else if (geo.crown === 'molar')    crownPath = pdCrownMolar(cx, wCrown, wNeck, top);
    else                                crownPath = pdCrownIncisor(cx, wCrown, wNeck, top);

    var rootPath = geo.roots === 2
        ? pdRootBifurcated(cx, wNeck, wApex, rootLen)
        : pdRootSingle(cx, wNeck, wApex, rootLen);

    return 'M ' + pdN(cx - wNeck) + ',0 ' + crownPath + rootPath + 'Z';
}

var PD_C_ROW_GAP = 6;   // small vertical gap between the Buccal and Lingual tooth rows
var PD_C_MM_PX   = 4;   // px per "mm" for the fine reference ruling behind each tooth row

/** Fine 1mm-spaced horizontal reference lines spanning the full width of a
 *  tooth row block [top, top+height] — the same lined-paper background used
 *  behind the full pocket-depth diagram, scaled down for the compact panel. */
function pdCompactGridLinesSVG(top, height, width) {
    var lines = '';
    for (var y = top; y <= top + height; y += PD_C_MM_PX) {
        lines += '<line x1="' + PD_C_AXIS_W + '" y1="' + y.toFixed(1) + '" x2="' + width +
            '" y2="' + y.toFixed(1) + '" stroke="#eef1f6" stroke-width="1"/>';
    }
    return lines;
}

/** One tooth row (all teeth), optionally vertically flipped, plus its own
 *  red gum-line reference. Returns {svg, lineY} where lineY is the y of the
 *  reference line within this row's own local (unshifted) coordinate space. */
function pdCompactToothRowSVG(teeth, flipped) {
    var teethSvg = teeth.map(function(tn, i) {
        var cx = pdCompactToothX(i) + PD_C_TOOTH_W / 2;
        if (pdToothIsMissing(tn)) {
            return pdMissingToothHatchSVG(cx, PD_C_TOOTH_W / 2, -PD_C_CROWN_H, PD_C_ROOT_H);
        }
        var implantVal = pdPerioImplantVal(tn);
        if (implantVal > 0) {
            return pdCompactImplantOutlineSVG(cx, tn, implantVal);
        }
        return '<path d="' + pdCompactToothPath(cx, tn) + '" fill="#e8eaee" stroke="#111827" stroke-width="1"/>';
    }).join('');
    // Local origin sits at the root apex end so the whole tooth (crown +
    // root) stays within [0, PD_C_CROWN_H+PD_C_ROOT_H] before any shift.
    var localOriginY = flipped ? PD_C_ROOT_H : PD_C_CROWN_H;
    return {
        group: '<g transform="translate(0,0)">' +
            '<g transform="translate(0,' + localOriginY + ')' + (flipped ? ' scale(1,-1)' : '') + '">' +
                teethSvg + '</g></g>',
        lineY: localOriginY
    };
}

/** One arch's schematic Buccal + Lingual tooth rows, arranged as a mirrored
 *  "upside-down pair" meeting crown-to-crown at the middle — the simplified
 *  diagram sandwiched between the Buccal grid (above) and Lingual grid
 *  (below), the way periodontalchart-online.com shows both surfaces of one
 *  arch back-to-back around a shared gum-line reference. */
function pdCompactArchDiagramSVG(teeth, arch) {
    var width = pdCompactToothX(teeth.length - 1) + PD_C_TOOTH_W + 4;
    var rowH  = PD_C_CROWN_H + PD_C_ROOT_H;

    // Buccal row (top): root points up/away (toward the Buccal grid above),
    // crown points down toward the shared middle line — i.e. flipped.
    var buccalRow  = pdCompactToothRowSVG(teeth, true);
    // Lingual row (bottom): crown points up toward the shared middle line,
    // root points down/away (toward the Lingual grid below) — unflipped.
    var lingualRow = pdCompactToothRowSVG(teeth, false);

    var yBuccalTop  = 0;
    var yLingualTop = rowH + PD_C_ROW_GAP;
    var height = yLingualTop + rowH;

    var lineBuccalY  = yBuccalTop  + buccalRow.lineY;
    var lineLingualY = yLingualTop + lingualRow.lineY;

    // Fine 1mm reference ruling drawn behind the teeth so the pocket-depth
    // diagram (and this schematic mirror of it) always shows the same
    // lined-paper backdrop, per-row, across the full width.
    var gridLines = pdCompactGridLinesSVG(yBuccalTop, rowH, width) +
        pdCompactGridLinesSVG(yLingualTop, rowH, width);

    // Semi-solid light partition marking the dental midline (11/21, 31/41),
    // running the full height of this schematic diagram — aligned with the
    // matching partition drawn through the Buccal/Lingual data tables.
    var midX = pdCompactToothX(8) - PD_C_MID_GAP / 2;
    var midlineLine = '<line x1="' + midX + '" y1="0" x2="' + midX + '" y2="' + height +
        '" stroke="#94a3b8" stroke-width="1.2" stroke-opacity="0.55"/>';

    return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '">' +
        gridLines +
        '<g transform="translate(0,' + yBuccalTop + ')">' + buccalRow.group + '</g>' +
        '<line x1="' + PD_C_AXIS_W + '" y1="' + lineBuccalY + '" x2="' + width + '" y2="' + lineBuccalY +
            '" stroke="#dc2626" stroke-width="1.3"/>' +
        '<text x="1" y="' + (lineBuccalY + 3) + '" font-size="7" font-weight="700" fill="#94a3b8">' +
            esc(chartTr('chart.perio.diagramBuccal').charAt(0)) + '</text>' +
        '<g transform="translate(0,' + yLingualTop + ')">' + lingualRow.group + '</g>' +
        '<line x1="' + PD_C_AXIS_W + '" y1="' + lineLingualY + '" x2="' + width + '" y2="' + lineLingualY +
            '" stroke="#dc2626" stroke-width="1.3"/>' +
        '<text x="1" y="' + (lineLingualY + 3) + '" font-size="7" font-weight="700" fill="#94a3b8">' +
            esc(chartTr('chart.perio.diagramLingual').charAt(0)) + '</text>' +
        midlineLine +
        '</svg>';
}

/** One arch = one panel: Buccal grid → schematic tooth row → Lingual grid,
 *  all sized to one tooth-column-width per tooth so the whole thing fits a
 *  single page width instead of the old 3-columns-per-tooth wide table. */
function pdBuildCompactArchPanelHtml(teeth, arch) {
    var archLabel = arch === 'upper' ? chartTr('chart.upperMaxillary') : chartTr('chart.lowerMandibular');
    return (
        '<div class="pd-cpanel">' +
            '<div class="pd-cpanel-title">' + esc(archLabel) + '</div>' +
            pdBuildCompactTableHtml(PD_COMPACT_TOP_ROWS, teeth) +
            // padding-left shifts the diagram so its own small mm/axis gutter
            // (PD_C_AXIS_W) lines up with the tables' fixed-width row-label
            // column (48px) — keeps the dental-midline partitions aligned.
            '<div class="pd-cpanel-diagram" style="padding-left:' + (48 - PD_C_AXIS_W) + 'px;box-sizing:border-box;">' +
                pdCompactArchDiagramSVG(teeth, arch) +
            '</div>' +
            pdBuildCompactTableHtml(PD_COMPACT_BOTTOM_ROWS, teeth) +
        '</div>'
    );
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
        // GM sign is always literal — a minus means recession, a plain
        // positive number means overgrowth. No settings-based inversion.
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
    var ALL_TEETH = UPPER_RIGHT.concat(UPPER_LEFT, LOWER_RIGHT, LOWER_LEFT);
    var presentTeeth = ALL_TEETH.filter(function(tn) { return !pdToothIsMissing(tn); });

    var bopCount    = 0;
    var plaqueCount = 0;
    var deepCount   = 0;
    var totalSites  = 0;
    var pdVals      = [];
    var calVals     = [];

    // Averages/percentages are scoped to present (non-missing) teeth only —
    // a tooth marked missing no longer counts toward the arch's totals even
    // if it still has old measurements sitting in perioState from before it
    // was extracted.
    presentTeeth.forEach(function(tn) {
        ['b', 'l'].forEach(function(surf) {
            ['d', 'm', 'me'].forEach(function(pos) {
                totalSites++;
                if (pdGetBop(tn, surf, pos)) bopCount++;
                if (perioState[tn + '_pi_' + surf + '_' + pos]) plaqueCount++;

                var pd = pdGetSiteVal(tn, surf, pos, 'pd');
                var gm = pdGetSiteVal(tn, surf, pos, 'gm');
                if (pd > 0) {
                    pdVals.push(pd);
                    if (pd >= 4) deepCount++;
                }
                // CAL = PD − GM (GM stored negative for recession, positive
                // for a coronal margin, 0 at the CEJ) — same formula as
                // calcCAL()/computeTonettiAssessment(). Only counted for
                // sites that actually have a measurement.
                if (pd > 0 || gm !== 0) calVals.push(pd - gm);
            });
        });
    });

    function avg(arr) {
        return arr.length
            ? (arr.reduce(function(a, b) { return a + b; }, 0) / arr.length).toFixed(1)
            : '—';
    }

    var summBOP    = g('summBOP');
    var summDeep   = g('summDeep');
    var summAvg    = g('summAvgPD');
    var summMax    = g('summMaxPD');
    var summAvgCAL = g('summAvgCAL');
    var summBopPct = g('summBopPct');
    var summPiPct  = g('summPiPct');

    if (summBOP)    summBOP.textContent    = bopCount;
    if (summDeep)   summDeep.textContent   = deepCount;
    if (summAvg)    summAvg.textContent    = avg(pdVals);
    if (summMax)    summMax.textContent    = pdVals.length ? Math.max.apply(null, pdVals) : '—';
    if (summAvgCAL) summAvgCAL.textContent = avg(calVals);
    if (summBopPct) summBopPct.textContent = totalSites ? Math.round(bopCount    / totalSites * 100) : 0;
    if (summPiPct)  summPiPct.textContent  = totalSites ? Math.round(plaqueCount / totalSites * 100) : 0;
}

// ════════════════════════════════════════════════════════════════
// POCKET DIAGRAM  (periodontalchart-online.com-style visualisation)
// ════════════════════════════════════════════════════════════════
// Layout constants (all in SVG user units == px at scale 1)
var PD_SITE_W     = 12;   // width per D/M/Me site column — kept narrow (and,
                          // together with the fixed-pixel column widths added
                          // for exact table/diagram midline alignment, slightly
                          // scaled down from 13) so all 16 teeth of an arch,
                          // including the last tooth (18/28/38/48), fit one
                          // page/screen width (the charting pane's own content
                          // column, ~740–810px) without horizontal scrolling
var PD_TOOTH_GAP  = 2;    // gap between adjacent tooth groups
var PD_MID_GAP    = 8;    // extra gap inserted at the midline (after 8 teeth)
var PD_MM_PX      = 8;    // px per millimetre of depth
var PD_MAX_MM     = 14;   // vertical scale range shown (0–14mm)
var PD_AXIS_W     = 20;   // left gutter reserved for the mm scale
var PD_LABEL_H    = 14;   // height of the "Buccal" / "Lingual" caption row
var PD_MID_ROW_H  = 40;   // height of the tooth-number / mob / furcation row
var PD_STRIP_H    = PD_MAX_MM * PD_MM_PX;
var PD_CROWN_H    = 18;   // space above the CEJ (y=0) reserved for the tooth crown outline

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

/** True when a tooth is charted as missing (no tooth outline / data should show). */
function pdToothIsMissing(tn) {
    return !!(dentalState[tn] && dentalState[tn].indexOf('missing') >= 0);
}

/** Perio-chart implant state: 0 = none, 1 = present, 2 = peri-implantitis, 3 = treated. */
function pdPerioImplantVal(tn) {
    return parseInt(perioState[tn + '_implant'], 10) || 0;
}

function pdPerioImplantActive(tn) {
    return pdPerioImplantVal(tn) > 0;
}

/** Mobility and furcation do not apply to implants — clear stored values. */
function pdClearMobFrcForImplant(tn) {
    delete perioState[tn + '_mob'];
    delete perioState[tn + '_frc'];
}

/** True when the dental chart marks this tooth as an implant (whole-tooth tool). */
function pdDentalImplantCharted(tn) {
    var st = dentalState[tn];
    return !!(st && st.indexOf('implant') >= 0);
}

/** Dental → perio: mark implant present (state 1) unless perio already has a grade. */
function pdApplyPerioImplantFromDental(tn) {
    if (!pdPerioImplantActive(tn)) {
        perioState[tn + '_implant'] = 1;
        pdClearMobFrcForImplant(tn);
        return true;
    }
    return false;
}

/** Dental → perio: clear implant when the dental chart removes it. */
function pdRemovePerioImplantFromDental(tn) {
    if (pdPerioImplantActive(tn)) {
        delete perioState[tn + '_implant'];
        return true;
    }
    return false;
}

/** On load / opening perio pane — additive only; never strips perio-only implant grades. */
function pdSyncAllPerioImplantsFromDentalOnLoad() {
    allDentalChartToothNums().forEach(function(tn) {
        if (pdDentalImplantCharted(tn)) pdApplyPerioImplantFromDental(tn);
    });
}

function chartPerioTabActive() {
    var stabP = g('stab-perio');
    return !!(stabP && stabP.classList.contains('active'));
}

/** Click-cycle implant row; blanks mobility/furcation whenever implant is set. */
function pdApplyImplantCycle(tn) {
    var v = (pdPerioImplantVal(tn) + 1) % 4;
    perioState[tn + '_implant'] = v || null;
    if (v > 0) pdClearMobFrcForImplant(tn);
    return v;
}

function pdImplantDisabledCellContent() {
    return '<span style="color:#cbd5e1;font-size:11px;">—</span>';
}

/** Strip mobility/furcation from any tooth already charted as an implant (e.g. on load). */
function pdSanitizeImplantExcludedFields() {
    var allTeeth = UPPER_RIGHT.concat(UPPER_LEFT, LOWER_RIGHT, LOWER_LEFT);
    allTeeth.forEach(function(tn) {
        if (pdPerioImplantActive(tn)) pdClearMobFrcForImplant(tn);
    });
}

/**
 * Click-to-toggle-missing on the tooth number itself, exactly like the
 * reference chart's "Tooth Number – one click marks the tooth as missing".
 * Shares the same dentalState array used by the Dental Chart tab so both
 * views of the same tooth always agree.
 */
function pdToggleMissingTooth(tn) {
    if (!dentalState[tn]) dentalState[tn] = [];
    var idx = dentalState[tn].indexOf('missing');
    if (idx >= 0) {
        dentalState[tn].splice(idx, 1);
        delete dentalState[tn + '_missingReason'];
    } else {
        dentalState[tn].push('missing');
        if (typeof promptMissingToothReason === 'function') promptMissingToothReason(tn);
    }
    if (typeof refreshToothSVG === 'function') refreshToothSVG(tn);
    renderPerioPane();
}

/**
 * Tooth-type geometry, keyed by the FDI tooth-position digit (1–8), which is
 * identical for every quadrant: x1 = central incisor, x2 = lateral incisor,
 * x3 = canine, x4 = 1st premolar, x5 = 2nd premolar, x6 = 1st molar,
 * x7 = 2nd molar, x8 = wisdom tooth (3rd molar). Used to pick a crown/root
 * silhouette so the diagram reads like a real arch instead of identical
 * generic teeth.
 */
var TOOTH_TYPE_GEOMETRY = {
    1: { crown: 'incisor',  wCrownMul: 0.50, wNeckMul: 0.40, rootMul: 0.85, roots: 1 },
    2: { crown: 'incisor',  wCrownMul: 0.42, wNeckMul: 0.34, rootMul: 0.80, roots: 1 },
    3: { crown: 'canine',   wCrownMul: 0.48, wNeckMul: 0.38, rootMul: 0.92, roots: 1 },
    4: { crown: 'premolar', wCrownMul: 0.58, wNeckMul: 0.46, rootMul: 0.85, roots: 1 },
    5: { crown: 'premolar', wCrownMul: 0.56, wNeckMul: 0.44, rootMul: 0.80, roots: 1 },
    6: { crown: 'molar',    wCrownMul: 0.85, wNeckMul: 0.62, rootMul: 0.78, roots: 2 },
    7: { crown: 'molar',    wCrownMul: 0.80, wNeckMul: 0.60, rootMul: 0.72, roots: 2 },
    8: { crown: 'molar',    wCrownMul: 0.72, wNeckMul: 0.55, rootMul: 0.62, roots: 2 }
};

/** FDI tooth-position digit (1–8) is the same for every quadrant (11,21,31,41 → 1, etc). */
function pdToothType(tn) {
    var t = Math.abs(parseInt(tn, 10) || 0) % 10;
    return TOOTH_TYPE_GEOMETRY[t] ? t : 1;
}

function pdN(v) { return v.toFixed(1); }

/** Central/lateral incisor: fairly flat, blade-like incisal edge. */
function pdCrownIncisor(cx, wCrown, wNeck, top) {
    var topBump = top - 2;
    return (
        'C ' + pdN(cx - wNeck) + ',' + pdN(top * 0.5) + ' ' + pdN(cx - wCrown) + ',' + pdN(top * 0.5) + ' ' + pdN(cx - wCrown) + ',' + pdN(top) + ' ' +
        'Q ' + pdN(cx - wCrown) + ',' + pdN(topBump) + ' ' + pdN(cx) + ',' + pdN(topBump) + ' ' +
        'Q ' + pdN(cx + wCrown) + ',' + pdN(topBump) + ' ' + pdN(cx + wCrown) + ',' + pdN(top) + ' ' +
        'C ' + pdN(cx + wCrown) + ',' + pdN(top * 0.5) + ' ' + pdN(cx + wNeck) + ',' + pdN(top * 0.5) + ' ' + pdN(cx + wNeck) + ',0 '
    );
}

/** Canine: single pointed cusp tip — the longest, most pointed crown in the arch. */
function pdCrownCanine(cx, wCrown, wNeck, top) {
    var tipY = top - 3;
    var shoulder = top * 0.78;
    return (
        'C ' + pdN(cx - wNeck) + ',' + pdN(top * 0.55) + ' ' + pdN(cx - wCrown) + ',' + pdN(top * 0.55) + ' ' + pdN(cx - wCrown) + ',' + pdN(shoulder) + ' ' +
        'L ' + pdN(cx) + ',' + pdN(tipY) + ' ' +
        'L ' + pdN(cx + wCrown) + ',' + pdN(shoulder) + ' ' +
        'C ' + pdN(cx + wCrown) + ',' + pdN(top * 0.55) + ' ' + pdN(cx + wNeck) + ',' + pdN(top * 0.55) + ' ' + pdN(cx + wNeck) + ',0 '
    );
}

/** Premolar: two cusps (buccal + lingual) with a shallow central groove. */
function pdCrownPremolar(cx, wCrown, wNeck, top) {
    var cusp   = top - 1;
    var valley = top + 3;
    return (
        'C ' + pdN(cx - wNeck) + ',' + pdN(top * 0.5) + ' ' + pdN(cx - wCrown) + ',' + pdN(top * 0.5) + ' ' + pdN(cx - wCrown) + ',' + pdN(top) + ' ' +
        'Q ' + pdN(cx - wCrown * 0.5) + ',' + pdN(cusp - 2) + ' ' + pdN(cx - wCrown * 0.22) + ',' + pdN(cusp) + ' ' +
        'Q ' + pdN(cx) + ',' + pdN(valley) + ' ' + pdN(cx + wCrown * 0.22) + ',' + pdN(cusp) + ' ' +
        'Q ' + pdN(cx + wCrown * 0.5) + ',' + pdN(cusp - 2) + ' ' + pdN(cx + wCrown) + ',' + pdN(top) + ' ' +
        'C ' + pdN(cx + wCrown) + ',' + pdN(top * 0.5) + ' ' + pdN(cx + wNeck) + ',' + pdN(top * 0.5) + ' ' + pdN(cx + wNeck) + ',0 '
    );
}

/** Molar: wide crown with an undulating multi-cusp occlusal outline. */
function pdCrownMolar(cx, wCrown, wNeck, top) {
    var cusp = top - 1;
    var dip  = top + 3;
    return (
        'C ' + pdN(cx - wNeck) + ',' + pdN(top * 0.4) + ' ' + pdN(cx - wCrown) + ',' + pdN(top * 0.4) + ' ' + pdN(cx - wCrown) + ',' + pdN(top * 0.8) + ' ' +
        'Q ' + pdN(cx - wCrown * 0.7) + ',' + pdN(cusp) + ' ' + pdN(cx - wCrown * 0.45) + ',' + pdN(dip) + ' ' +
        'Q ' + pdN(cx - wCrown * 0.15) + ',' + pdN(cusp) + ' ' + pdN(cx) + ',' + pdN(dip) + ' ' +
        'Q ' + pdN(cx + wCrown * 0.15) + ',' + pdN(cusp) + ' ' + pdN(cx + wCrown * 0.45) + ',' + pdN(dip) + ' ' +
        'Q ' + pdN(cx + wCrown * 0.7) + ',' + pdN(cusp) + ' ' + pdN(cx + wCrown) + ',' + pdN(top * 0.8) + ' ' +
        'C ' + pdN(cx + wCrown) + ',' + pdN(top * 0.4) + ' ' + pdN(cx + wNeck) + ',' + pdN(top * 0.4) + ' ' + pdN(cx + wNeck) + ',0 '
    );
}

/** Single tapering root (incisors, canine, premolars). */
function pdRootSingle(cx, wNeck, wApex, rootLen) {
    return (
        'C ' + pdN(cx + wNeck * 0.9) + ',' + pdN(rootLen * 0.45) + ' ' + pdN(cx + wApex) + ',' + pdN(rootLen * 0.8) + ' ' + pdN(cx + wApex) + ',' + pdN(rootLen) + ' ' +
        'Q ' + pdN(cx + wApex * 0.3) + ',' + pdN(rootLen + 3) + ' ' + pdN(cx) + ',' + pdN(rootLen + 3) + ' ' +
        'Q ' + pdN(cx - wApex * 0.3) + ',' + pdN(rootLen + 3) + ' ' + pdN(cx - wApex) + ',' + pdN(rootLen) + ' ' +
        'C ' + pdN(cx - wApex) + ',' + pdN(rootLen * 0.8) + ' ' + pdN(cx - wNeck * 0.9) + ',' + pdN(rootLen * 0.45) + ' ' + pdN(cx - wNeck) + ',0 '
    );
}

/** Bifurcated/trifurcated root (molars) — two diverging root cones with a furcation notch. */
function pdRootBifurcated(cx, wNeck, wApex, rootLen) {
    var forkY  = rootLen * 0.25;
    var spread = wNeck * 0.85;
    return (
        'C ' + pdN(cx + wNeck * 0.95) + ',' + pdN(forkY * 0.5) + ' ' + pdN(cx + wNeck * 0.9) + ',' + pdN(forkY) + ' ' + pdN(cx + wNeck * 0.75) + ',' + pdN(forkY * 1.2) + ' ' +
        'C ' + pdN(cx + spread * 1.15) + ',' + pdN(rootLen * 0.55) + ' ' + pdN(cx + spread * 1.05) + ',' + pdN(rootLen * 0.85) + ' ' + pdN(cx + spread * 0.55) + ',' + pdN(rootLen * 0.98) + ' ' +
        'Q ' + pdN(cx + spread * 0.25) + ',' + pdN(rootLen) + ' ' + pdN(cx + spread * 0.05) + ',' + pdN(rootLen * 0.92) + ' ' +
        'L ' + pdN(cx) + ',' + pdN(forkY * 1.35) + ' ' +
        'L ' + pdN(cx - spread * 0.05) + ',' + pdN(rootLen * 0.92) + ' ' +
        'Q ' + pdN(cx - spread * 0.25) + ',' + pdN(rootLen) + ' ' + pdN(cx - spread * 0.55) + ',' + pdN(rootLen * 0.98) + ' ' +
        'C ' + pdN(cx - spread * 1.05) + ',' + pdN(rootLen * 0.85) + ' ' + pdN(cx - spread * 1.15) + ',' + pdN(rootLen * 0.55) + ' ' + pdN(cx - wNeck * 0.75) + ',' + pdN(forkY * 1.2) + ' ' +
        'C ' + pdN(cx - wNeck * 0.9) + ',' + pdN(forkY) + ' ' + pdN(cx - wNeck * 0.95) + ',' + pdN(forkY * 0.5) + ' ' + pdN(cx - wNeck) + ',0 '
    );
}

/**
 * Crown+root silhouette for one tooth, centred on cx, with the CEJ
 * (cemento-enamel junction) at local y=0 — crown above (negative y), root(s)
 * tapering to an apex below (positive y). Shape varies by tooth type
 * (incisor / canine / premolar / molar with forked roots) so the diagram
 * reads like a real arch, the way periodontalchart-online.com and
 * Florida-Probe-style charts do. Purely decorative anatomical context —
 * the GM/AL/pocket lines are plotted independently on top.
 */
function pdToothOutlinePath(cx, tn) {
    var geo = TOOTH_TYPE_GEOMETRY[pdToothType(tn)];
    // Blend each tooth type's real wCrownMul (0.42 lateral incisor .. 0.85
    // molar) toward a narrower target-width range (68%..90% of the
    // tooth-column pitch) — the same treatment as the compact schematic
    // diagram in the middle of the data-charting table — so neighbouring
    // crowns nearly meet (touching for molars, a small gap for incisors)
    // instead of each sitting alone in the middle of its 3-site column.
    var pitch = 3 * PD_SITE_W + PD_TOOTH_GAP;
    var t = (geo.wCrownMul - 0.42) / (0.85 - 0.42);
    var targetFrac = 0.68 + t * (0.90 - 0.68);
    var fullCrownW = pitch * targetFrac;
    var unit    = fullCrownW / (2 * geo.wCrownMul);
    var wCrown  = unit * geo.wCrownMul;
    var wNeck   = unit * geo.wNeckMul;
    var wApex   = geo.roots === 2 ? 2.0 : 2.4;
    var rootLen = PD_STRIP_H * geo.rootMul;
    var top     = -PD_CROWN_H;

    var crownPath;
    if (geo.crown === 'canine')        crownPath = pdCrownCanine(cx, wCrown, wNeck, top);
    else if (geo.crown === 'premolar') crownPath = pdCrownPremolar(cx, wCrown, wNeck, top);
    else if (geo.crown === 'molar')    crownPath = pdCrownMolar(cx, wCrown, wNeck, top);
    else                                crownPath = pdCrownIncisor(cx, wCrown, wNeck, top);

    var rootPath = geo.roots === 2
        ? pdRootBifurcated(cx, wNeck, wApex, rootLen)
        : pdRootSingle(cx, wNeck, wApex, rootLen);

    return 'M ' + pdN(cx - wNeck) + ',0 ' + crownPath + rootPath + 'Z';
}

/** Shared crown-width geometry for clinical + compact perio tooth silhouettes. */
function pdToothSilhouetteDims(tn, columnPitch, crownHConst, rootLenConst) {
    var geo = TOOTH_TYPE_GEOMETRY[pdToothType(tn)];
    var t = (geo.wCrownMul - 0.42) / (0.85 - 0.42);
    var targetFrac = 0.68 + t * (0.90 - 0.68);
    var fullCrownW = columnPitch * targetFrac;
    var unit = fullCrownW / (2 * geo.wCrownMul);
    return {
        geo: geo,
        wCrown: unit * geo.wCrownMul,
        wNeck: unit * geo.wNeckMul,
        rootLen: rootLenConst * geo.rootMul,
        top: -crownHConst
    };
}

function pdImplantFixtureColors(implantVal) {
    if (implantVal === 2) {
        return { crown: '#fef2f2', fixture: '#fecaca', stroke: '#dc2626', thread: '#ef4444' };
    }
    if (implantVal === 3) {
        return { crown: '#f0fdf4', fixture: '#bbf7d0', stroke: '#16a34a', thread: '#22c55e' };
    }
    return { crown: '#f8fafc', fixture: '#cbd5e1', stroke: '#475569', thread: '#64748b' };
}

/**
 * Implant fixture + abutment below the crown CEJ (y=0), replacing natural root(s).
 * Thread marks suggest a screw body; crown shape is drawn separately on top.
 */
function pdImplantFixturePath(cx, dims, implantVal) {
    var wNeck = dims.wNeck;
    var rootLen = dims.rootLen;
    var wAbut = wNeck * 0.72;
    var wBody = wNeck * 0.46;
    var wApex = wNeck * 0.28;
    var abutLen = Math.min(5, rootLen * 0.12);
    var bodyLen = rootLen - abutLen;
    var cols = pdImplantFixtureColors(implantVal);
    var abutPath =
        'M ' + pdN(cx - wNeck) + ',0 ' +
        'L ' + pdN(cx - wAbut) + ',' + pdN(abutLen) + ' ' +
        'L ' + pdN(cx + wAbut) + ',' + pdN(abutLen) + ' ' +
        'L ' + pdN(cx + wNeck) + ',0 Z';
    var bodyPath =
        'M ' + pdN(cx - wAbut) + ',' + pdN(abutLen) + ' ' +
        'C ' + pdN(cx - wBody) + ',' + pdN(abutLen + bodyLen * 0.35) + ' ' +
           pdN(cx - wApex) + ',' + pdN(abutLen + bodyLen * 0.75) + ' ' +
           pdN(cx - wApex) + ',' + pdN(rootLen) + ' ' +
        'Q ' + pdN(cx) + ',' + pdN(rootLen + 2) + ' ' + pdN(cx + wApex) + ',' + pdN(rootLen) + ' ' +
        'C ' + pdN(cx + wApex) + ',' + pdN(abutLen + bodyLen * 0.75) + ' ' +
           pdN(cx + wBody) + ',' + pdN(abutLen + bodyLen * 0.35) + ' ' +
           pdN(cx + wAbut) + ',' + pdN(abutLen) + ' Z';
    var threads = '';
    for (var ty = abutLen + 3; ty < rootLen - 2; ty += 5) {
        var spread = wBody * (1 - (ty - abutLen) / (rootLen - abutLen) * 0.35);
        threads += '<line x1="' + pdN(cx - spread) + '" y1="' + pdN(ty) + '" x2="' +
            pdN(cx + spread) + '" y2="' + pdN(ty) + '" stroke="' + cols.thread +
            '" stroke-width="0.9" opacity="0.55"/>';
    }
    return (
        '<path d="' + abutPath + '" fill="' + cols.fixture + '" stroke="' + cols.stroke + '" stroke-width="1.1"/>' +
        '<path d="' + bodyPath + '" fill="' + cols.fixture + '" stroke="' + cols.stroke + '" stroke-width="1.1"/>' +
        threads
    );
}

/** Crown + implant fixture SVG for one tooth (clinical pocket diagram scale). */
function pdImplantOutlineSVG(cx, tn, implantVal) {
    var pitch = 3 * PD_SITE_W + PD_TOOTH_GAP;
    var dims = pdToothSilhouetteDims(tn, pitch, PD_CROWN_H, PD_STRIP_H);
    var geo = dims.geo;
    var cols = pdImplantFixtureColors(implantVal);
    var crownPath;
    if (geo.crown === 'canine')        crownPath = pdCrownCanine(cx, dims.wCrown, dims.wNeck, dims.top);
    else if (geo.crown === 'premolar') crownPath = pdCrownPremolar(cx, dims.wCrown, dims.wNeck, dims.top);
    else if (geo.crown === 'molar')    crownPath = pdCrownMolar(cx, dims.wCrown, dims.wNeck, dims.top);
    else                                crownPath = pdCrownIncisor(cx, dims.wCrown, dims.wNeck, dims.top);
    return (
        '<path d="M ' + pdN(cx - dims.wNeck) + ',0 ' + crownPath + 'Z" fill="' + cols.crown +
            '" stroke="#111827" stroke-width="1.3"/>' +
        pdImplantFixturePath(cx, dims, implantVal)
    );
}

/** Crown + implant fixture SVG for compact schematic diagram scale. */
function pdCompactImplantOutlineSVG(cx, tn, implantVal) {
    var dims = pdToothSilhouetteDims(tn, PD_C_TOOTH_W, PD_C_CROWN_H, PD_C_ROOT_H);
    var geo = dims.geo;
    var cols = pdImplantFixtureColors(implantVal);
    var crownPath;
    if (geo.crown === 'canine')        crownPath = pdCrownCanine(cx, dims.wCrown, dims.wNeck, dims.top);
    else if (geo.crown === 'premolar') crownPath = pdCrownPremolar(cx, dims.wCrown, dims.wNeck, dims.top);
    else if (geo.crown === 'molar')    crownPath = pdCrownMolar(cx, dims.wCrown, dims.wNeck, dims.top);
    else                                crownPath = pdCrownIncisor(cx, dims.wCrown, dims.wNeck, dims.top);
    return (
        '<path d="M ' + pdN(cx - dims.wNeck) + ',0 ' + crownPath + 'Z" fill="' + cols.crown +
            '" stroke="#111827" stroke-width="1"/>' +
        pdImplantFixturePath(cx, dims, implantVal)
    );
}

/**
 * Diagonal hatch block standing in for a missing tooth's silhouette — a
 * light-grey box, the same footprint (column width × full crown+root
 * height) the tooth outline would otherwise occupy, filled with 45°
 * parallel "crossed out" lines. Used by both the main clinical diagram
 * and the compact schematic mirror diagram so a missing tooth always
 * reads clearly as "no tooth here" instead of leaving a blank gap.
 */
function pdMissingToothHatchSVG(cx, halfW, top, bottom) {
    var x0 = cx - halfW, x1 = cx + halfW;
    var w = x1 - x0, h = bottom - top;
    var lines = '';
    for (var d = -h; d <= w; d += 6) {
        lines += '<line x1="' + (x0 + d).toFixed(1) + '" y1="' + top.toFixed(1) +
            '" x2="' + (x0 + d + h).toFixed(1) + '" y2="' + bottom.toFixed(1) +
            '" stroke="#9ca3af" stroke-width="1.2"/>';
    }
    var clipId = 'pdMissHatch' + (pdMissingHatchSeq++);
    return '<clipPath id="' + clipId + '"><rect x="' + x0.toFixed(1) + '" y="' + top.toFixed(1) +
            '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"/></clipPath>' +
        '<rect x="' + x0.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) +
            '" height="' + h.toFixed(1) + '" fill="#fafafa" stroke="#cbd5e1" stroke-width="1"/>' +
        '<g clip-path="url(#' + clipId + ')">' + lines + '</g>';
}
var pdMissingHatchSeq = 0;

/**
 * Tooth-outline layer (all teeth in the arch) for one strip — rendered
 * first, as background. Each tooth uses its real crown/root shape by type.
 * Vertical orientation (crown up vs crown down) is handled by the caller
 * (pdStripSVG), which flips the whole strip — outline plus measurement
 * lines together — for the upper arch, matching how upper teeth actually
 * look when seen from inside the mouth.
 */
function pdToothOutlineSVG(teeth) {
    var out = '';
    teeth.forEach(function(tn, i) {
        var cx = PD_AXIS_W + pdToothX(i) + 1.5 * PD_SITE_W;
        if (pdToothIsMissing(tn)) {
            out += pdMissingToothHatchSVG(cx, 1.5 * PD_SITE_W, -PD_CROWN_H, PD_STRIP_H);
            return;
        }
        var implantVal = pdPerioImplantVal(tn);
        if (implantVal > 0) {
            out += pdImplantOutlineSVG(cx, tn, implantVal);
            return;
        }
        out += '<path d="' + pdToothOutlinePath(cx, tn) + '" ' +
            'fill="#ffffff" stroke="#111827" stroke-width="1.3"/>';
    });
    return out;
}

/** Builds the {x, gm, al, bop} site-point series for one arch + surface. */
function pdBuildPoints(teeth, surface) {
    var pts = [];
    teeth.forEach(function(tn, i) {
        ['d', 'm', 'me'].forEach(function(pos, s) {
            // Stored GM convention: negative = recession (margin apical to
            // the CEJ, root exposed), positive = overgrowth (margin coronal
            // to the CEJ). The diagram's y-axis increases *downward* from
            // the CEJ (y=0), so the plotted gum-line y must be the negation
            // of the stored value — recession (negative raw) needs to draw
            // further down/deeper (positive y), overgrowth further up.
            var gmRaw = pdGetSiteVal(tn, surface, pos, 'gm');
            var pd = pdGetSiteVal(tn, surface, pos, 'pd');
            pts.push({
                x:   pdSiteX(i, s),
                gm:  -gmRaw,
                al:  pd - gmRaw,
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

/**
 * SVG markup for one horizontal strip (buccal or lingual) — local coord
 * space, y=0 is the CEJ. When flip is true, the whole strip (tooth outline,
 * pocket shading, GM/AL lines, bone line, BOP dots — everything except the
 * mm grid-line text) is mirrored vertically so the crown points down and
 * the root points up. The Buccal strip is always drawn flipped and the
 * Lingual/Palatal strip always drawn normal, so the two strips meet
 * crown-to-crown around the shared mid-row — the "mirror style two-side"
 * tooth diagram, matching periodontalchart-online.com. Text stays upright
 * by being drawn outside the flipped group at its already-mirrored position.
 */
function pdStripSVG(pts, width, teeth, flip) {
    flip = !!flip;
    var outline = teeth ? pdToothOutlineSVG(teeth) : '';
    // Reference ruling: fine 1mm horizontal lines run the full height of the
    // tooth diagram — across the crown zone too, not just the pocket/root
    // zone — matching the lined-paper background of the reference chart.
    var gridLines = '';
    var gridText  = '';
    var crownMm = Math.ceil(PD_CROWN_H / PD_MM_PX);
    for (var mm = -crownMm; mm <= PD_MAX_MM; mm++) {
        var y = mm * PD_MM_PX;
        gridLines += '<line x1="0" y1="' + y.toFixed(1) + '" x2="' + (width - 2) +
            '" y2="' + y.toFixed(1) + '" stroke="#eef1f6" stroke-width="1"/>';
        if (mm >= 0 && mm % 2 === 0) {
            var ty = flip ? -y - 1 : y + 3;
            gridText += '<text x="1" y="' + ty.toFixed(1) + '" font-size="8" fill="#aaa">' + mm + '</text>';
        }
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
    // Pocket depth (shaded light blue) + attachment level (blue line) are the
    // "soul" of the chart — they must always plot immediately against the
    // tooth outline underneath; GM = red (gum line), AL/pocket outline = blue.
    var shapes = outline + gridLines +
        '<path d="' + pdPocketPath(pts) + '" fill="#bfe3ff" fill-opacity="0.55" stroke="none"/>' +
        '<polyline points="' + pdPolylinePoints(pts, 'gm') + '" fill="none" stroke="#dc2626" stroke-width="1.8"/>' +
        '<polyline points="' + pdPolylinePoints(pts, 'al') + '" fill="none" stroke="#2563eb" stroke-width="1.8"/>' +
        boneLine +
        bop;
    if (flip) shapes = '<g transform="scale(1,-1)">' + shapes + '</g>';
    return shapes + gridText;
}

/** SVG markup for the tooth-number / mobility / furcation row between the two strips. */
/**
 * Standard furcation-involvement symbol: an open circle for Grade I
 * (incipient bone loss into the furcation), a half-filled circle for
 * Grade II (cul-de-sac), and a fully filled circle for Grade III
 * (through-and-through) — the same convention shown on the reference
 * periodontal chart, rather than plain "I/II/III" text.
 */
function pdFurcationSymbolSVG(cx, cy, grade) {
    if (!grade || grade === '—' || grade === '-') return '';
    var r = 4;
    var col = '#b45309';
    if (grade === 'I') {
        return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
            '" fill="none" stroke="' + col + '" stroke-width="1.3"/>';
    }
    if (grade === 'II') {
        return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
                '" fill="none" stroke="' + col + '" stroke-width="1.3"/>' +
            '<path d="M ' + cx + ',' + (cy - r) + ' A ' + r + ',' + r +
                ' 0 0 1 ' + cx + ',' + (cy + r) + ' Z" fill="' + col + '"/>';
    }
    // Grade III (or higher): fully filled — through-and-through involvement.
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
        '" fill="' + col + '" stroke="' + col + '" stroke-width="1"/>';
}

function pdMidRowSVG(teeth) {
    var out = '';
    teeth.forEach(function(tn, i) {
        var cx  = PD_AXIS_W + pdToothX(i) + 1.5 * PD_SITE_W;
        var implantVal = pdPerioImplantVal(tn);
        var mob = perioState[tn + '_mob'];
        var frc = perioState[tn + '_frc'];
        var hasMob = !implantVal && mob && mob !== '0';
        out += '<text x="' + cx + '" y="15" font-size="11" font-weight="700" ' +
            'text-anchor="middle" fill="#1d4ed8">' + esc(pdToothLabel(tn)) + '</text>';
        if (implantVal > 0) {
            var implColors = ['', '#334155', '#dc2626', '#16a34a'];
            out += '<circle cx="' + (cx + 12) + '" cy="10" r="3.2" fill="none" ' +
                'stroke="' + implColors[implantVal] + '" stroke-width="1.4"/>';
        }
        if (hasMob) {
            out += '<text x="' + cx + '" y="27" font-size="9" font-weight="700" ' +
                'text-anchor="middle" fill="#7c3aed">' + esc(String(mob)) + '</text>';
        }
        if (!implantVal) out += pdFurcationSymbolSVG(cx, 34, frc);
    });
    // The dental-midline partition itself is now drawn once, full height,
    // by the caller (pdBuildArchDiagramSVG) so it runs continuously through
    // this mid-row instead of being a separate short dashed segment.
    return out;
}

/**
 * Full pocket-diagram SVG markup for one arch: Buccal strip / tooth row /
 * Lingual strip — the "mirror style two-side" layout matching
 * periodontalchart-online.com. The Buccal strip is always drawn flipped
 * (crown pointing down) and the Lingual/Palatal strip always drawn normal
 * (crown pointing up), so the two strips meet crown-to-crown around the
 * shared tooth-number/mobility/furcation mid-row in between — regardless
 * of upper vs lower arch.
 */
function pdBuildArchDiagramSVG(teeth, arch) {
    var width  = PD_AXIS_W + pdToothX(teeth.length - 1) + 3 * PD_SITE_W + 8;
    var stripBlockH = PD_CROWN_H + PD_STRIP_H;
    var totalH = PD_LABEL_H + stripBlockH + PD_MID_ROW_H + PD_LABEL_H + stripBlockH;

    var buccalPts  = pdBuildPoints(teeth, 'b');
    var lingualPts = pdBuildPoints(teeth, 'l');

    // Buccal: CEJ anchor sits near the BOTTOM of its block (crown-side),
    // flipped, so the crown points down toward the mid-row gap.
    var yBuccalStrip  = PD_LABEL_H + PD_STRIP_H;
    var yMidRow       = PD_LABEL_H + stripBlockH;
    var yLingualLabel = yMidRow + PD_MID_ROW_H;
    // Lingual/Palatal: CEJ anchor sits near the TOP of its block, normal
    // (unflipped), so the crown points up toward the same mid-row gap.
    var yLingualStrip = yLingualLabel + PD_LABEL_H + PD_CROWN_H;

    // Semi-solid light partition marking the dental midline (11/21, 31/41),
    // running the full height of the diagram — aligned with the matching
    // partition drawn through the Buccal/Lingual data-charting grids.
    var midX = PD_AXIS_W + pdToothX(8) - PD_MID_GAP / 2;
    var midlineLine = '<line x1="' + midX + '" y1="0" x2="' + midX + '" y2="' + totalH +
        '" stroke="#94a3b8" stroke-width="1.4" stroke-opacity="0.55"/>';

    return '<svg viewBox="0 0 ' + width + ' ' + totalH + '" width="' + width +
        '" height="' + totalH + '" style="display:block;background:#fff;">' +
        '<text x="1" y="' + (PD_LABEL_H - 3) + '" font-size="9" font-weight="700" ' +
            'fill="#64748b">' + esc(chartTr('chart.perio.diagramBuccal')) + '</text>' +
        '<g transform="translate(0,' + yBuccalStrip + ')">' + pdStripSVG(buccalPts, width, teeth, true) + '</g>' +
        '<g transform="translate(0,' + yMidRow + ')">' + pdMidRowSVG(teeth) + '</g>' +
        '<text x="1" y="' + (yLingualLabel + PD_LABEL_H - 3) + '" font-size="9" font-weight="700" ' +
            'fill="#64748b">' + esc(chartTr('chart.perio.diagramLingual')) + '</text>' +
        '<g transform="translate(0,' + yLingualStrip + ')">' + pdStripSVG(lingualPts, width, teeth, false) + '</g>' +
        midlineLine +
        '</svg>';
}

/** DOM wrapper (horizontally scrollable) around one arch's pocket-diagram
 *  SVG. Given a stable id ('perioArchDiagramWrap-upper'/'-lower') so
 *  refreshPerioLivePreview() can find and redraw it in place wherever it's
 *  mounted (inside the compact per-arch panel, sandwiched between the
 *  Buccal and Lingual grids). */
function buildPerioArchDiagram(teeth, arch) {
    var wrap = document.createElement('div');
    wrap.className = 'perio-diagram-wrap';
    wrap.id = 'perioArchDiagramWrap-' + arch;
    wrap.style.cssText =
        'overflow-x:auto;border:1px solid #e0e6ed;border-radius:10px;' +
        'background:#fff;padding:6px 4px;margin:4px 0;' +
        // Shift the diagram right so its own small mm-scale gutter (PD_AXIS_W)
        // lines up exactly with the Buccal/Lingual tables' 100px row-label
        // column (minus this wrapper's own 1px border) — combined with the
        // tables' tooth-column widths being pinned to the same per-tooth
        // pitch as the diagram, tooth "15" here sits at the same x as tooth
        // "15" in the grids above/below.
        'padding-left:' + (100 - PD_AXIS_W - 1) + 'px;';
    wrap.innerHTML = pdBuildArchDiagramSVG(teeth, arch);
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
                // GM: negative = receded (root exposed), positive = coronal to CEJ —
                // CAL = PD - GM, consistent with calcCAL()/pdBuildPoints() elsewhere.
                var cal = pd - gm;
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

    var upperSVG = pdBuildArchDiagramSVG(UPPER_RIGHT.concat(UPPER_LEFT), 'upper');
    var lowerSVG = pdBuildArchDiagramSVG(LOWER_RIGHT.concat(LOWER_LEFT), 'lower');
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
        '@media print { .arch-block { page-break-inside:avoid; } }' +
        '.pd-print-page2 { page-break-before:always; }' +
        pdDataTableCss() +
        pdCompactDataCss();

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
        '<div class="pd-print-page2">' +
            pdBuildDataTablePageHtml(patientName, clinicName, date) +
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

    var upperSVG = pdBuildArchDiagramSVG(UPPER_RIGHT.concat(UPPER_LEFT), 'upper');
    var lowerSVG = pdBuildArchDiagramSVG(LOWER_RIGHT.concat(LOWER_LEFT), 'lower');

    // Page 1: the pocket-diagram chart (SVG) + legend + Tonetti summary.
    var diagramPageHtml =
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

    // Page 2: the numeric data-entry table (own page, own <style> block so it
    // renders correctly inside PDFEDITOR's isolated export iframe).
    var dataTablePageHtml =
        '<style>' + pdDataTableCss() + pdCompactDataCss() + '</style>' +
        pdBuildDataTablePageHtml(patientName, clinicName, date);

    var docName = chartTrRepl('chart.perio.archiveDocName', { DATE: date });

    PDFEDITOR.exportFormsHtmlToPatient({
        patientId: chartPatientId,
        htmlPages: [diagramPageHtml, dataTablePageHtml],
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
        perio_notes:   perNotes || null,
        doctor_id:     (typeof currentDoctorId !== 'undefined' && currentDoctorId) ? currentDoctorId : null,
        doctor_name:   (typeof currentDoctorName !== 'undefined' && currentDoctorName)
                           ? String(currentDoctorName).trim() : null
    };

    function doSave(p, retried) {
        var promise = chartRecordId
            ? SB.from('dental_charts').update(p).eq('id', chartRecordId)
            : SB.from('dental_charts').insert([p]).select();

        return promise.then(function(r) {
            if (r.error) {
                // Graceful degrade: if doctor_id/doctor_name columns haven't
                // been added yet (see dental_charts.sql), drop them and retry
                // once rather than failing the whole save.
                var msg = String(r.error.message || '').toLowerCase();
                if (!retried && (msg.indexOf('doctor_id') >= 0 || msg.indexOf('doctor_name') >= 0)) {
                    var p2 = Object.assign({}, p);
                    delete p2.doctor_id;
                    delete p2.doctor_name;
                    return doSave(p2, true);
                }
                alert(chartTrRepl('chart.alert.saveError', { MSG: r.error.message }));
                return;
            }
            if (!chartRecordId && r.data && r.data[0]) {
                chartRecordId = r.data[0].id;
            }
            showChartToast(chartTrRepl('chart.toast.saved', { DATE: date }));
        });
    }

    doSave(payload, false);
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
        pdSyncAllPerioImplantsFromDentalOnLoad();
        pdSanitizeImplantExcludedFields();

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

// ════════════════════════════════════════════════════════════════
// CHART HISTORY  (mini save/load/delete list, per patient)
// ════════════════════════════════════════════════════════════════
function openChartHistoryModal() {
    if (!chartPatientId) { alert(chartTr('chart.alert.noPatient')); return; }
    if (typeof openModal === 'function') openModal('chartHistoryModal');
    loadChartHistoryList();
}

function loadChartHistoryList() {
    var body = g('chartHistoryBody');
    if (!body) return;
    body.innerHTML = '<p style="padding:14px;color:#64748b;text-align:center;">' +
        esc(chartTr('chart.history.loading')) + '</p>';

    function doLoad(cols, retried) {
        return SB.from('dental_charts')
            .select(cols)
            .eq('patient_id', chartPatientId)
            .order('chart_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(100)
        .then(function(r) {
            if (r.error) {
                // Graceful degrade: older Supabase projects that haven't run
                // the doctor_id/doctor_name migration (see dental_charts.sql)
                // would otherwise fail this whole query — drop that column
                // and retry once so the list still loads.
                var msg = String(r.error.message || '').toLowerCase();
                if (!retried && msg.indexOf('doctor_name') >= 0) {
                    return doLoad('id,chart_date,dental_notes,perio_notes,updated_at,created_at', true);
                }
                body.innerHTML = '<p style="padding:14px;color:#b91c1c;text-align:center;">' +
                    esc(chartTrRepl('chart.history.loadError', { MSG: r.error.message })) + '</p>';
                return;
            }
            renderChartHistoryList(r.data || []);
        });
    }

    doLoad('id,chart_date,dental_notes,perio_notes,doctor_name,updated_at,created_at', false);
}

function chartHistoryRemarksText(row) {
    var parts = [];
    if (row.dental_notes) parts.push(String(row.dental_notes).trim());
    if (row.perio_notes)  parts.push(String(row.perio_notes).trim());
    var s = parts.filter(Boolean).join(' · ');
    if (!s) return '';
    return s.length > 90 ? s.slice(0, 89) + '…' : s;
}

function renderChartHistoryList(rows) {
    var body = g('chartHistoryBody');
    if (!body) return;

    if (!rows.length) {
        body.innerHTML = '<p style="padding:20px;color:#94a3b8;text-align:center;">' +
            esc(chartTr('chart.history.empty')) + '</p>';
        return;
    }

    body.innerHTML = '';
    rows.forEach(function(row) {
        var dateLbl = row.chart_date || '—';
        var drLbl   = row.doctor_name ? String(row.doctor_name).trim() : '';
        var remarks = chartHistoryRemarksText(row);
        var isCurrent = chartRecordId && String(chartRecordId) === String(row.id);

        var item = document.createElement('div');
        item.className = 'chart-hist-item';
        item.title = chartTr('chart.history.rowClickHint');
        item.style.cssText =
            'background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;' +
            'margin-bottom:8px;display:flex;flex-wrap:wrap;gap:8px;' +
            'align-items:center;justify-content:space-between;' +
            (isCurrent ? 'border-color:var(--primary);background:#f0f4ff;' : '');

        item.innerHTML =
            '<div style="flex:1;min-width:200px;">' +
                '<div style="font-weight:700;font-size:13px;color:#111827;">' +
                    esc(dateLbl) +
                    (isCurrent
                        ? ' <span style="font-size:10px;font-weight:700;color:var(--primary);">' +
                          esc(chartTr('chart.history.current')) + '</span>'
                        : '') +
                '</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:2px;">' +
                    esc(drLbl ? chartTrRepl('chart.history.byDoctor', { NAME: drLbl })
                              : chartTr('chart.history.noDoctor')) +
                '</div>' +
                (remarks
                    ? '<div style="font-size:11px;color:#475569;margin-top:3px;">' + esc(remarks) + '</div>'
                    : '') +
            '</div>' +
            '<button type="button" class="chart-hist-delete" ' +
                    'title="' + esc(chartTr('chart.history.deleteTitle')) + '" ' +
                    'style="width:24px;height:24px;line-height:22px;padding:0;' +
                    'border:none;background:transparent;color:#dc2626;' +
                    'font-size:17px;font-weight:700;cursor:pointer;text-align:center;flex-shrink:0;">×</button>';

        item.addEventListener('click', function() {
            loadChartHistoryRow(row);
        });
        item.querySelector('.chart-hist-delete').addEventListener('click', function(ev) {
            ev.stopPropagation();
            deleteChartHistoryRow(row);
        });

        body.appendChild(item);
    });
}

function loadChartHistoryRow(row) {
    var dateEl = g('chartDateInput');
    if (dateEl) dateEl.value = row.chart_date;
    chartDate = row.chart_date;
    if (typeof closeModal === 'function') closeModal('chartHistoryModal');
    loadChartRecord();
}

function deleteChartHistoryRow(row) {
    chartConfirmDialog(chartTrRepl('chart.history.confirmDelete', { DATE: row.chart_date || '' }), function() {
        SB.from('dental_charts').delete().eq('id', row.id)
        .then(function(r) {
            if (r.error) {
                alert(chartTrRepl('chart.history.deleteError', { MSG: r.error.message }));
                return;
            }
            // If we just deleted the record currently loaded on screen, reset
            // the chart back to blank so stale in-memory state isn't re-saved.
            if (chartRecordId && String(chartRecordId) === String(row.id)) {
                var dateEl = g('chartDateInput');
                if (dateEl) dateEl.value = row.chart_date;
                loadChartRecord();
            }
            showChartToast(chartTrRepl('chart.history.deleted', { DATE: row.chart_date || '' }));
            loadChartHistoryList();
        });
    });
}

/** Small styled Yes/No confirmation overlay (used instead of the plain
 *  native confirm() so destructive actions like deleting a chart history
 *  entry get a clear, on-brand prompt). Calls onYes() only if confirmed. */
function chartConfirmDialog(message, onYes) {
    var old = g('chartConfirmOverlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'chartConfirmOverlay';
    overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100000;' +
        'display:flex;align-items:center;justify-content:center;';

    var box = document.createElement('div');
    box.style.cssText =
        'background:#fff;border-radius:12px;padding:22px 24px;max-width:340px;width:90%;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.25);text-align:center;';

    var msgEl = document.createElement('div');
    msgEl.style.cssText = 'font-size:14px;color:#1e293b;margin-bottom:18px;line-height:1.5;';
    msgEl.textContent = message;
    box.appendChild(msgEl);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    var noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.textContent = chartTr('chart.confirm.no');
    noBtn.style.cssText =
        'padding:8px 20px;border-radius:8px;border:1px solid #d1d5db;background:#fff;' +
        'color:#334155;font-weight:600;cursor:pointer;font-size:13px;';
    noBtn.addEventListener('click', close);

    var yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.textContent = chartTr('chart.confirm.yes');
    yesBtn.style.cssText =
        'padding:8px 20px;border-radius:8px;border:none;background:#dc2626;' +
        'color:#fff;font-weight:700;cursor:pointer;font-size:13px;';
    yesBtn.addEventListener('click', function() { close(); onYes(); });

    btnRow.appendChild(noBtn);
    btnRow.appendChild(yesBtn);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    yesBtn.focus();
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
