// supabase/functions/stripe-webhook/index.ts
// The only writer of billing_customers. Registered as a webhook endpoint in
// the Stripe dashboard (or `stripe listen` while developing), pointed at
// this function's URL. Verifies Stripe's signature before trusting anything
// in the body — this endpoint has no other auth, since Stripe itself is the
// caller, not a logged-in browser.
//
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
//   (--no-verify-jwt because Stripe can't send a Supabase JWT; the Stripe
//   signature check below is this endpoint's actual auth)
// Secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// Then in the Stripe dashboard, add an endpoint at this function's URL
// listening for: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted.
import Stripe from 'npm:stripe@17';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { planForPriceId } from '../_shared/plans.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
});

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function upsertFromSubscription(customerId: string, subscription: Stripe.Subscription) {
  const priceId = subscription.items.data[0]?.price.id;
  const plan = planForPriceId(priceId) ?? 'premium';
  const activeStatuses = ['active', 'trialing'];

  await admin()
    .from('billing_customers')
    .update({
      stripe_subscription_id: subscription.id,
      plan: activeStatuses.includes(subscription.status) ? plan : 'free',
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq('stripe_customer_id', customerId);
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!signature || !webhookSecret) {
    return new Response('Webhook not configured', { status: 501 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    // constructEventAsync, not the sync constructEvent — Deno's SubtleCrypto
    // is async-only, so the sync verifier (which works fine in Node) throws
    // here.
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;

        if (session.mode === 'payment') {
          // One-time "lifetime" purchase — no subscription object involved.
          await admin()
            .from('billing_customers')
            .update({ plan: 'lifetime', status: null, current_period_end: null })
            .eq('stripe_customer_id', customerId);
        } else if (session.mode === 'subscription' && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          await upsertFromSubscription(customerId, subscription);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertFromSubscription(subscription.customer as string, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await admin()
          .from('billing_customers')
          .update({ plan: 'free', status: 'canceled' })
          .eq('stripe_customer_id', subscription.customer as string);
        break;
      }

      default:
        // Unhandled event types are fine to ignore — Stripe retries are
        // keyed on a 2xx response, not on us caring about every event type.
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`stripe-webhook error handling ${event.type}`, err);
    // 500 so Stripe retries — a transient DB error shouldn't silently drop
    // a billing update.
    return new Response('Internal error', { status: 500 });
  }
});
