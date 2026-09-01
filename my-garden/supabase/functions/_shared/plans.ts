// supabase/functions/_shared/plans.ts
// The three purchasable plans and their Stripe Price IDs, read from secrets
// so pricing/products can change in the Stripe dashboard without a
// redeploy. Set with e.g.:
//   supabase secrets set STRIPE_PRICE_PREMIUM_MONTHLY=price_...
export type PlanId = 'premium-monthly' | 'premium-yearly' | 'lifetime';

export function priceIdFor(plan: PlanId): string | undefined {
  switch (plan) {
    case 'premium-monthly':
      return Deno.env.get('STRIPE_PRICE_PREMIUM_MONTHLY');
    case 'premium-yearly':
      return Deno.env.get('STRIPE_PRICE_PREMIUM_YEARLY');
    case 'lifetime':
      return Deno.env.get('STRIPE_PRICE_LIFETIME');
  }
}

/** 'premium-monthly'/'premium-yearly' are subscriptions; 'lifetime' is a one-time payment. */
export function checkoutModeFor(plan: PlanId): 'subscription' | 'payment' {
  return plan === 'lifetime' ? 'payment' : 'subscription';
}

/** Inverse lookup, for the webhook figuring out what a Stripe price ID means. */
export function planForPriceId(priceId: string | undefined): 'premium' | 'lifetime' | null {
  if (!priceId) return null;
  if (priceId === Deno.env.get('STRIPE_PRICE_LIFETIME')) return 'lifetime';
  if (
    priceId === Deno.env.get('STRIPE_PRICE_PREMIUM_MONTHLY') ||
    priceId === Deno.env.get('STRIPE_PRICE_PREMIUM_YEARLY')
  ) {
    return 'premium';
  }
  return null;
}
