-- 026_plant_tips_cache_locale.sql
-- plant_tips_cache was keyed by species_key alone, on the assumption every
-- lookup wanted the same (English) answer. Now that plant-tips can answer
-- in the caller's language, two users asking about the same species in
-- different languages would otherwise collide on one cache row and
-- overwrite each other's tips. Add locale to the key; every row cached so
-- far was generated in English, so it backfills as 'en' rather than
-- orphaning existing cache entries.

BEGIN;

ALTER TABLE plant_tips_cache
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'
  CHECK (locale ~ '^[a-z]{2}$');

ALTER TABLE plant_tips_cache DROP CONSTRAINT IF EXISTS plant_tips_cache_pkey;
ALTER TABLE plant_tips_cache ADD PRIMARY KEY (species_key, locale);

-- 019 only granted service_role SELECT/INSERT — fine for a plain insert,
-- but the Edge Function's cache write is an upsert (INSERT ... ON CONFLICT
-- DO UPDATE), which Postgres plans against UPDATE privilege regardless of
-- whether a given call actually hits a conflict. Same gap as yard_members
-- hit (migration 024) — caught here before it ever shipped broken.
GRANT UPDATE ON plant_tips_cache TO service_role;

COMMIT;
