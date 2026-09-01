-- 012_obstacle_shapes.sql
-- Lets a yard obstacle carry an actual size/footprint (circle, line,
-- rectangle, or triangle) instead of just a point. NULL `shape` means
-- "just a point" — existing rows keep working exactly as before; the
-- exposure math (sunExposure.ts) treats that the same way it always did.
-- Safe to run more than once.

ALTER TABLE yard_obstacles ADD COLUMN IF NOT EXISTS shape jsonb;
