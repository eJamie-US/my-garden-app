-- 030_push_subscriptions_update_grant.sql
-- 029 granted SELECT/INSERT/DELETE to `authenticated` on push_subscriptions,
-- but subscribeToPush() writes via `.upsert(..., { onConflict: 'user_id,endpoint' })`,
-- which Postgres plans as INSERT ... ON CONFLICT DO UPDATE — that requires UPDATE
-- privilege on the table even when no conflict actually occurs. Same class of gap
-- as plant_tips_cache (026), just missed in 029 because DELETE/INSERT/SELECT alone
-- looked like the complete set for the policies that existed.

GRANT UPDATE ON push_subscriptions TO authenticated;
