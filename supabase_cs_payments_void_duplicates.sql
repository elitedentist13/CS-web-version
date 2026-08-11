-- =============================================================================
-- Void CS-imported bills that duplicate existing Banana bills
-- MULTI-BRANCH — use after find-cs-bill-duplicates.py
-- =============================================================================
-- Root cause:
--   CS payment import INSERTs new bills (notes CS_TXN:…). It does not update
--   Banana bills. If a balance was already migrated into Banana (often
--   JSM_PENDING:…) and later paid there, the CS copy reintroduces an older
--   snapshot and double-counts outstanding / history.
--
-- Fix:
--   Void the CS duplicate. Keep the Banana bill + its bill_payments.
--
-- Per branch:
--   1) Exact dups: python find-cs-bill-duplicates.py --branch PL --clinic-tag PL
--   2) Transfer-balance dups (JSM_PENDING carry-over; different bill dates):
--        python find-cs-transfer-balance-duplicates.py --branch PL --clinic-tag PL
--        → CS_PL_transfer_balance_void_staging_for_supabase.csv
--        Docs/log: CS_TRANSFER_BALANCE_VOID.md / CS_TRANSFER_BALANCE_VOID_LOG.md
--   3) Run §0 below (once)
--   4) TRUNCATE cs_bill_dup_void; import the void staging CSV for this pass
--   5) Run §1 preview → §2 void → §3 report
--   6) Manually review conflict CSV rows with action=manual_review
-- =============================================================================

-- 0) Staging (safe to re-run)
CREATE TABLE IF NOT EXISTS public.cs_bill_dup_void (
  cs_bill_id         uuid PRIMARY KEY,
  nat_bill_id        uuid,
  reason             text,
  patient_no         text,
  bill_date          text,
  cs_txn             text,
  branch_code        text,
  banana_clinic_tag  text,
  voided_at          timestamptz,
  created_at         timestamptz DEFAULT now()
);

-- Optional: clear before importing another branch's void list
-- TRUNCATE public.cs_bill_dup_void;

-- 1) Preview (CS rows that will be voided)
SELECT
  d.branch_code,
  d.reason,
  d.patient_no,
  d.bill_date,
  d.cs_txn,
  b.total,
  b.amount_paid AS cs_paid,
  b.balance AS cs_bal,
  b.status AS cs_status,
  nb.amount_paid AS nat_paid,
  nb.balance AS nat_bal,
  nb.status AS nat_status,
  left(b.notes, 80) AS cs_notes
FROM public.cs_bill_dup_void d
JOIN public.bills b ON b.id = d.cs_bill_id
LEFT JOIN public.bills nb ON nb.id = d.nat_bill_id
WHERE b.notes LIKE '%CS_TXN:%'
  AND b.voided_at IS NULL
ORDER BY d.bill_date, d.patient_no;

-- 2) Void CS duplicates only (never touches Banana / non-CS bills)
UPDATE public.bills b
SET voided_at = coalesce(b.voided_at, now()),
    notes = CASE
      WHEN b.notes LIKE '%CS_DUP_VOID:%' THEN b.notes
      ELSE trim(both ' ' from concat_ws(
        ' | ',
        b.notes,
        'CS_DUP_VOID:superseded_by_Banana_bill'
      ))
    END
FROM public.cs_bill_dup_void d
WHERE b.id = d.cs_bill_id
  AND b.notes LIKE '%CS_TXN:%'
  AND b.voided_at IS NULL;

UPDATE public.cs_bill_dup_void d
SET voided_at = now()
FROM public.bills b
WHERE b.id = d.cs_bill_id
  AND b.voided_at IS NOT NULL
  AND b.notes LIKE '%CS_DUP_VOID:%'
  AND d.voided_at IS NULL;

-- 3) Report
SELECT
  count(*) FILTER (WHERE d.voided_at IS NOT NULL) AS staging_marked_voided,
  count(*) FILTER (
    WHERE b.voided_at IS NOT NULL AND b.notes LIKE '%CS_DUP_VOID:%'
  ) AS cs_bills_voided,
  count(*) FILTER (
    WHERE b.voided_at IS NULL AND b.notes LIKE '%CS_TXN:%'
  ) AS cs_still_active_in_staging
FROM public.cs_bill_dup_void d
LEFT JOIN public.bills b ON b.id = d.cs_bill_id;