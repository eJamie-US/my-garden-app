// supabase/functions/_shared/entitlement.ts
// Server-side "is this user actually premium" check for gating paid
// features (AI lookups that cost real money per call). Checking only on
// the client would be decorative — anyone could call the function directly
// and skip it. Uses the service-role key: billing_customers only grants
// SELECT-your-own-row to `authenticated`, and the webhook is the only
// writer, so this needs to bypass RLS to read reliably from here.
//
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically in
// every Edge Function's environment — no `secrets set` needed for these.
import { createClient } from 'jsr:@supabase/supabase-js@2';

export async function requirePremium(userId: string): Promise<boolean> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data } = await admin
    .from('billing_customers')
    .select('plan, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return false;
  if (data.plan === 'lifetime') return true;
  if (data.plan !== 'premium') return false;
  // A subscription is good until its current period actually ends, even if
  // it's set to cancel (status stays 'active' until then) or briefly lags
  // behind a payment retry — current_period_end is the source of truth.
  if (data.current_period_end && new Date(data.current_period_end) < new Date()) return false;
  return data.status === 'active' || data.status === 'trialing';
}
