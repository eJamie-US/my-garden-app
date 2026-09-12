// supabase/functions/ai-plant-diagnosis/index.ts
// Proxies a Mistral vision call for plantDiagnosisService.diagnose so the
// API key never ships in the client bundle. Takes a photo (base64) and
// returns raw model text; the schema prompt and response parsing/validation
// stay client-side in plantDiagnosis.ts, same division of labor as
// ai-seed-plan.
//
// Same Mistral-over-Anthropic reasoning as ai-seed-plan (see its comment) —
// free tier needs no credit card, at the cost of free-tier requests
// possibly training their models. A garden photo isn't sensitive, so that
// trade-off carries over here.
//
// Deploy: supabase functions deploy ai-plant-diagnosis
// Secret: reuses MISTRAL_API_KEY (already set for ai-seed-plan)
import { corsHeaders } from '../_shared/cors.ts';
import { requireUser } from '../_shared/authUser.ts';
import { requirePremium } from '../_shared/entitlement.ts';

const AI_URL = 'https://api.mistral.ai/v1/chat/completions';
// Pixtral is Mistral's vision-capable model — mistral-small-latest (used by
// ai-seed-plan) is text-only.
const AI_MODEL = Deno.env.get('MISTRAL_VISION_MODEL') || 'pixtral-12b-2409';

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

// Kept in sync with parseDiagnosis() in plantDiagnosis.ts — that's what
// actually validates this shape once it comes back.
const SCHEMA_PROMPT = `You are a horticulturist doing a thorough visual health check on a photo of a houseplant or garden plant. Examine it carefully for every one of these categories of ailment before answering — most photos will only show one or two, but check for all of them:
- sun damage (scorched or bleached patches, usually on the sun-facing side)
- not enough sun (leggy/stretched growth, pale or undersized new leaves, reaching toward a light source)
- overwatering (yellowing lower leaves, soft or mushy stems, mold, fungus gnats, root rot smell/signs at the base)
- underwatering (crispy brown leaf edges, wilting, soil pulling away from the pot)
- pests — name the specific pest if you can tell (aphids, spider mites, mealybugs, scale, whitefly, thrips, fungus gnats, etc.); look for webbing, honeydew, stippling, sooty mold, or visible insects
- disease — name the specific one if you can tell (powdery mildew, leaf spot, blight, rust, root rot, bacterial soft rot, mosaic virus, etc.); look for spots, lesions, powdery/fuzzy coating, unusual discoloration patterns, or distorted new growth
- nutrient deficiency (chlorosis — yellowing between leaf veins on new growth suggests iron; yellowing of older leaves suggests nitrogen; browning leaf-tip/edge scorch suggests potassium; general paleness or stunted growth); use "needs-fertilizer" for this whether or not you can pin down which nutrient
- needs trimming/pruning (leggy, overcrowded, or dead/yellowing growth that should be removed)
- needs repotting (roots visibly circling or emerging from drainage holes, plant much larger than its pot, water running straight through without absorbing)
- temperature stress (cold/frost damage — blackened or water-soaked tissue; heat stress — crispy scorched margins on multiple leaves at once, distinct from watering issues)
- low humidity (crispy brown leaf tips specifically, especially on tropical/thin-leaved houseplants, without the wilting typical of underwatering)

Return ONLY a JSON object, no prose and no code fence:
{
  "plantVisible": boolean,
  "overallHealth": "healthy" | "stressed" | "unhealthy",
  "findings": [
    {
      "category": "sun-damage" | "not-enough-sun" | "overwatering" | "underwatering" | "pest" | "disease" | "needs-trim" | "needs-fertilizer" | "needs-repotting" | "temperature-stress" | "low-humidity" | "other",
      "label": "short name, e.g. Aphids, Powdery mildew, or Sunburn",
      "confidence": "low" | "medium" | "high",
      "observation": "one short sentence describing exactly what you see in the photo",
      "remedy": "one short, specific, actionable suggestion"
    }
  ]
}
Only include a finding when you actually see evidence for it — do not guess or pad the list. An empty findings array is a fine, honest answer for a plant that looks healthy.

CRITICAL SAFETY RULE for every remedy: this household has pets and local wildlife (birds, bees, and other pollinators) around the plant. Every remedy must be safe around animals — prefer manual removal, pruning, insecticidal soap, or horticultural/neem oil (kept off pets until it dries) over any chemical pesticide. NEVER suggest systemic neonicotinoid pesticides, metaldehyde slug pellets, or anything toxic to pets, birds, or bees. If no genuinely safe remedy is obvious, say so in the remedy field rather than suggesting something unsafe.

If the photo doesn't clearly show a plant, return {"plantVisible": false, "overallHealth": "healthy", "findings": []}.`;

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

    // Gated to paying (or comped) plans, same as ai-seed-plan — a vision
    // call is more expensive than a text one, so this matters even more here.
    if (!(await requirePremium(user.id))) {
      return new Response(JSON.stringify({ error: 'premium_required' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { imageBase64, mimeType, knownIssues, locale } = await req.json();
    if (typeof imageBase64 !== 'string' || !imageBase64) {
      return new Response(JSON.stringify({ error: 'imageBase64 required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const mime = typeof mimeType === 'string' && mimeType ? mimeType : 'image/jpeg';
    const language = LANGUAGE_NAMES[locale] ?? LANGUAGE_NAMES.en;

    // Plain labels the owner noted by hand on this plant (Plant.knownIssues)
    // — a partially-treated problem can look ambiguous in a single photo,
    // so naming it steers the model to specifically check for lingering
    // signs rather than judging fresh with no history.
    const issues = Array.isArray(knownIssues)
      ? knownIssues.filter((i): i is string => typeof i === 'string' && i.trim()).slice(0, 10)
      : [];
    const knownIssuesPrompt = issues.length
      ? `\n\nThe owner has noted these known/suspected issues on this specific plant, which may be partially treated: ${issues.join('; ')}. Look carefully for any remaining signs of these specifically, in addition to anything else you notice.`
      : '';
    // "overallHealth", "category", and "confidence" are fixed enums the
    // client matches literally (see parseDiagnosis() in plantDiagnosis.ts)
    // — translating them would silently break parsing for every non-English
    // locale, so they're called out by name to stay in English regardless.
    const languagePrompt = `\n\nRespond in ${language}, using natural, fluent, locale-appropriate gardening terminology for "label", "observation", and "remedy" in each finding. Leave "overallHealth" (healthy/stressed/unhealthy), "category", and "confidence" (low/medium/high) exactly as their English enum values regardless of language — those are read by code, not shown translated.`;

    const aiResponse = await fetch(AI_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: SCHEMA_PROMPT + knownIssuesPrompt + languagePrompt },
              { type: 'image_url', image_url: `data:${mime};base64,${imageBase64}` },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const detail = await aiResponse.text();
      console.error('Mistral vision error', aiResponse.status, detail);
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
    console.error('ai-plant-diagnosis error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
