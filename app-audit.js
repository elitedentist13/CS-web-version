// ════════════════════════════════════════════════════════════════
// app-audit.js — Audit trail logging (writes to audit_trail table)
// Load after app.js; hooks SB.from() to log successful INSERT/UPDATE/DELETE.
// ════════════════════════════════════════════════════════════════

var AUDIT_TRAIL_TABLE = 'audit_trail';

var AUDIT_SKIP_TABLES = {
    audit_trail: 1,
    rx_phrase_options: 1
};

var AUDIT_TRACK_TABLES = {
    patients: 1,
    appointments: 1,
    bills: 1,
    treatments: 1,
    pending_bill_items: 1,
    xrays: 1,
    patient_documents: 1,
    druglist: 1,
    drughistory: 1,
    program_settings: 1,
    clinics: 1,
    doctors: 1,
    app_users: 1,
    doc_templates: 1
};

var AUDIT_TABLE_LABELS = {
    patients: 'PATIENT',
    appointments: 'APPOINTMENT',
    bills: 'BILL',
    treatments: 'DENTAL',
    pending_bill_items: 'PENDING BILL ITEM',
    xrays: 'X-RAY',
    patient_documents: 'PATIENT DOCUMENT',
    druglist: 'DRUG',
    drughistory: 'DRUG HISTORY',
    program_settings: 'PROGRAM SETTING',
    clinics: 'CLINIC',
    doctors: 'DOCTOR',
    app_users: 'APP USER',
    doc_templates: 'DOCUMENT TEMPLATE'
};

var _auditTableReady = null;
var _auditLoggingEnabled = true;
var AUDIT_DESKTOP_AGENT_BASE = 'http://127.0.0.1:17890';
var _auditWorkstationLabel = null;
var _auditWorkstationFetchDone = false;

function setAuditLoggingFromProgramSetting(enabled) {
    _auditLoggingEnabled = enabled !== false;
}

function auditTrailEnabled() {
    return _auditLoggingEnabled && typeof SB !== 'undefined' && SB && typeof SB.from === 'function';
}

function auditDesktopAgentBlocked() {
    try {
        return window.location.protocol === 'https:';
    } catch (eBlock) {
        return false;
    }
}

function auditBrowserHostFallback() {
    try {
        var host = window.location.hostname || 'browser';
        var path = (window.location.pathname || '').split('/').pop() || 'app';
        return host + '/' + path;
    } catch (eHost) {
        return 'browser';
    }
}

/** Ask local desktop agent (tools/Start X-Ray Launcher.bat) for this PC's name. */
function refreshAuditWorkstationLabel(cb) {
    if (auditDesktopAgentBlocked()) {
        _auditWorkstationFetchDone = true;
        if (cb) cb(null);
        return;
    }
    fetch(AUDIT_DESKTOP_AGENT_BASE + '/workstation', { method: 'GET', mode: 'cors', cache: 'no-store' })
        .then(function(r) {
            if (!r.ok) return null;
            return r.json().catch(function() { return null; });
        })
        .then(function(body) {
            _auditWorkstationFetchDone = true;
            if (body && body.ok && body.computer) {
                _auditWorkstationLabel = String(body.computer).trim();
            }
            if (cb) cb(_auditWorkstationLabel);
        })
        .catch(function() {
            _auditWorkstationFetchDone = true;
            if (cb) cb(null);
        });
}

function auditClientHostLabel() {
    if (_auditWorkstationLabel) return _auditWorkstationLabel;
    if (!_auditWorkstationFetchDone && !auditDesktopAgentBlocked()) {
        refreshAuditWorkstationLabel();
    }
    return auditBrowserHostFallback();
}

function auditActiveClinicTag() {
    if (typeof currentClinicCodeForTagging === 'function') {
        var code = currentClinicCodeForTagging();
        if (code) return String(code);
    }
    if (typeof currentClinicLabel === 'string' && currentClinicLabel) return currentClinicLabel;
    return '';
}

function auditActiveUserId() {
    return (typeof currentUserId === 'string' && currentUserId) ? currentUserId : '';
}

