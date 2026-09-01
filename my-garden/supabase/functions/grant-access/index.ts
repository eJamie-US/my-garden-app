// supabase/functions/grant-access/index.ts
// Lets the app owner comp a friend's account (or their own) straight to
// Premium/Lifetime, without a Stripe checkout — for letting people try it.
// Gated on OWNER_EMAIL, a secret only the project owner's Supabase account
// knows how to set; anyone else calling this gets a plain 403.
//
// Deploy: supabase functions deploy grant-access
// Secret: supabase secrets set OWNER_EMAIL=you@example.com
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/authUser.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const ownerEmail = Deno.env.get('OWNER_EMAIL');
    if (!ownerEmail) {
      return new Response(JSON.stringify({ error: 'not_configured' }), {
        status: 501,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const caller = await requireUser(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (caller.email?.toLowerCase() !== ownerEmail.toLowerCase()) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, plan } = await req.json();
    if (typeof email !== 'string' || !email.trim()) {
      return new Response(JSON.stringify({ error: 'email required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (plan !== 'premium' && plan !== 'lifetime' && plan !== 'free') {
      return new Response(JSON.stringify({ error: 'plan must be premium, lifetime, or free' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // No admin.getUserByEmail — list + filter is the documented way.
    const { data: userList, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;
    const target = userList.users.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());
    if (!target) {
      return new Response(JSON.stringify({ error: 'user_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (plan === 'free') {
      await admin
        .from('billing_customers')
        .update({ plan: 'free', status: null, current_period_end: null })
        .eq('user_id', target.id);
    } else {
      await admin
        .from('billing_customers')
        .upsert(
          { user_id: target.id, plan, status: null, current_period_end: null },
          { onConflict: 'user_id' },
        );
    }

    return new Response(JSON.stringify({ ok: true, email: target.email, plan }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('grant-access error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
