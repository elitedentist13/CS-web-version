-- Optional: ensure "Balance transfer" exists as a payment method.
-- Safe to re-run. The app also injects this option in Add Payment even if missing.
-- Balance transfer payments are excluded from income / payment statistics in app-report.js.

insert into public.bill_types (name, type_code, type_name, is_active, is_default, sort_order)
select 'Balance transfer', 'Balance transfer', '餘額轉移', true, false, 900
where not exists (
    select 1 from public.bill_types
    where lower(coalesce(name, type_code, '')) in ('balance transfer', 'balancetransfer')
);

-- If your bill_types schema differs (no type_name / sort_order), use:
-- insert into public.bill_types (name, is_active)
-- select 'Balance transfer', true
-- where not exists (
--   select 1 from public.bill_types where lower(name) = 'balance transfer'
-- );
