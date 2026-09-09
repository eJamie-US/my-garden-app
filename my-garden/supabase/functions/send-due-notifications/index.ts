// supabase/functions/send-due-notifications/index.ts
// Called once daily by a Postgres cron job (migration 017_push_notifications
// — pg_cron + pg_net, secured with a shared secret read from Vault at
// execution time). Reads every user with something due today or overdue
// (same "no due date counts as due now" rule careDisplay.ts uses client-
// side) and sends each of their subscribed browsers a push notification.
//
// Deploy: supabase functions deploy send-due-notifications --no-verify-jwt
// The --no-verify-jwt is required, not optional — the caller is a cron job
// with a custom X-Cron-Secret header (checked below), not a real user
// session, so Supabase's platform-level JWT gate would otherwise reject it
// with a 401 before this code ever runs (confirmed the hard way once).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET (already set
// alongside the migration — see its comment for how CRON_SECRET's value
// gets into Vault without ever living in a committed file)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { corsHeaders } from '../_shared/cors.ts';

const APP_URL = 'https://my-garden-app-476.netlify.app';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticated by shared secret, not a user JWT — this is invoked by
    // the cron job itself, not from the browser.
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (!cronSecret || req.headers.get('X-Cron-Secret') !== cronSecret) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: 'not_configured' }), {
        status: 501,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    webpush.setVapidDetails(APP_URL, vapidPublicKey, vapidPrivateKey);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const today = new Date().toISOString().slice(0, 10);
    // Same "no due date counts as due now" rule daysUntil()/careDisplay.ts
    // uses client-side, so this matches what Due Today actually shows.
    // Joined through plants → yard_id (not grouped by the item's own
    // user_id) so a shared yard's due count fans out to every member, not
    // just whoever happened to add that particular plant.
    const { data: dueItems, error: dueError } = await admin
      .from('care_items')
      .select('plant_id, plants(yard_id)')
      .or(`next_due_date.lte.${today},next_due_date.is.null`);
    if (dueError) throw dueError;

    const countByYard = new Map<string, number>();
    for (const item of dueItems ?? []) {
      const yardId = (item.plants as { yard_id: string } | null)?.yard_id;
      if (!yardId) continue;
      countByYard.set(yardId, (countByYard.get(yardId) ?? 0) + 1);
    }

    const countByUser = new Map<string, number>();
    if (countByYard.size > 0) {
      const { data: members, error: membersError } = await admin
        .from('yard_members')
        .select('yard_id, user_id')
        .in('yard_id', [...countByYard.keys()]);
      if (membersError) throw membersError;

      for (const member of members ?? []) {
        const count = countByYard.get(member.yard_id) ?? 0;
        countByUser.set(member.user_id, (countByUser.get(member.user_id) ?? 0) + count);
      }
    }
    if (countByUser.size === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: subs, error: subsError } = await admin
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .in('user_id', [...countByUser.keys()]);
    if (subsError) throw subsError;

    let sent = 0;
    const staleEndpoints: string[] = [];

    for (const sub of subs ?? []) {
      const count = countByUser.get(sub.user_id) ?? 0;
      if (count === 0) continue;

      const payload = JSON.stringify({
        title: 'My Garden',
        body: `${count} ${count === 1 ? 'plant needs' : 'plants need'} attention today.`,
        url: '/',
      });

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        // 404/410 = the browser/user revoked or the subscription expired —
        // clean it up so future runs stop retrying a dead endpoint.
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.push(sub.endpoint);
        } else {
          console.error('Push send failed for user', sub.user_id, err);
        }
      }
    }

    if (staleEndpoints.length) {
      await admin.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
    }

    return new Response(JSON.stringify({ sent, staleRemoved: staleEndpoints.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-due-notifications error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
