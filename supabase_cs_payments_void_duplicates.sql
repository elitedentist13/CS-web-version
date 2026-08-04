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
--   1) python find-cs-bill-duplicates.py --branch PL --clinic-tag PL
--   2) Run §0 below
--   3) Import CS_<BRANCH>_bill_dup_void_staging_for_supabase.csv
--      into cs_bill_dup_void (header on)
--   4) Run §1 preview → §2 void → §3 report
--   5) Manually review CS_<BRANCH>_bill_duplicate_conflicts.csv rows with
--      action=manual_review / same_day_different_total
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
  count(*) FILTER (WHERE notes LIKE '%CS_DUP_VOID:%') AS cs_dup_voided_total,
  count(*) FILTER (
    WHERE notes LIKE '%CS_TXN:%' AND voided_at IS NULL
  ) AS cs_bills_still_active,
  count(*) FILTER (
    WHERE notes LIKE '%CS_TXN:%'
      AND voided_at IS NULL
      AND coalesce(balance, 0) > 0.05
  ) AS cs_open_balance_still_active
FROM public.bills;

-- Optional: staging rows processed this run
SELECT reason, count(*) AS n
FROM public.cs_bill_dup_void
WHERE voided_at IS NOT NULL
GROUP BY 1
ORDER BY n DESC;
