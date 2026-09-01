-- 007_plant_exposure.sql
-- Whether a plant is sheltered from rain (an eave, a patio roof, grown
-- under cover) — sun_requirement/watering_schedule already existed but had
-- no UI to edit them on an existing plant; this migration and the matching
-- app change fix both that gap and add this new field at once.
-- Only adds things. Safe to run more than once.

BEGIN;

ALTER TABLE plants ADD COLUMN IF NOT EXISTS rain_covered BOOLEAN NOT NULL DEFAULT false;

COMMIT;
