# Backup and Rollback Runbook

Use this before go-live and keep it for emergency fallback.

## 1) Pre-go-live backup (mandatory)

Perform at least one data backup before opening for normal clinic use.

Recommended scope:
- `patients`
- `appointments`
- `bills`
- `bill_items`
- `payments`
- `app_users`
- key config tables (clinic, doctors, settings)

Minimum requirement:
- Export CSV or SQL snapshot with timestamp.
- Save copy in two locations:
  - clinic local disk
  - secure cloud/shared drive

Naming format example:
- `backup_YYYYMMDD_HHMM_pre_go_live.zip`

## 2) During operation (monitoring)

Watch for:
- repeated save failures
- unexpected missing records
- appointment drag/drop time mismatch
- permission leakage (non-admin enters Configuration)

If any critical issue appears, stop new edits and go to rollback decision.

## 3) Rollback decision trigger

Rollback if any of these occurs:
- core flow cannot continue for front desk
- data integrity risk (wrong patient linkage, missing payments)
- unauthorized access to admin module

## 4) Rollback procedure (simple)

1. Announce temporary maintenance to staff.
2. Stop active editing in the app.
3. Restore latest stable backup/snapshot.
4. Verify:
   - login
   - patient search
   - appointment create/edit
   - billing save
5. Re-open service only after all 4 checks pass.

## 5) Post-rollback capture

Record:
- issue time window
- affected user IDs
- affected patient numbers
- screenshots/error text
- action taken and restore timestamp

This will speed up permanent fix after clinic hours.
