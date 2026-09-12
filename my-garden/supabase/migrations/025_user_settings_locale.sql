-- 025_user_settings_locale.sql
-- Which language the app's UI should render in for this account. A plain
-- two-letter code (ISO 639-1) is enough for now — no region variants
-- (en-US vs en-GB) since none of the supported languages need one yet.
-- Same TEXT + DEFAULT + CHECK idiom as plan (006_billing.sql).

BEGIN;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'
  CHECK (locale ~ '^[a-z]{2}$');

COMMIT;
