// supabase/functions/ai-seed-plan/index.ts
// Proxies a Mistral AI call for seedPlanService.getSeedPlan so the API key
// never ships in the client bundle. Takes just { plantName }; the schema
// prompt and response parsing/fallback stay client-side in seedPlan.ts —
// this only does the one thing that needs a secret.
//
// Mistral (France) over Anthropic here specifically because its free
// "Experiment" tier needs no credit card — good enough for occasional
// personal use. Trade-off: per Mistral's terms, free-tier requests may be
// used to train their models. Plant names aren't sensitive, so that's an
// acceptable trade here, but worth knowing.
//
// Deploy: supabase functions deploy ai-seed-plan
// Secret: supabase secrets set MISTRAL_API_KEY=...  (console.mistral.ai, free)
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/authUser.ts';
import { requirePremium } from '../_shared/entitlement.ts';

const AI_URL = 'https://api.mistral.ai/v1/chat/completions';
const AI_MODEL = Deno.env.get('MISTRAL_MODEL') || 'mistral-small-latest';

// Kept byte-for-byte identical to the prompt seedPlan.ts used to send
// client-side — parsePlan()'s expectations on the client are unchanged.
const SCHEMA_PROMPT = `You are a horticulturist. Given a plant name, return ONLY a JSON object, no prose and no code fence:
{
  "species": "botanical name",
  "method": "direct-sow" | "start-indoors" | "either",
  "sowDepthMm": number,
  "spacingCm": number,
  "startIndoorsWeeksBeforeLastFrost": number | null,
  "germinationDays": [minNumber, maxNumber],
  "daysToHarvestOrBloom": number,
  "soilTempC": [minNumber, maxNumber],
  "steps": ["3 to 6 short imperative steps, in order"],
  "notes": "one short caveat, or omit"
}
Use metric. If the name is not a plant you can raise from seed, return {"error":"not-sowable"}.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('MISTRAL_API_KEY');
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

    // Gated to paying (or comped) plans so a free account can't burn
    // through the project's rate-limited free-tier quota on its own.
    if (!(await requirePremium(user.id))) {
      return new Response(JSON.stringify({ error: 'premium_required' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { plantName } = await req.json();
    const name = typeof plantName === 'string' ? plantName.trim() : '';
    if (!name) {
      return new Response(JSON.stringify({ error: 'plantName required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResponse = await fetch(AI_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: SCHEMA_PROMPT },
          { role: 'user', content: `Plant name: ${name}` },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const detail = await aiResponse.text();
      console.error('Mistral error', aiResponse.status, detail);
      return new Response(JSON.stringify({ error: 'upstream_error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await aiResponse.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('ai-seed-plan error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
