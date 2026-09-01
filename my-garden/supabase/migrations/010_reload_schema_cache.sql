-- 010_reload_schema_cache.sql
-- Forces PostgREST to reload its cached view of the schema. Tables/grants
-- added via `supabase db push` (outside the Supabase dashboard) don't
-- always trigger PostgREST's own auto-reload, which shows up as REST
-- calls to a brand-new table (billing_customers) failing even though the
-- table, RLS policy, and grants are all genuinely there. Safe to run any
-- number of times — it's a notification, not a schema change.

NOTIFY pgrst, 'reload schema';