function auditActiveUserName() {
    if (typeof currentName === 'string' && currentName) return currentName;
    if (typeof currentDoctorName === 'string' && currentDoctorName) return currentDoctorName;
    return auditActiveUserId();
}

function auditTableLabel(tableName) {
    return AUDIT_TABLE_LABELS[tableName] || String(tableName || '').toUpperCase().replace(/_/g, ' ');
}

function auditBuildItem(operation, tableName) {
    var label = auditTableLabel(tableName);
    if (operation === 'INSERT') return 'ADD ' + label + ' RECORD';
    if (operation === 'UPDATE') return 'MODIFY ' + label + ' RECORD';
    if (operation === 'DELETE') return 'DELETE ' + label + ' RECORD';
    return String(operation || 'CHANGE') + ' ' + label;
}

function auditExtractPatientNo(row) {
    if (!row || typeof row !== 'object') return '';
    if (row.patient_no) return String(row.patient_no);
    if (row.pcode) return String(row.pcode);
    return '';
}

function auditExtractRecordId(row, filters) {
    if (row && row.id !== undefined && row.id !== null) return String(row.id);
    var i;
    for (i = 0; filters && i < filters.length; i++) {
        if (filters[i].col === 'id' && filters[i].val !== undefined && filters[i].val !== null) {
            return String(filters[i].val);
        }
    }
    return '';
}

function auditFormatLegacyDetail(data) {
    if (!data) return '';
    var lines = [];
    var k;
    if (Array.isArray(data)) {
        if (!data.length) return '';
        return auditFormatLegacyDetail(data[0]);
    }
    if (typeof data !== 'object') return String(data);
    for (k in data) {
        if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
        var v = data[k];
        if (v === null || v === undefined) v = '';
        else if (typeof v === 'object') v = JSON.stringify(v);
        lines.push('[' + String(k).toUpperCase() + ']=' + String(v));
    }
    return lines.join('\n');
}

function auditProbeTableOnce(cb) {
    if (_auditTableReady === true) {
        if (cb) cb(true);
        return;
    }
    if (_auditTableReady === false) {
        if (cb) cb(false);
        return;
    }
    SB.from(AUDIT_TRAIL_TABLE).select('id').limit(1)
        .then(function(r) {
            if (r.error) {
                var msg = (r.error.message || '').toLowerCase();
                if (msg.indexOf('does not exist') >= 0 || msg.indexOf('not found') >= 0 ||
                    msg.indexOf('404') >= 0) {
                    _auditTableReady = false;
                    if (cb) cb(false);
                    return;
                }
            }
            _auditTableReady = true;
            if (cb) cb(true);
        })
        .catch(function() {
            _auditTableReady = false;
            if (cb) cb(false);
        });
}

function recordAuditTrail(opts, done) {
    opts = opts || {};
    if (!auditTrailEnabled()) {
        if (done) done(false);
        return;
    }
    auditProbeTableOnce(function(ok) {
        if (!ok) {
            if (done) done(false);
            return;
        }
        var row = {
            clinic_tag: opts.clinic_tag || auditActiveClinicTag(),
            user_id: opts.user_id || auditActiveUserId(),
            user_name: opts.user_name || auditActiveUserName(),
            audit_item: opts.audit_item || auditBuildItem(opts.operation, opts.table_name),
            table_name: opts.table_name || null,
            operation: opts.operation || null,
            record_id: opts.record_id || null,
            client_host: opts.client_host || auditClientHostLabel(),
            patient_no: opts.patient_no || null,
            changes_detail: opts.changes_detail || null,
            payload: opts.payload || null
        };
        SB.from(AUDIT_TRAIL_TABLE).insert([row])
            .then(function(r) {
                if (done) done(!r.error);
            })
            .catch(function() {
                if (done) done(false);
            });
    });
}

