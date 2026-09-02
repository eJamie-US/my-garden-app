-- 013_billing_service_role_grant.sql
-- billing_customers only ever explicitly granted SELECT to `authenticated`
-- (006_billing.sql), on the assumption that service_role's usual blanket
-- default privileges would cover the webhook/entitlement-check Edge
-- Functions' service-role client. In practice that table ended up without
-- an explicit grant, so every service-role read/write hit "permission
-- denied for table billing_customers" — silently making every account
-- (including ones actually on lifetime/premium) look free to the
-- server-side entitlement check (requirePremium), while the client's own
-- authenticated-role read still worked fine and showed the real plan.
-- Safe to run more than once.

GRANT SELECT, INSERT, UPDATE ON billing_customers TO service_role;
