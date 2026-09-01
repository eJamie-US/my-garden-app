-- 005_profile.sql
-- Display name + a picked emoji icon for the account menu, instead of just
-- an email-initial avatar. Lives on user_settings, next to garden location —
-- same one-row-per-user shape, same RLS policies already cover it.
-- Only adds things. Safe to run more than once.

BEGIN;

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS avatar_icon TEXT;

COMMIT;
