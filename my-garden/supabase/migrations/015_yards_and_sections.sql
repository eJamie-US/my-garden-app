-- 015_yards_and_sections.sql
-- Multiple yard photos ("yards") per account, each with its own location,
-- plants and obstacles — for gardening in more than one place. Within one
-- yard, "sections" are a named, saved zoom/crop rectangle of that yard's
-- one photo (percent-of-photo, same units as everywhere else in this
-- app) — a viewport for precise placement in a busy area, not a second
-- photo or a separate set of plants/obstacles.
--
-- Every existing user gets exactly one yard, "My Garden", carrying their
-- current garden_lat/lon/orientation from user_settings and every plant/
-- obstacle they already have — zero visible change on top of this
-- migration. Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS yards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Garden',
  image_url TEXT NOT NULL DEFAULT '/default-yard.png',
  label TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  orientation_deg DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_yard_lat CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT valid_yard_lon CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

ALTER TABLE yards ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON yards TO authenticated;

DO $$ BEGIN
  CREATE POLICY "Users can view their own yards" ON yards
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can create their own yards" ON yards
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can update their own yards" ON yards
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can delete their own yards" ON yards
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS yards_touch_updated_at ON yards;
CREATE TRIGGER yards_touch_updated_at
  BEFORE UPDATE ON yards
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS yard_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id UUID NOT NULL REFERENCES yards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Percent-of-photo crop rectangle, same 0-100 units as plant/obstacle
  -- locations. No image, no plants/obstacles of its own — purely a saved
  -- viewport onto the parent yard's one photo.
  box_x0 DOUBLE PRECISION NOT NULL,
  box_y0 DOUBLE PRECISION NOT NULL,
  box_x1 DOUBLE PRECISION NOT NULL,
  box_y1 DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE yard_sections ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON yard_sections TO authenticated;

DO $$ BEGIN
  CREATE POLICY "Users can view their own yard sections" ON yard_sections
    FOR SELECT USING (EXISTS (SELECT 1 FROM yards WHERE yards.id = yard_sections.yard_id AND yards.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can create their own yard sections" ON yard_sections
    FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM yards WHERE yards.id = yard_sections.yard_id AND yards.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can update their own yard sections" ON yard_sections
    FOR UPDATE USING (EXISTS (SELECT 1 FROM yards WHERE yards.id = yard_sections.yard_id AND yards.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can delete their own yard sections" ON yard_sections
    FOR DELETE USING (EXISTS (SELECT 1 FROM yards WHERE yards.id = yard_sections.yard_id AND yards.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS yard_sections_touch_updated_at ON yard_sections;
CREATE TRIGGER yard_sections_touch_updated_at
  BEFORE UPDATE ON yard_sections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Nullable for now — backfilled below, then locked to NOT NULL.
ALTER TABLE plants ADD COLUMN IF NOT EXISTS yard_id UUID REFERENCES yards(id) ON DELETE CASCADE;
ALTER TABLE yard_obstacles ADD COLUMN IF NOT EXISTS yard_id UUID REFERENCES yards(id) ON DELETE CASCADE;

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS default_yard_id UUID REFERENCES yards(id) ON DELETE SET NULL;

-- One yard per existing user who has settings, plants, or obstacles today —
-- carrying over their current location/orientation where set.
INSERT INTO yards (user_id, name, image_url, label, latitude, longitude, orientation_deg)
SELECT
  u.user_id,
  'My Garden',
  '/default-yard.png',
  s.garden_label,
  s.garden_lat,
  s.garden_lon,
  COALESCE(s.garden_orientation_deg, 0)
FROM (
  SELECT user_id FROM user_settings
  UNION SELECT user_id FROM plants
  UNION SELECT user_id FROM yard_obstacles
) u
LEFT JOIN user_settings s ON s.user_id = u.user_id
WHERE NOT EXISTS (SELECT 1 FROM yards y WHERE y.user_id = u.user_id);

UPDATE plants p SET yard_id = y.id
FROM yards y
WHERE p.yard_id IS NULL AND y.user_id = p.user_id;

UPDATE yard_obstacles o SET yard_id = y.id
FROM yards y
WHERE o.yard_id IS NULL AND y.user_id = o.user_id;

UPDATE user_settings s SET default_yard_id = y.id
FROM yards y
WHERE s.default_yard_id IS NULL AND y.user_id = s.user_id;

ALTER TABLE plants ALTER COLUMN yard_id SET NOT NULL;
ALTER TABLE yard_obstacles ALTER COLUMN yard_id SET NOT NULL;

COMMIT;
