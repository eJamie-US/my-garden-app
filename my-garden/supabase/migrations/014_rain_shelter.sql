-- 014_rain_shelter.sql
-- Lets a roofed yard obstacle (building/covered-porch, plus the new
-- 'gazebo' type) record which sides have no wall, and lets a plant record
-- whether it's mounted at the roofline (a hanging basket) versus sitting
-- or planted below it. Together with wind direction from the weather API,
-- this is enough to compute whether a plant is actually getting rained on
-- right now instead of asking the user to just check a "sheltered" box —
-- see utils/rainShelter.ts. NULL/empty open_edges means fully enclosed
-- (a house); NULL mount means 'ground'. Safe to run more than once.

ALTER TABLE yard_obstacles DROP CONSTRAINT IF EXISTS yard_obstacles_type_check;
ALTER TABLE yard_obstacles ADD CONSTRAINT yard_obstacles_type_check
  CHECK (type IN ('building', 'covered-porch', 'gazebo', 'shade-sail', 'tree', 'fence'));

ALTER TABLE yard_obstacles ADD COLUMN IF NOT EXISTS open_edges JSONB;

ALTER TABLE plants ADD COLUMN IF NOT EXISTS mount TEXT CHECK (mount IN ('ground', 'hanging'));
