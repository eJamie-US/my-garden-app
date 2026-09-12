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

// Keep in sync with SUPPORTED_LOCALES in src/i18n.ts — small enough right
// now to duplicate rather than share a file across the Vite/Deno boundary.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  zh: 'Chinese (Simplified)',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  it: 'Italian',
  ko: 'Korean',
  pl: 'Polish',
  nl: 'Dutch',
};

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

    const { plantName, locale } = await req.json();
    const name = typeof plantName === 'string' ? plantName.trim() : '';
    if (!name) {
      return new Response(JSON.stringify({ error: 'plantName required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const language = LANGUAGE_NAMES[locale] ?? LANGUAGE_NAMES.en;
    // "method" is a fixed enum parsePlan() matches against literally
    // (direct-sow/start-indoors/either) — translating it would break
    // parsing, so it's called out by name to stay in English regardless
    // of the rest of the response's language.
    const languagePrompt = `\n\nRespond in ${language}: translate "steps" and "notes" (and "species"' common-name portion, if it includes one — keep any botanical/Latin name as-is) into natural, fluent, locale-appropriate gardening language. Leave the "method" field exactly as one of direct-sow/start-indoors/either in English regardless — it's read by code, not shown translated.`;

    const aiResponse = await fetch(AI_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: SCHEMA_PROMPT + languagePrompt },
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
