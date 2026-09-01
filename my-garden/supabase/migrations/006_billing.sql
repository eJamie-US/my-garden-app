-- 006_billing.sql
-- One row per user tracking their plan. Written ONLY by the stripe-webhook
-- Edge Function (via the service-role key, which bypasses RLS) — a user
-- can read their own row but never write it directly, otherwise anyone
-- could grant themselves premium with a client-side update() call.
-- Only adds things. Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS billing_customers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium', 'lifetime')),
  -- Stripe subscription status ('active', 'trialing', 'past_due', 'canceled', ...).
  -- Null for 'free' and 'lifetime', which aren't subscriptions.
  status TEXT,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;

-- Deliberately no INSERT/UPDATE/DELETE grant to `authenticated` — only
-- SELECT. Writes happen exclusively via the webhook's service-role client.
GRANT SELECT ON billing_customers TO authenticated;

DO $$ BEGIN
  CREATE POLICY "Users can view their own billing row" ON billing_customers
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS billing_customers_touch_updated_at ON billing_customers;
CREATE TRIGGER billing_customers_touch_updated_at
  BEFORE UPDATE ON billing_customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
