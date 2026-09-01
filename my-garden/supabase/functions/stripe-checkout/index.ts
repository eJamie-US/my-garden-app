// supabase/functions/stripe-checkout/index.ts
// Creates a Stripe Checkout Session for one of the three plans and hands
// the client its URL to redirect to. Promo codes need no extra work here —
// allow_promotion_codes puts Stripe's own "Add promotion code" field on the
// hosted checkout page.
//
// Deploy: supabase functions deploy stripe-checkout
// Secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_PRICE_PREMIUM_MONTHLY=price_...
//   supabase secrets set STRIPE_PRICE_PREMIUM_YEARLY=price_...
//   supabase secrets set STRIPE_PRICE_LIFETIME=price_...
import Stripe from 'npm:stripe@17';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/authUser.ts';
import { priceIdFor, checkoutModeFor, type PlanId } from '../_shared/plans.ts';

const PLAN_IDS: PlanId[] = ['premium-monthly', 'premium-yearly', 'lifetime'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!secretKey) {
      return new Response(JSON.stringify({ error: 'not_configured' }), {
        status: 501,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const user = await requireUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { plan, origin } = await req.json();
    if (!PLAN_IDS.includes(plan)) {
      return new Response(JSON.stringify({ error: 'invalid_plan' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const priceId = priceIdFor(plan);
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'plan_not_configured' }), {
        status: 501,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (typeof origin !== 'string' || !origin.startsWith('http')) {
      return new Response(JSON.stringify({ error: 'origin required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Reuse the Stripe customer if this user already has one (from an
    // earlier checkout, even an abandoned one), so their purchase history
    // stays on one Stripe customer instead of splitting across several.
    const { data: existing } = await admin
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      // Upserted here (plan defaults to 'free') so the row — and its unique
      // stripe_customer_id — exists before checkout even completes; the
      // webhook only ever needs to UPDATE it from here on.
      await admin
        .from('billing_customers')
        .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: checkoutModeFor(plan),
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}?checkout=success`,
      cancel_url: `${origin}?checkout=cancelled`,
      client_reference_id: user.id,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('stripe-checkout error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
