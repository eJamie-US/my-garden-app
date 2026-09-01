// src/services/supabase/billing.ts
// Reads the user's plan (written only by the stripe-webhook Edge Function)
// and starts/manages checkout via the other two. See supabase/functions/
// stripe-* for what actually talks to Stripe.

import { supabase } from '../../lib/supabase';

export type Plan = 'free' | 'premium' | 'lifetime';
export type PlanId = 'premium-monthly' | 'premium-yearly' | 'lifetime';

export interface Entitlement {
  plan: Plan;
  status: string | null;
  currentPeriodEnd: string | null;
}

const FREE: Entitlement = { plan: 'free', status: null, currentPeriodEnd: null };

interface BillingCustomerRow {
  plan: Plan;
  status: string | null;
  current_period_end: string | null;
}

/** True while a subscription/lifetime purchase actually grants access — mirrors requirePremium() server-side. */
export function isActive(e: Entitlement): boolean {
  if (e.plan === 'lifetime') return true;
  if (e.plan !== 'premium') return false;
  if (e.currentPeriodEnd && new Date(e.currentPeriodEnd) < new Date()) return false;
  return e.status === 'active' || e.status === 'trialing';
}

export const billingService = {
  /** No row yet just means "never started a checkout" — that's the free plan, not an error. */
  async getEntitlement(userId: string): Promise<Entitlement> {
    const { data, error } = await supabase
      .from('billing_customers')
      .select('plan, status, current_period_end')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return FREE;
    const row = data as BillingCustomerRow;
    return { plan: row.plan, status: row.status, currentPeriodEnd: row.current_period_end };
  },

  /** Redirects the browser to Stripe Checkout for the given plan. */
  async startCheckout(plan: PlanId): Promise<void> {
    const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
      'stripe-checkout',
      { body: { plan, origin: window.location.origin } },
    );
    if (error || !data?.url) {
      throw new Error(
        data?.error === 'not_configured' || data?.error === 'plan_not_configured'
          ? 'Billing isn’t set up yet.'
          : 'Could not start checkout.',
      );
    }
    window.location.href = data.url;
  },

  /** Redirects the browser to Stripe's hosted billing portal (manage/cancel). */
  async openPortal(): Promise<void> {
    const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
      'stripe-portal',
      { body: { origin: window.location.origin } },
    );
    if (error || !data?.url) {
      throw new Error(
        data?.error === 'no_customer'
          ? 'No billing history yet — upgrade first.'
          : 'Could not open billing management.',
      );
    }
    window.location.href = data.url;
  },
};
