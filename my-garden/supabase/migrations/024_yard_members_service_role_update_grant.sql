-- 024_yard_members_service_role_update_grant.sql
-- The yard-members Edge Function's invite path does
-- `.upsert(..., { onConflict: 'yard_id,user_id' })` as service_role — an
-- INSERT ... ON CONFLICT DO UPDATE under the hood. Postgres checks UPDATE
-- privilege for that statement whether or not a conflict actually happens
-- at runtime, so without it every invite 500s (confirmed live: 020 only
-- granted service_role SELECT, INSERT, DELETE on yard_members, not
-- UPDATE — the same "grant is separate from RLS bypass" gap this project
-- has hit before, e.g. 018 for care_items).

BEGIN;

GRANT UPDATE ON yard_members TO service_role;

COMMIT;
