// supabase/functions/plant-id/index.ts
// Proxies Pl@ntNet identification so the API key never ships in the client
// bundle. Takes the same multipart form the client already builds (images +
// organs + project) and forwards it with the server-side key. Response
// shape is passed through untouched — identify.ts's mapCandidate/scoring
// logic stays exactly as it was, just pointed at this function instead of
// Pl@ntNet directly.
//
// Deploy: supabase functions deploy plant-id
// Secret: supabase secrets set PLANTNET_API_KEY=...
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/authUser.ts';
import { requirePremium } from '../_shared/entitlement.ts';

const API_BASE = Deno.env.get('PLANTNET_API_URL') || 'https://my-api.plantnet.org/v2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('PLANTNET_API_KEY');
    if (!apiKey) {
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

    // Pl@ntNet identifications are metered too — same reasoning as
    // ai-seed-plan: this stays behind a paying plan.
    if (!(await requirePremium(user.id))) {
      return new Response(JSON.stringify({ error: 'premium_required' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const incoming = await req.formData();
    const project = (incoming.get('project') as string) || 'all';

    const forward = new FormData();
    for (const [key, value] of incoming.entries()) {
      if (key === 'project') continue;
      forward.append(key, value);
    }

    const url = new URL(`${API_BASE}/identify/${project}`);
    url.searchParams.set('api-key', apiKey);
    url.searchParams.set('include-related-images', 'true');

    const plantnetResponse = await fetch(url, { method: 'POST', body: forward });
    const body = await plantnetResponse.json();

    // Always 200 here, whatever Pl@ntNet answered — this call did its job
    // (proxied the request). The client's status-code switch (401/404/429/…)
    // reads `status`/`body` from this envelope instead of the HTTP status,
    // so it isn't at the mercy of how the invoking client's library
    // surfaces a non-2xx response.
    return new Response(JSON.stringify({ status: plantnetResponse.status, body }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('plant-id error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
