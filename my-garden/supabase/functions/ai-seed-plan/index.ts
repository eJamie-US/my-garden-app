// supabase/functions/ai-seed-plan/index.ts
// Proxies the Anthropic call for seedPlanService.getSeedPlan so the API key
// never ships in the client bundle. Takes just { plantName }; the schema
// prompt and response parsing/fallback stay client-side in seedPlan.ts —
// this only does the one thing that needs a secret.
//
// Deploy: supabase functions deploy ai-seed-plan
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/authUser.ts';
import { requirePremium } from '../_shared/entitlement.ts';

const AI_URL = 'https://api.anthropic.com/v1/messages';
const AI_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-4-5';

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
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
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

    // AI lookups cost real money per call — gated to paying plans so a free
    // account can't run up the project's Anthropic bill.
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
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 700,
        system: SCHEMA_PROMPT,
        messages: [{ role: 'user', content: `Plant name: ${name}` }],
      }),
    });

    if (!aiResponse.ok) {
      const detail = await aiResponse.text();
      console.error('Anthropic error', aiResponse.status, detail);
      return new Response(JSON.stringify({ error: 'upstream_error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await aiResponse.json();
    const text: string =
      data?.content?.map?.((part: { text?: string }) => part?.text ?? '').join('') ?? '';

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
