-- 018_care_items_service_role_grant.sql
-- send-due-notifications (017_push_notifications) reads every user's due
-- care items with the service-role key to decide who to notify — that key
-- bypasses RLS but still needs the base table grant, the same gap that
-- silently broke billing reads earlier this project (013). Caught this one
-- immediately via a live test instead of a support-desk report.

GRANT SELECT ON care_items TO service_role;
