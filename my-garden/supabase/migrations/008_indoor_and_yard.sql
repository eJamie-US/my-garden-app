-- 008_indoor_and_yard.sql
-- Indoor plants (weather doesn't apply), the yard photo's compass
-- orientation, and yard obstacles (buildings, trees, fences, covered
-- porches) for the sun/shade exposure estimate.
-- Only adds things. Safe to run more than once.

BEGIN;

ALTER TABLE plants ADD COLUMN IF NOT EXISTS indoor BOOLEAN NOT NULL DEFAULT false;

-- Degrees clockwise from the top of the yard photo to true north (0 = top
-- of the photo IS north, the default/common case for an aerial screenshot).
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS garden_orientation_deg DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS yard_obstacles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('building', 'covered-porch', 'tree', 'fence')),
  label TEXT,
  -- Same percent-of-yard-photo coordinates as plants.location.
  location JSONB NOT NULL,
  -- Qualitative, not metric — see sunExposure.ts for why: 'low' (~1-1.5m,
  -- a fence), 'medium' (~3m, a single-story roof/porch), 'tall' (~6m+, a
  -- tree or two-story building).
  height_tier TEXT NOT NULL DEFAULT 'medium' CHECK (height_tier IN ('low', 'medium', 'tall')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE yard_obstacles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON yard_obstacles TO authenticated;

DO $$ BEGIN
  CREATE POLICY "Users can view their own yard obstacles" ON yard_obstacles
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create their own yard obstacles" ON yard_obstacles
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own yard obstacles" ON yard_obstacles
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own yard obstacles" ON yard_obstacles
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS yard_obstacles_touch_updated_at ON yard_obstacles;
CREATE TRIGGER yard_obstacles_touch_updated_at
  BEFORE UPDATE ON yard_obstacles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
