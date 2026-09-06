// ════════════════════════════════════════════════════════════════
// USER AUTHORIZATION — permission registry + runtime checks
// Stored on app_users.permissions (jsonb). NULL = legacy full access.
// ════════════════════════════════════════════════════════════════

/** @type {object|null} Merged permission map for the logged-in user. */
var currentUserPermissions = null;

var USER_PERM_REGISTRY = [
    { key: 'appointment', parent: null, col: 0 },
    { key: 'patient', parent: null, col: 0 },
    { key: 'consultation', parent: null, col: 0 },
    { key: 'consult_modify_prescription', parent: 'consultation', col: 0 },
    { key: 'consult_modify_image', parent: 'consultation', col: 0 },
    { key: 'consult_lock_contact', parent: 'consultation', col: 0 },
    { key: 'consult_modify_medical_notes', parent: 'consultation', col: 0 },
    { key: 'drug_inventory', parent: null, col: 0 },
    { key: 'drug_modify_price', parent: 'drug_inventory', col: 0 },
    { key: 'expenses', parent: null, col: 0 },
    { key: 'inventory', parent: null, col: 1 },
    { key: 'inventory_modify', parent: 'inventory', col: 1 },
    { key: 'report', parent: null, col: 1 },
    { key: 'report_clinic_period', parent: 'report', col: 1 },
    { key: 'report_clinic_monthly', parent: 'report', col: 1 },
    { key: 'report_clinic_daily', parent: 'report', col: 1 },
    { key: 'report_doctor_period', parent: 'report', col: 1 },
    { key: 'report_doctor_monthly', parent: 'report', col: 1 },
    { key: 'report_doctor_daily', parent: 'report', col: 1 },
    { key: 'config', parent: null, col: 1 },
    { key: 'config_user_info', parent: 'config', col: 1 },
    { key: 'config_program_setting', parent: 'config', col: 1 },
    { key: 'void_payment', parent: null, col: 2 },
    { key: 'modify_bill', parent: null, col: 2 },
    { key: 'management_report', parent: null, col: 2 }
];

var USER_PERM_KEYS = USER_PERM_REGISTRY.map(function (d) { return d.key; });

function defaultUserPermissionsAllOn() {
    var o = {};
    USER_PERM_KEYS.forEach(function (k) { o[k] = true; });
    return o;
}

/** NULL / missing column → unrestricted (backward compatible). */
function parseUserPermissions(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { return null; }
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw;
}

/** Merge stored JSON with defaults; used for Configuration UI. */
function mergeUserPermissionsForEdit(stored) {
    var parsed = parseUserPermissions(stored);
    var out = defaultUserPermissionsAllOn();
    if (!parsed) return out;
    USER_PERM_KEYS.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(parsed, k)) {
            out[k] = parsed[k] !== false;
        }
    });
    return out;
}

function setCurrentUserPermissions(raw) {
    currentUserPermissions = parseUserPermissions(raw);
}

function hasAppPermission(key) {
    if (!key) return true;
    // Administrator role always overrides every authorization checkbox, no
    // matter what is stored in that admin account's own `permissions` JSON.
    // Without this, the Users→Edit panel shows the SAME checkbox grid for
    // admin accounts as everyone else (see _openAdminUserPanel in
    // app-config.js), and _saveUser() always writes a concrete permissions
    // object (never leaves it NULL) -- so an admin account that ever had a
    // box unchecked (even by accident) would otherwise be locked out of
    // that area too. canAccessConfiguration() already special-cased this
    // for the Configuration module only; this makes the override universal
    // for every permission key, current and future, in one place.
    if (String(currentRole || '').toLowerCase() === 'admin') return true;
    if (currentUserPermissions === null) return true;
    if (currentUserPermissions[key] === false) return false;
    var def = USER_PERM_REGISTRY.find(function (d) { return d.key === key; });
    if (def && def.parent && currentUserPermissions[def.parent] === false) return false;
    return true;
}

function canAccessConfiguration() {
    // Admins always have access.
    if (String(currentRole || '').toLowerCase() === 'admin') return true;
    // Quick lock (Users tab): when ON (default), Configuration is admin-only
    // and hidden from everyone else.
    if (typeof programSettingBool === 'function' && programSettingBool('config_admin_only', true)) {
        return false;
    }
    // Otherwise fall back to the per-user 'config' permission.
    if (typeof hasAppPermission === 'function') return hasAppPermission('config');
    return false;
}

function permToastDenied() {
    var msg = (typeof appTr === 'function')
        ? appTr('toast.permissionDenied')
        : 'You do not have permission for this module.';
    alert(msg);
}

var DASHBOARD_PERM_CARDS = [
    { cardId: 'card-appointment', perm: 'appointment' },
    { cardId: 'card-patient', perm: 'patient' },
    { cardId: 'card-consultation', perm: 'consultation' },
    { cardId: 'card-drugbook', perm: 'drug_inventory' },
    { cardId: 'card-report', perm: 'report' },
    { cardId: 'card-configuration', perm: 'config' },
    { cardId: 'card-expenses', perm: 'expenses' },
    { cardId: 'card-inventory', perm: 'inventory' }
];

function applyDashboardPermissionGuards() {
    DASHBOARD_PERM_CARDS.forEach(function (row) {
        var card = g(row.cardId);
        if (!card) return;
        var allowed = (row.perm === 'config')
            ? canAccessConfiguration()
            : hasAppPermission(row.perm);
        card.style.display = allowed ? '' : 'none';
        card.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    });
}

function guardModuleByPermission(permKey) {
    if (hasAppPermission(permKey)) return true;
    permToastDenied();
    return false;
}
