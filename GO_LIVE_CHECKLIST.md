# Joyful Smile — Go-Live Checklist (Before 3:00 AM)

Use this list in order. Mark each item complete before opening for normal operations.

**Staff help (in app):** Dashboard → **❓ Help** → opens `help.pdf` locally, or `help.html` on GitHub Pages (photos embedded). Rebuild with `scripts/build-help-html.ps1`, then **commit and push** `help.html` (and `help.pdf` if you use it locally).

**Staff user manual source:** Edit `docs/prelaunch-manual/help-source.html`, then run `scripts/build-help-html.ps1`. Add PNGs per `docs/prelaunch-manual/CAPTURE_SCREENSHOTS.md`.

**A4 quick card (1 page):** `docs/prelaunch-manual/QUICK_REFERENCE_A4.html` — print and laminate for front desk / treatment room.

## A. Access and module controls

- [ ] Non-admin login cannot open **Configuration** from dashboard.
- [ ] Admin login can open **Configuration** normally.
- [ ] Dashboard **Expenses** card is visible but inactive (not clickable).
- [ ] Dashboard **Inventory** card is visible but inactive (not clickable).

## B. Core flow smoke test (critical path)

Run once with a staff account and once with an admin account.

### 1) Login and dashboard
- [ ] Login succeeds.
- [ ] User badge shows correct user name and role.
- [ ] Appointment, Patient, Consultation, Report modules open.

### 2) Patient directory
- [ ] Search returns results from full dataset (not capped at 1000 only).
- [ ] Pagination works: next/prev, page size, jump-to-page.
- [ ] Clicking a patient row sets active patient card (Primary slot).

### 3) Active patient drag/drop
- [ ] Drag patient row to active patient card works.
- [ ] Drag active patient card to `+ Appointment` slot opens create modal with preselected patient.
- [ ] In active patient stack, swap button works and updates primary context.

### 4) + Appointment timeline
- [ ] Create appointment works.
- [ ] Drag created appointment to another slot works (snap to slot).
- [ ] Success toast appears after drag reschedule.
- [ ] Lock button on row toggles lock state.
- [ ] Locked appointment cannot be dragged.

### 5) Edit appointment modal
- [ ] Delete button appears in alert red style.
- [ ] Lock/Unlock control appears for existing appointment.
- [ ] When locked, date/start/duration are disabled and delete hidden.

### 6) Billing quick check
- [ ] Open billing from appointment.
- [ ] Add payment works.
- [ ] Save completes without silent error.

## C. Error and fallback readiness

- [ ] If save fails, user sees visible alert/toast message.
- [ ] Known temporary limits note is available to staff (see `STAFF_QUICK_NOTE.md`).
- [ ] Admin has backup + rollback instructions (see `BACKUP_ROLLBACK_RUNBOOK.md`).

## D. Go/No-Go gate

Go live only if all are true:

- [ ] No blocker in core flow.
- [ ] Admin-only Configuration confirmed.
- [ ] Appointment lock + drag behavior confirmed.
- [ ] Backup path and rollback contact confirmed.

If any blocker appears, pause go-live and use rollback plan.
