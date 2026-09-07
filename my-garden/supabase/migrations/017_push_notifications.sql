-- 017_push_notifications.sql
-- Real background push notifications ("3 plants need water today") even
-- when the app isn't open — needs somewhere to store each browser's push
-- subscription, plus a daily scheduled call into the Edge Function that
-- actually sends them (see supabase/functions/send-due-notifications).
--
-- The cron job authenticates its call to that function with a shared
-- secret read from Vault at *execution* time (not baked into this file),
-- so nothing sensitive ever needs to live in a migration that's committed
-- to a public repo — see the README-style note at the bottom for how to
-- actually set that secret's value.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can view their own push subscriptions" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can create their own push subscriptions" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can delete their own push subscriptions" ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

-- The send-due-notifications function reads every user's subscriptions
-- with the service-role key, which bypasses RLS but still needs the base
-- table grant — this is the exact gap that silently broke billing reads
-- earlier, fixed proactively here instead of after the fact.
GRANT SELECT ON push_subscriptions TO service_role;

-- pg_cron schedules the daily call; pg_net is what lets a cron job actually
-- make an HTTP request (to invoke the Edge Function).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Placeholder only — vault.create_secret needs *some* value to create the
-- row, but the real secret is set afterward via a one-off, uncommitted
-- `supabase db query` call (see the deploy notes), never through a file
-- that ends up in git history. Re-running this migration must not clobber
-- a real value that's already been set.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret('changeme-set-via-cli', 'cron_secret', 'Shared secret the daily push cron sends to send-due-notifications.');
  END IF;
END $$;

SELECT cron.schedule(
  'send-due-notifications-daily',
  '0 13 * * *', -- 13:00 UTC ≈ 7am Costa Rica (UTC-6) — adjust if the audience moves time zones
  $$
  SELECT net.http_post(
    url := 'https://ptjnzvvgnadbpxscwhkv.supabase.co/functions/v1/send-due-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
