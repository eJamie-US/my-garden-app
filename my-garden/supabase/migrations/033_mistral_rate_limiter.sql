-- 033_mistral_rate_limiter.sql
-- Mistral's free/default tier caps requests at 1 per second — a burst
-- limit, not a monthly quota, so it never shows up on a usage dashboard
-- (confirmed live: a 429 "Rate limit exceeded" from Mistral while nothing
-- appeared "hit" on the account's own limits page). plant-tips,
-- ai-seed-plan, and ai-plant-diagnosis are three separate Edge Functions —
-- separate Deno isolates with no shared memory — so serializing them
-- against each other needs a shared external gate. This single-row table
-- plus an atomic "reserve the next available slot" UPDATE is that gate;
-- see _shared/mistralThrottle.ts for how it's used.
--
-- RLS is on with no policies at all (unreachable from the browser); per
-- this project's confirmed pattern (plant_tips_cache, 019, and the
-- authenticated-role grant gap hit repeatedly this session), the explicit
-- GRANT below is what actually makes the service-role key's UPDATE work,
-- not RLS-bypass alone.

CREATE TABLE mistral_rate_limiter (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  next_available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO mistral_rate_limiter (id, next_available_at) VALUES (1, NOW());

ALTER TABLE mistral_rate_limiter ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON mistral_rate_limiter TO service_role;

-- Atomically claims the next available time slot, spaced min_interval_ms
-- apart from whatever was already reserved (or from now, if the queue is
-- empty) — concurrent callers each get their own strictly-increasing slot
-- with no double-booking, since the UPDATE is serialized by Postgres's own
-- row lock. Returns the caller's assigned slot time; the caller waits out
-- whatever's left of it before actually calling Mistral.
CREATE OR REPLACE FUNCTION reserve_mistral_slot(min_interval_ms INT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql AS $$
DECLARE
  my_slot TIMESTAMPTZ;
  interval_span INTERVAL := make_interval(secs => min_interval_ms / 1000.0);
BEGIN
  UPDATE mistral_rate_limiter
  SET next_available_at = GREATEST(next_available_at, NOW()) + interval_span
  WHERE id = 1
  RETURNING next_available_at - interval_span INTO my_slot;
  RETURN my_slot;
END;
$$;

GRANT EXECUTE ON FUNCTION reserve_mistral_slot TO service_role;
