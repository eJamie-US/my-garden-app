-- 011_shade_sail_obstacle.sql
-- Adds 'shade-sail' (a sun tarp/shade cloth strung up over open ground,
-- with nothing to attach it to a building) as a yard obstacle type — the
-- existing types all implicitly assume something structural.
-- Safe to run more than once.

BEGIN;

ALTER TABLE yard_obstacles DROP CONSTRAINT IF EXISTS yard_obstacles_type_check;
ALTER TABLE yard_obstacles ADD CONSTRAINT yard_obstacles_type_check
  CHECK (type IN ('building', 'covered-porch', 'shade-sail', 'tree', 'fence'));

COMMIT;
