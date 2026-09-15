-- 031_care_completions.sql
-- Completing a care item today is a one-way in-place UPDATE (see
-- careItemsService.complete) — the previous last_completed_at/next_due_date
-- are simply overwritten, so there's no way to undo a mistaken completion
-- and no history of past completions at all. This adds:
--   1. An append-only log (care_completions) snapshotting the pre-completion
--      state of each care_items row, so "undo" is just "restore from the
--      most recent log row for this item, then delete that row."
--   2. Two SECURITY DEFINER RPCs (complete_care_item / undo_last_completion)
--      that do the log-insert + care_items-update atomically — two separate
--      client calls would leave a gap where a dropped connection completes
--      the task with no log row to undo it from. Same tool this project
--      already reached for in 023_create_yard_with_owner_rpc.sql for an
--      analogous atomicity problem.
--   3. A retention setting on user_settings + a daily pg_cron purge (pure
--      SQL, no pg_net/Edge Function needed — reuses the pg_cron extension
--      already enabled for 017's push-notification cron).
--
-- RLS mirrors care_items' own policy exactly (020_yard_sharing.sql): access
-- is yard membership via plants JOIN yard_members, not user_id = auth.uid().
-- Per this project's confirmed recurring bug (024/026/029/030 — RLS added
-- without the matching table GRANT), the GRANT below is not optional.

CREATE TABLE care_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  care_item_id UUID NOT NULL REFERENCES care_items(id) ON DELETE CASCADE,
  plant_id UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL,
  previous_last_completed_at TIMESTAMPTZ,
  previous_next_due_date DATE,
  new_next_due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX care_completions_care_item_idx ON care_completions(care_item_id, completed_at DESC);
CREATE INDEX care_completions_plant_idx ON care_completions(plant_id, completed_at DESC);
CREATE INDEX care_completions_user_created_idx ON care_completions(user_id, created_at);

ALTER TABLE care_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view yard care completions" ON care_completions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
            WHERE p.id = care_completions.plant_id AND m.user_id = auth.uid())
  );

CREATE POLICY "Members can create yard care completions" ON care_completions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
            WHERE p.id = care_completions.plant_id AND m.user_id = auth.uid())
  );

CREATE POLICY "Members can delete yard care completions" ON care_completions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
            WHERE p.id = care_completions.plant_id AND m.user_id = auth.uid())
  );
-- No UPDATE policy — rows are only ever inserted or deleted, never edited in place.

GRANT SELECT, INSERT, DELETE ON care_completions TO authenticated;

-- Mirrors src/services/care/generateCareItems.ts's nextDueFrom exactly, so
-- the RPC below can roll a due date forward without a round trip to the client.
CREATE OR REPLACE FUNCTION next_due_from(p_every INT, p_unit TEXT, p_from TIMESTAMPTZ)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE p_unit
    WHEN 'day' THEN p_from + (p_every || ' days')::interval
    WHEN 'week' THEN p_from + (p_every || ' weeks')::interval
    WHEN 'month' THEN p_from + (p_every || ' months')::interval
    WHEN 'year' THEN p_from + (p_every || ' years')::interval
  END)::date;
$$;

CREATE OR REPLACE FUNCTION complete_care_item(p_care_item_id UUID, p_when TIMESTAMPTZ DEFAULT NOW())
RETURNS care_items LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item care_items;
  updated care_items;
  next_due DATE;
BEGIN
  SELECT * INTO item FROM care_items WHERE id = p_care_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'care item not found';
  END IF;

  -- SECURITY DEFINER bypasses RLS, so re-check the same membership rule
  -- care_items' own policies enforce, by hand.
  IF NOT EXISTS (
    SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
    WHERE p.id = item.plant_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  next_due := next_due_from(item.frequency_every, item.frequency_unit, p_when);

  INSERT INTO care_completions (
    care_item_id, plant_id, user_id, completed_at,
    previous_last_completed_at, previous_next_due_date, new_next_due_date
  ) VALUES (
    item.id, item.plant_id, auth.uid(), p_when,
    item.last_completed_at, item.next_due_date, next_due
  );

  UPDATE care_items
  SET last_completed_at = p_when, next_due_date = next_due, updated_at = NOW()
  WHERE id = item.id
  RETURNING * INTO updated;

  RETURN updated;
END;
$$;

GRANT EXECUTE ON FUNCTION complete_care_item TO authenticated;

CREATE OR REPLACE FUNCTION undo_last_completion(p_care_item_id UUID)
RETURNS care_items LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item care_items;
  last_row care_completions;
  updated care_items;
BEGIN
  SELECT * INTO item FROM care_items WHERE id = p_care_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'care item not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM plants p JOIN yard_members m ON m.yard_id = p.yard_id
    WHERE p.id = item.plant_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Always the top of the stack: repeated undos walk back one completion
  -- at a time, each restoring the state from immediately before that
  -- specific completion, never skipping past intermediate ones.
  SELECT * INTO last_row FROM care_completions
  WHERE care_item_id = p_care_item_id
  ORDER BY completed_at DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'nothing to undo';
  END IF;

  UPDATE care_items
  SET last_completed_at = last_row.previous_last_completed_at,
      next_due_date = last_row.previous_next_due_date,
      updated_at = NOW()
  WHERE id = item.id
  RETURNING * INTO updated;

  DELETE FROM care_completions WHERE id = last_row.id;

  RETURN updated;
END;
$$;

GRANT EXECUTE ON FUNCTION undo_last_completion TO authenticated;

-- Retention preference. NOT NULL with a default so every existing account
-- is covered with no onboarding gap, same convention as sun_requirement
-- (002_care_items.sql). Default '1_week' per the user's own preference,
-- given they plan to backdate completions up to 3 days.
ALTER TABLE user_settings
  ADD COLUMN care_history_retention TEXT NOT NULL DEFAULT '1_week';
ALTER TABLE user_settings
  ADD CONSTRAINT valid_care_history_retention CHECK (
    care_history_retention IN ('1_day', '1_week', '1_month', '6_months', '1_year', 'forever')
  );

-- Daily purge. Uses created_at (when the row was *logged*), not
-- completed_at (the possibly-backdated value) — so backdating a completion
-- to 3 days ago does not make it immediately stale for purge purposes; its
-- retention clock starts fresh from the moment it's actually recorded.
-- Runs as the migration-owner role (bypasses RLS by ownership), same as any
-- other scheduled maintenance — no pg_net/Edge Function needed since this
-- is a plain DELETE, unlike 017's cron which had to call out over HTTP.
SELECT cron.schedule(
  'purge-old-care-completions-daily',
  '0 12 * * *',
  $$
  DELETE FROM care_completions cc USING user_settings us
  WHERE us.user_id = cc.user_id
    AND us.care_history_retention <> 'forever'
    AND cc.created_at < NOW() - (CASE us.care_history_retention
      WHEN '1_day' THEN INTERVAL '1 day'
      WHEN '1_week' THEN INTERVAL '1 week'
      WHEN '1_month' THEN INTERVAL '1 month'
      WHEN '6_months' THEN INTERVAL '6 months'
      WHEN '1_year' THEN INTERVAL '1 year'
    END);
  $$
);
