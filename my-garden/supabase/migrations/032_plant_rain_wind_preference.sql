-- 032_plant_rain_wind_preference.sql
-- evaluatePlacement (src/utils/bestPlacement.ts) scored almost entirely on
-- sun match — rain added a token few points, wind wasn't scored at all. A
-- plant's only usable preference was sunRequirement (3 values), so any two
-- plants sharing it always got the exact same suggested spots. These two
-- new preferences mirror sun_requirement's own shape exactly (002_care_items.sql):
-- NOT NULL with a neutral default, so every existing plant is scored
-- immediately with no onboarding gap.

ALTER TABLE plants ADD COLUMN IF NOT EXISTS rain_preference TEXT NOT NULL DEFAULT 'neutral';
ALTER TABLE plants ADD CONSTRAINT valid_rain_preference CHECK (
  rain_preference IN ('prefers-dry', 'neutral', 'prefers-wet')
);

ALTER TABLE plants ADD COLUMN IF NOT EXISTS wind_tolerance TEXT NOT NULL DEFAULT 'hardy';
ALTER TABLE plants ADD CONSTRAINT valid_wind_tolerance CHECK (
  wind_tolerance IN ('fragile', 'hardy')
);
