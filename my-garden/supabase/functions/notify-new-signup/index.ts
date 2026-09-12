// supabase/functions/notify-new-signup/index.ts
// Fired once per new account, straight from a database trigger on
// auth.users (see migration 027) via pg_net — not something the client
// ever calls. Tells the owner a new person signed up, since granting
// lifetime access is a manual step done from the app's own "Grant access"
// modal (grant-access Edge Function), not automatic.
//
// Two channels, both best-effort and independent — a push failure doesn't
// block the text, and vice versa:
// - Push, via the same web-push setup send-due-notifications already uses
//   (VAPID keys, push_subscriptions table) — works as soon as the owner's
//   own account has notifications enabled, no extra setup.
// - SMS via Twilio, as a fallback for "I'm not logged in/subscribed
//   anywhere" — only attempted if TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//   TWILIO_FROM_NUMBER, and OWNER_PHONE are all set; silently skipped
//   otherwise (this isn't a request a client is waiting on, so there's no
//   one to show a "not configured" error to).
//
// Auth: shared secret, not a user JWT — the caller is Postgres itself via
// pg_net, same as send-due-notifications. Reuses that function's existing
// CRON_SECRET/X-Cron-Secret pair rather than provisioning a second one.
//
// Deploy: supabase functions deploy notify-new-signup --no-verify-jwt
// Secrets: OWNER_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (all already
// set); optionally TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_FROM_NUMBER, OWNER_PHONE for the text-message fallback.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { corsHeaders } from '../_shared/cors.ts';

const APP_URL = 'https://my-garden-app-476.netlify.app';

async function sendPush(admin: ReturnType<typeof createClient>, ownerId: string, email: string) {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!vapidPublicKey || !vapidPrivateKey) return;
  webpush.setVapidDetails(APP_URL, vapidPublicKey, vapidPrivateKey);

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', ownerId);

  const payload = JSON.stringify({
    title: 'New signup',
    body: `${email} just signed up — tap to grant lifetime access.`,
    url: '/',
  });

  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
    } catch (err) {
      console.error('New-signup push failed for one subscription', err);
    }
  }
}

async function sendText(email: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM_NUMBER');
  const to = Deno.env.get('OWNER_PHONE');
  if (!sid || !token || !from || !to) return;

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: `My Garden: ${email} just signed up. Grant lifetime from the app's account menu.`,
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) console.error('New-signup text failed', res.status, await res.text());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (!cronSecret || req.headers.get('X-Cron-Secret') !== cronSecret) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email } = await req.json();
    if (typeof email !== 'string' || !email) {
      return new Response(JSON.stringify({ error: 'email required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ownerEmail = Deno.env.get('OWNER_EMAIL');
    if (!ownerEmail) {
      return new Response(JSON.stringify({ error: 'not_configured' }), {
        status: 501,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // No admin.getUserByEmail — list + filter, same as grant-access.
    const { data: userList, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;
    const owner = userList.users.find((u) => u.email?.toLowerCase() === ownerEmail.toLowerCase());

    if (owner) {
      await Promise.allSettled([sendPush(admin, owner.id, email), sendText(email)]);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-new-signup error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