function auditLogFromMutation(state, res) {
    if (!state || !state.op || !state.table) return;
    var rows = (res && res.data) ? res.data : null;
    var payload = state.payload;
    var primary = null;
    if (Array.isArray(rows) && rows.length) primary = rows[0];
    else if (Array.isArray(payload) && payload.length) primary = payload[0];
    else if (payload && typeof payload === 'object' && !Array.isArray(payload)) primary = payload;

    recordAuditTrail({
        audit_item: state.audit_item || auditBuildItem(state.op, state.table),
        table_name: state.table,
        operation: state.op,
        record_id: auditExtractRecordId(primary, state.filters),
        patient_no: auditExtractPatientNo(primary),
        changes_detail: auditFormatLegacyDetail(primary || payload),
        payload: {
            filters: state.filters || [],
            data: payload || null,
            result: rows || null
        }
    });
}

function wrapAuditThenable(builder, state) {
    if (!builder || typeof builder.then !== 'function') return builder;
    if (builder._jsmAuditThenWrapped) return builder;
    var origThen = builder.then.bind(builder);
    builder.then = function(onFulfilled, onRejected) {
        return origThen(function(res) {
            if (res && !res.error && state.op) {
                try {
                    auditLogFromMutation(state, res);
                } catch (eLog) { /* never block app saves */ }
            }
            return onFulfilled ? onFulfilled(res) : res;
        }, onRejected);
    };
    builder._jsmAuditThenWrapped = true;
    return builder;
}

function wrapAuditEqChain(builder, state) {
    if (!builder || builder._jsmAuditEqWrapped) return;
    if (typeof builder.eq === 'function') {
        var origEq = builder.eq.bind(builder);
        builder.eq = function(col, val) {
            state.filters.push({ col: col, val: val });
            return origEq(col, val);
        };
    }
    builder._jsmAuditEqWrapped = true;
}

function wrapAuditMutationResult(builder, state) {
    if (!builder) return builder;
    wrapAuditEqChain(builder, state);
    wrapAuditThenable(builder, state);
    return builder;
}

function wrapAuditBuilder(builder, tableName) {
    if (!builder || !AUDIT_TRACK_TABLES[tableName]) return builder;

    var state = {
        table: tableName,
        op: null,
        payload: null,
        filters: [],
        audit_item: null
    };

    wrapAuditEqChain(builder, state);

    if (typeof builder.insert === 'function') {
        var origInsert = builder.insert.bind(builder);
        builder.insert = function(data, opts) {
            state.op = 'INSERT';
            state.payload = data;
            return wrapAuditMutationResult(origInsert(data, opts), state);
        };
    }

    if (typeof builder.update === 'function') {
        var origUpdate = builder.update.bind(builder);
        builder.update = function(data, opts) {
            state.op = 'UPDATE';
            state.payload = data;
            return wrapAuditMutationResult(origUpdate(data, opts), state);
        };
    }

    if (typeof builder.upsert === 'function') {
        var origUpsert = builder.upsert.bind(builder);
        builder.upsert = function(data, opts) {
            state.op = 'UPSERT';
            state.audit_item = 'UPSERT ' + auditTableLabel(tableName) + ' RECORD';
            state.payload = data;
            return wrapAuditMutationResult(origUpsert(data, opts), state);
        };
    }

    if (typeof builder.delete === 'function') {
        var origDelete = builder.delete.bind(builder);
        builder.delete = function(opts) {
            state.op = 'DELETE';
            state.payload = null;
            return wrapAuditMutationResult(origDelete(opts), state);
        };
    }

    return builder;
}

function installSupabaseAuditHooks(sb) {
    if (!sb || sb._jsmAuditWrapped) return;
    var origFrom = sb.from.bind(sb);
    sb.from = function(tableName) {
        var q = origFrom(tableName);
        if (AUDIT_SKIP_TABLES[tableName]) return q;
        return wrapAuditBuilder(q, tableName);
    };
    sb._jsmAuditWrapped = true;
}

if (typeof SB !== 'undefined' && SB) {
    installSupabaseAuditHooks(SB);
}

document.addEventListener('DOMContentLoaded', function() {
    refreshAuditWorkstationLabel();
});
