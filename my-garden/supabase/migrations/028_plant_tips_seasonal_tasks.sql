-- 028_plant_tips_seasonal_tasks.sql
-- General-purpose seasonal task list per species — "propagate in spring",
-- "reduce watering for winter dormancy", "repot before new growth" — not
-- limited to a fixed set of task types the app has to know about ahead of
-- time. Each entry carries its own name, its own note, and which months
-- (1-12, Northern-Hemisphere-referenced — the client shifts for Southern
-- Hemisphere yards) it applies. Additive alongside the existing free-text
-- propagation/pruning columns, which plant-tips's per-plant display keeps
-- using unchanged.
--
-- Existing cached rows predate this column and default to '[]' — the
-- plant-tips function's cache-read branch treats that the same as no
-- cached row at all, so an old species transparently re-fetches once and
-- upgrades in place instead of silently staying task-less forever.

BEGIN;

ALTER TABLE plant_tips_cache
  ADD COLUMN IF NOT EXISTS seasonal_tasks JSONB NOT NULL DEFAULT '[]';

COMMIT;
