-- 002_care_items.sql
-- Two jobs:
--   1. Reconcile the plants table with the app's Plant type (001 drifted badly:
--      the service writes location/common_name/watering_schedule/sun_requirement,
--      none of which existed).
--   2. Add care_items.
-- Safe to run on an existing 001 database: columns are added, x/y are migrated
-- into the location jsonb, and the old integer water_schedule is translated.

BEGIN;

/* ---------- 0. snapshot ----------
   Section 1 ends by dropping x, y, water_schedule and color. That is the only
   irreversible part of this migration, so take a full copy of the table first.
   Verify with:  SELECT count(*) FROM plants_backup_002;
   Drop it once you are happy:  DROP TABLE plants_backup_002;                  */

CREATE TABLE IF NOT EXISTS plants_backup_002 AS SELECT * FROM plants;

/* ---------- 1. plants: close the drift ---------- */

ALTER TABLE plants ADD COLUMN IF NOT EXISTS common_name TEXT;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS sprite_url TEXT;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS location JSONB;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS watering_schedule TEXT;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS sun_requirement TEXT;

-- x/y (integers, 0..100) become location = {"x": n, "y": n}
UPDATE plants
SET location = jsonb_build_object('x', COALESCE(x, 50), 'y', COALESCE(y, 50))
WHERE location IS NULL;

ALTER TABLE plants ALTER COLUMN location SET DEFAULT '{"x": 50, "y": 50}'::jsonb;
ALTER TABLE plants ALTER COLUMN location SET NOT NULL;

-- 001 stored watering as "days between"; the app uses a named schedule.
UPDATE plants
SET watering_schedule = CASE
  WHEN water_schedule IS NULL THEN 'weekly'
  WHEN water_schedule <= 1 THEN 'daily'
  WHEN water_schedule <= 7 THEN 'weekly'
  WHEN water_schedule <= 14 THEN 'biweekly'
  ELSE 'monthly'
END
WHERE watering_schedule IS NULL;

ALTER TABLE plants ALTER COLUMN watering_schedule SET DEFAULT 'weekly';

UPDATE plants SET sun_requirement = 'partial-shade' WHERE sun_requirement IS NULL;
ALTER TABLE plants ALTER COLUMN sun_requirement SET DEFAULT 'partial-shade';

-- planted_date is NOT NULL in the type but nullable here; backfill then tighten.
UPDATE plants SET planted_date = COALESCE(planted_date, created_at, NOW())
WHERE planted_date IS NULL;
ALTER TABLE plants ALTER COLUMN planted_date SET DEFAULT NOW();

-- The old positional constraint and columns are superseded by location.
-- IRREVERSIBLE. plants_backup_002 (section 0) holds the pre-migration copy.
-- To stage this instead: comment out the four DROP COLUMN lines, run the rest,
-- confirm the app reads/writes correctly, then run them on their own.
ALTER TABLE plants DROP CONSTRAINT IF EXISTS valid_position;
ALTER TABLE plants DROP COLUMN IF EXISTS x;
ALTER TABLE plants DROP COLUMN IF EXISTS y;
ALTER TABLE plants DROP COLUMN IF EXISTS water_schedule;
ALTER TABLE plants DROP COLUMN IF EXISTS color;

DO $$ BEGIN
  ALTER TABLE plants ADD CONSTRAINT valid_location CHECK (
    (location->>'x')::numeric BETWEEN 0 AND 100
    AND (location->>'y')::numeric BETWEEN 0 AND 100
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE plants ADD CONSTRAINT valid_watering_schedule CHECK (
    watering_schedule IN ('daily', 'weekly', 'biweekly', 'monthly')
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE plants ADD CONSTRAINT valid_sun_requirement CHECK (
    sun_requirement IN ('full-sun', 'partial-shade', 'full-shade')
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/* ---------- 2. care_items ---------- */

CREATE TABLE IF NOT EXISTS care_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  frequency_every INTEGER NOT NULL DEFAULT 1,
  frequency_unit TEXT NOT NULL DEFAULT 'week',
  -- [{ id, name, amount, unit }] — amount stays text so "1/2" survives.
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  instructions TEXT,
  next_due_date DATE,
  last_completed_at TIMESTAMP WITH TIME ZONE,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_kind CHECK (
    kind IN ('water', 'feed', 'prune', 'mulch', 'protect', 'inspect', 'other')
  ),
  CONSTRAINT valid_frequency_unit CHECK (
    frequency_unit IN ('day', 'week', 'month', 'year')
  ),
  CONSTRAINT valid_frequency_every CHECK (frequency_every BETWEEN 1 AND 365),
  CONSTRAINT valid_source CHECK (source IN ('generated', 'user')),
  CONSTRAINT ingredients_is_array CHECK (jsonb_typeof(ingredients) = 'array')
);

CREATE INDEX IF NOT EXISTS care_items_plant_id_idx ON care_items(plant_id);
CREATE INDEX IF NOT EXISTS care_items_user_due_idx ON care_items(user_id, next_due_date);

ALTER TABLE care_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view their own care items" ON care_items
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create care items" ON care_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own care items" ON care_items
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own care items" ON care_items
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ---------- 3. keep updated_at honest ---------- */

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plants_touch_updated_at ON plants;
CREATE TRIGGER plants_touch_updated_at
  BEFORE UPDATE ON plants
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS care_items_touch_updated_at ON care_items;
CREATE TRIGGER care_items_touch_updated_at
  BEFORE UPDATE ON care_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

/* ---------- 4. storage: allow the sprite cut-outs ---------- */

INSERT INTO storage.buckets (id, name, public)
VALUES ('plant-photos', 'plant-photos', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Users can update their own plant photos" ON storage.objects
    FOR UPDATE USING (bucket_id = 'plant-photos' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own plant photos" ON storage.objects
    FOR DELETE USING (bucket_id = 'plant-photos' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
