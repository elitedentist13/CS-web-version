-- =============================================================================
-- Backfill CS treatment line items onto imported Banana bills
-- MULTI-BRANCH — use with backfill-cs-bill-items.py
-- =============================================================================
-- Prefer (future imports): pass --items when preparing staging so items_json
-- is filled BEFORE insert. Use this backfill only when bills were already
-- inserted with placeholder "CS imported bill".
--
-- Per branch:
--   1) python backfill-cs-bill-items.py --branch PL --items "..._items.csv"
--   2) Run §0
--   3) Import CS_<BRANCH>_bill_items_backfill_for_supabase.csv
--      into cs_bill_items_backfill (txn_code, items_json; line_count optional)
--   4) Run §1 UPDATE → §2 report
--
-- Only updates bills with CS_TXN:<txn> in notes. Does not change totals/payments.
-- =============================================================================

-- 0) Staging
CREATE TABLE IF NOT EXISTS public.cs_bill_items_backfill (
  txn_code    text PRIMARY KEY,
  items_json  text NOT NULL,
  line_count  text,
  branch_code text
);

-- Clear before importing another branch (txn_code is global PK across CS DBs
-- only if T_CODE values never collide — safer to TRUNCATE per branch run):
-- TRUNCATE public.cs_bill_items_backfill;

-- 1) Apply items onto bills
UPDATE public.bills b
SET items = x.items_json::jsonb
FROM public.cs_bill_items_backfill x
WHERE b.notes LIKE '%CS_TXN:' || trim(x.txn_code) || '%'
  AND coalesce(trim(x.items_json), '') <> ''
  AND trim(x.items_json) LIKE '[%';

-- 2) Report (all CS-imported bills)
SELECT
  count(*) FILTER (
    WHERE b.notes LIKE '%CS_TXN:%'
      AND b.items IS NOT NULL
      AND jsonb_typeof(b.items) = 'array'
      AND jsonb_array_length(b.items) > 0
      AND coalesce(b.items->0->>'desc', '') <> 'CS imported bill'
  ) AS bills_with_real_items,
  count(*) FILTER (
    WHERE b.notes LIKE '%CS_TXN:%'
      AND coalesce(b.items->0->>'desc', '') = 'CS imported bill'
  ) AS bills_still_placeholder,
  count(*) FILTER (WHERE b.notes LIKE '%CS_TXN:%') AS cs_bills_total
FROM public.bills b;

-- Optional: placeholder sample for triage
-- SELECT id, patient_no, bill_date, total, left(notes, 80)
-- FROM public.bills
-- WHERE notes LIKE '%CS_TXN:%'
--   AND coalesce(items->0->>'desc', '') = 'CS imported bill'
-- ORDER BY bill_date DESC
-- LIMIT 50;
