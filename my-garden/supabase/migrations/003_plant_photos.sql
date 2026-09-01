-- 003_plant_photos.sql
-- Dated photo history per plant, so a plant becomes a progression you can scrub.
-- Purely additive: plants.photo_url / sprite_url stay as the "current" photo,
-- and section 3 backfills them as each plant's first timeline entry.

BEGIN;

CREATE TABLE IF NOT EXISTS plant_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  sprite_url TEXT,
  /* Date the photo was TAKEN — not when it was uploaded, so backdating an
     old picture puts it in the right place on the timeline. */
  taken_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  note TEXT,
  /* Optional: what identification said about THIS photo, so a species
     correction later doesn't rewrite the history. */
  identified_species TEXT,
  identified_score NUMERIC(4, 3),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_score CHECK (
    identified_score IS NULL OR (identified_score >= 0 AND identified_score <= 1)
  )
);

CREATE INDEX IF NOT EXISTS plant_photos_plant_taken_idx
  ON plant_photos(plant_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS plant_photos_user_idx ON plant_photos(user_id);

ALTER TABLE plant_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view their own plant photos" ON plant_photos
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can add plant photos" ON plant_photos
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own plant photos" ON plant_photos
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own plant photos" ON plant_photos
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ---------- backfill: existing photos become entry one ---------- */

INSERT INTO plant_photos (plant_id, user_id, photo_url, sprite_url, taken_at)
SELECT p.id, p.user_id, p.photo_url, p.sprite_url, COALESCE(p.planted_date, p.created_at)
FROM plants p
WHERE p.photo_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM plant_photos pp WHERE pp.plant_id = p.id);

COMMIT;
