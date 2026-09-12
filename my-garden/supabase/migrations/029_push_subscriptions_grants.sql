-- 029_push_subscriptions_grants.sql
-- push_subscriptions (017) created RLS policies letting a signed-in user
-- INSERT/SELECT/DELETE their own subscription row, but never granted the
-- underlying table privileges to the `authenticated` role — RLS policies
-- only add row-level filtering on top of an operation that's already
-- permitted at the GRANT level; without the GRANT, the operation is
-- rejected before RLS is even consulted. Same class of gap as
-- yard_members (024) and plant_tips_cache (026), just never caught here
-- since the client-side symptom (silently failed upsert) doesn't show up
-- as an obviously broken UI — the "Enable notifications" toggle reads its
-- on/off state from the browser's own Notification.permission, which
-- succeeds regardless of whether the subsequent DB write did.

GRANT SELECT, INSERT, DELETE ON push_subscriptions TO authenticated;
