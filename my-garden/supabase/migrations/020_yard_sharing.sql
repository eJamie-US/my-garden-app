-- 020_yard_sharing.sql
-- Real collaboration on one yard: yard_members is the join table everything
-- else now keys access off. A yard's own RLS still (narrowly) requires
-- 'owner' for UPDATE/DELETE — renaming, deleting, or re-photographing the
-- whole yard stays an owner action — but every other yard-scoped table
-- (yard_sections, plants, yard_obstacles, care_items, plant_photos) opens
-- to any member, owner or editor: adding/moving/editing/deleting a plant,
-- obstacle, section, care item, or photo is the shared day-to-day gardening
-- work this feature exists for.
--
-- Every existing yard gets exactly one 'owner' membership row (its current
-- user_id) — zero visible change until someone actually invites a second
-- person, same promise migration 015 made when yards itself was introduced.

BEGIN;

CREATE TABLE IF NOT EXISTS yard_members (
  yard_id UUID NOT NULL REFERENCES yards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (yard_id, user_id)
);

CREATE INDEX IF NOT EXISTS yard_members_user_idx ON yard_members(user_id);

ALTER TABLE yard_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON yard_members TO authenticated;
-- No INSERT grant for `authenticated` — new members are only ever added by
-- the yard-members Edge Function (service-role), which resolves an invited
-- email to a user_id server-side; there's nothing a client-side INSERT
-- policy could safely check on its own.
GRANT SELECT, INSERT, DELETE ON yard_members TO service_role;

-- The yard-members Edge Function's `list` action reads display_name/
-- avatar_icon for each member via service-role (user_settings' own RLS is
-- own-row-only and shouldn't be relaxed just to show a name in a member
-- list) — same service-role-needs-an-explicit-grant gap this project has
-- hit for billing_customers, care_items, and push_subscriptions already.
GRANT SELECT ON user_settings TO service_role;

-- send-due-notifications now fans a due care_item out to every member of
-- that plant's yard (not just the item's own user_id), which means it
-- needs to read plants too, to get from a care_item to its yard_id.
GRANT SELECT ON plants TO service_role;

DO $$ BEGIN
  CREATE POLICY "Members can view a yard's membership" ON yard_members
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_members.yard_id AND m.user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Leave, or an owner removes someone" ON yard_members
    FOR DELETE USING (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM yard_members m
        WHERE m.yard_id = yard_members.yard_id AND m.user_id = auth.uid() AND m.role = 'owner'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: one owner row per existing yard.
INSERT INTO yard_members (yard_id, user_id, role)
SELECT id, user_id, 'owner' FROM yards
ON CONFLICT (yard_id, user_id) DO NOTHING;

/* ---------- yards: SELECT/INSERT open to any member; UPDATE/DELETE owner-only ---------- */

DROP POLICY IF EXISTS "Users can view their own yards" ON yards;
CREATE POLICY "Members can view their yards" ON yards
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yards.id AND m.user_id = auth.uid())
  );

-- INSERT is unchanged in spirit (you can only create a yard as yourself);
-- yardsService.create still writes the matching owner row itself right
-- after, same request, so there's no window where a yard exists with no
-- membership row.
DROP POLICY IF EXISTS "Users can create their own yards" ON yards;
CREATE POLICY "Users can create their own yards" ON yards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own yards" ON yards;
CREATE POLICY "Owners can update their yards" ON yards
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yards.id AND m.user_id = auth.uid() AND m.role = 'owner')
  );

DROP POLICY IF EXISTS "Users can delete their own yards" ON yards;
CREATE POLICY "Owners can delete their yards" ON yards
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yards.id AND m.user_id = auth.uid() AND m.role = 'owner')
  );

/* ---------- yard_sections: any member, all operations ---------- */

DROP POLICY IF EXISTS "Users can view their own yard sections" ON yard_sections;
CREATE POLICY "Members can view yard sections" ON yard_sections
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_sections.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create their own yard sections" ON yard_sections;
CREATE POLICY "Members can create yard sections" ON yard_sections
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_sections.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update their own yard sections" ON yard_sections;
CREATE POLICY "Members can update yard sections" ON yard_sections
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_sections.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete their own yard sections" ON yard_sections;
CREATE POLICY "Members can delete yard sections" ON yard_sections
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_sections.yard_id AND m.user_id = auth.uid())
  );

/* ---------- plants: any member, all operations ---------- */

DROP POLICY IF EXISTS "Users can view their own plants" ON plants;
CREATE POLICY "Members can view yard plants" ON plants
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = plants.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create plants" ON plants;
CREATE POLICY "Members can create yard plants" ON plants
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = plants.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update their own plants" ON plants;
CREATE POLICY "Members can update yard plants" ON plants
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = plants.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete their own plants" ON plants;
CREATE POLICY "Members can delete yard plants" ON plants
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = plants.yard_id AND m.user_id = auth.uid())
  );

/* ---------- yard_obstacles: any member, all operations ---------- */

DROP POLICY IF EXISTS "Users can view their own yard obstacles" ON yard_obstacles;
CREATE POLICY "Members can view yard obstacles" ON yard_obstacles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_obstacles.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create their own yard obstacles" ON yard_obstacles;
CREATE POLICY "Members can create yard obstacles" ON yard_obstacles
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_obstacles.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update their own yard obstacles" ON yard_obstacles;
CREATE POLICY "Members can update yard obstacles" ON yard_obstacles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_obstacles.yard_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete their own yard obstacles" ON yard_obstacles;
CREATE POLICY "Members can delete yard obstacles" ON yard_obstacles
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM yard_members m WHERE m.yard_id = yard_obstacles.yard_id AND m.user_id = auth.uid())
  );

/* ---------- care_items: only a plant_id, so join through plants ---------- */

DROP POLICY IF EXISTS "Users can view their own care items" ON care_items;
CREATE POLICY "Members can view yard care items" ON care_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
      WHERE p.id = care_items.plant_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create care items" ON care_items;
CREATE POLICY "Members can create yard care items" ON care_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
      WHERE p.id = care_items.plant_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own care items" ON care_items;
CREATE POLICY "Members can update yard care items" ON care_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
      WHERE p.id = care_items.plant_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own care items" ON care_items;
CREATE POLICY "Members can delete yard care items" ON care_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
      WHERE p.id = care_items.plant_id AND m.user_id = auth.uid()
    )
  );

/* ---------- plant_photos: only a plant_id, so join through plants ---------- */

DROP POLICY IF EXISTS "Users can view their own plant photos" ON plant_photos;
CREATE POLICY "Members can view yard plant photos" ON plant_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
      WHERE p.id = plant_photos.plant_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can add plant photos" ON plant_photos;
CREATE POLICY "Members can add yard plant photos" ON plant_photos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
      WHERE p.id = plant_photos.plant_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own plant photos" ON plant_photos;
CREATE POLICY "Members can update yard plant photos" ON plant_photos
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
      WHERE p.id = plant_photos.plant_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own plant photos" ON plant_photos;
CREATE POLICY "Members can delete yard plant photos" ON plant_photos
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
      WHERE p.id = plant_photos.plant_id AND m.user_id = auth.uid()
    )
  );

COMMIT;
