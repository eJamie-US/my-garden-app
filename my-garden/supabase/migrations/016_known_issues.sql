-- 016_known_issues.sql
-- Lets a plant carry a short list of known/suspected ongoing problems the
-- owner has noted by hand — e.g. "spider mites, partially treated" — that
-- a single photo might not show clearly enough for the AI health check
-- (supabase/functions/ai-plant-diagnosis) to catch on its own. Passed as
-- context into that prompt so it specifically watches for lingering signs
-- instead of only judging the photo fresh. Safe to run more than once.

ALTER TABLE plants ADD COLUMN IF NOT EXISTS known_issues JSONB NOT NULL DEFAULT '[]'::jsonb;
