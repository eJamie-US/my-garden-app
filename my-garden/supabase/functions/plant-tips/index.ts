// supabase/functions/plant-tips/index.ts
// General per-species care knowledge for a plant already in someone's
// garden — propagation method/season, pruning season, ideal temperature
// range, and a general-purpose seasonal task list. Distinct from
// ai-seed-plan (that one's specifically about starting a NEW plant from
// seed: sow depth, germination days, frost timing — irrelevant for e.g. a
// houseplant usually propagated by stem cuttings, not seed) and
// ai-plant-diagnosis (photo-based ailment detection for THIS plant's
// current condition, not general species facts).
//
// The answer is the same for every plant of a given species regardless of
// whose garden it's in, so it's cached in plant_tips_cache (migration 019)
// by a normalized species key — a repeat lookup costs one Mistral call
// total, not one per plant/user that asks. Parsing/validating the model's
// JSON happens here (not client-side, unlike ai-seed-plan/ai-plant-
// diagnosis) specifically because this function also needs structured
// fields to write into that cache table.
//
// Deploy: supabase functions deploy plant-tips
// Secret: reuses MISTRAL_API_KEY (already set for ai-seed-plan/ai-plant-diagnosis)
import { createClient } from 'jsr:@supabase/supabase-js@2';
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

const SCHEMA_PROMPT = `You are a horticulturist. Given a plant's name/species, return ONLY a JSON object, no prose and no code fence:
{
  "propagationMethod": "the typical way to propagate an already-established plant of this kind — e.g. stem cuttings in water, division, offsets/pups, air layering, leaf cuttings — NOT from seed unless that's genuinely the usual way this plant is propagated",
  "propagationSeason": "best time of year, e.g. Spring to early summer",
  "pruningSeason": "best time of year to prune/trim, with a short reason why",
  "idealTempRange": "comfortable temperature range, e.g. 18-27°C (65-80°F)",
  "notes": "one short, genuinely useful extra tip specific to this plant, or an empty string if nothing stands out",
  "seasonalTasks": [
    {
      "task": "short imperative name for the task, e.g. Propagate, Prune, Repot, Divide, Reduce watering (dormancy), Move indoors before frost, Stop fertilizing, Deadhead, Stake, Harvest seed",
      "months": [array of 1-12 integers for the months this task genuinely applies, Northern Hemisphere reference — 1=January],
      "note": "one short sentence on why/how, specific to this plant"
    }
  ]
}
List EVERY seasonal task that genuinely applies to this species, not just propagation/pruning — dormancy care, repotting, dividing, moving indoors/outdoors, fertilizing pauses, deadheading, staking, seed harvest, and anything else a real horticulturist would flag for a specific month, whichever apply. An empty array is a fine, honest answer for a plant with nothing seasonal to flag. Don't force a fixed number of entries.
If the name isn't recognizable as a real plant, return {"error":"not-a-plant"} instead.`;

interface SeasonalTask {
  task: string;
  months: number[];
  note: string;
}

interface Tips {
  propagationMethod: string;
  propagationSeason: string;
  pruningSeason: string;
  idealTempRange: string;
  notes: string;
  seasonalTasks: SeasonalTask[];
}

function parseSeasonalTasks(value: unknown): SeasonalTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: SeasonalTask[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const task = (entry as Record<string, unknown>).task;
    const months = (entry as Record<string, unknown>).months;
    const note = (entry as Record<string, unknown>).note;
    if (typeof task !== 'string' || !task.trim()) continue;
    if (!Array.isArray(months)) continue;
    const cleanMonths = months.filter(
      (m): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= 12,
    );
    if (!cleanMonths.length) continue;
    tasks.push({ task, months: cleanMonths, note: typeof note === 'string' ? note : '' });
  }
  return tasks;
}

function parseTips(text: string): Tips | null {
  try {
    const cleaned = text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(cleaned);
    if (parsed.error) return null;
    if (
      typeof parsed.propagationMethod !== 'string' ||
      typeof parsed.propagationSeason !== 'string' ||
      typeof parsed.pruningSeason !== 'string' ||
      typeof parsed.idealTempRange !== 'string'
    ) {
      return null;
    }
    return {
      propagationMethod: parsed.propagationMethod,
      propagationSeason: parsed.propagationSeason,
      pruningSeason: parsed.pruningSeason,
      idealTempRange: parsed.idealTempRange,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      seasonalTasks: parseSeasonalTasks(parsed.seasonalTasks),
    };
  } catch {
    return null;
  }
}

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

    // Gated to paying (or comped) plans, same as ai-seed-plan and
    // ai-plant-diagnosis — a shared free-tier Mistral quota needs this even
    // though caching keeps repeat-species cost down.
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
    // Falls back to English for anything unrecognized — an unset/bad
    // locale shouldn't 400 the whole request.
    const localeCode = typeof locale === 'string' && LANGUAGE_NAMES[locale] ? locale : 'en';
    const language = LANGUAGE_NAMES[localeCode];

    const speciesKey = name.toLowerCase();
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: cached } = await admin
      .from('plant_tips_cache')
      .select('propagation_method, propagation_season, pruning_season, ideal_temp_range, notes, seasonal_tasks')
      .eq('species_key', speciesKey)
      .eq('locale', localeCode)
      .maybeSingle();

    // An empty seasonal_tasks array is treated the same as "no cached row
    // at all" — it means this row predates the column (migration 028) and
    // was never actually asked about seasonal tasks, not that the model
    // genuinely found none. Re-fetching upgrades it in place.
    if (cached && Array.isArray(cached.seasonal_tasks) && cached.seasonal_tasks.length > 0) {
      return new Response(
        JSON.stringify({
          tips: {
            propagationMethod: cached.propagation_method,
            propagationSeason: cached.propagation_season,
            pruningSeason: cached.pruning_season,
            idealTempRange: cached.ideal_temp_range,
            notes: cached.notes,
            seasonalTasks: cached.seasonal_tasks,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
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
          {
            role: 'system',
            content: `${SCHEMA_PROMPT}\n\nRespond in ${language}, using natural, fluent, locale-appropriate gardening terminology — every string value in the JSON (including each seasonal task's "task" name and "note"), not just "notes".`,
          },
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
    const tips = parseTips(text);

    if (!tips) {
      return new Response(JSON.stringify({ error: 'not_a_plant' }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Best-effort cache write — a failure here shouldn't fail the request
    // the user is actually waiting on; it just means the next lookup for
    // this species pays for another Mistral call instead of hitting cache.
    const { error: cacheError } = await admin.from('plant_tips_cache').upsert(
      {
        species_key: speciesKey,
        locale: localeCode,
        propagation_method: tips.propagationMethod,
        propagation_season: tips.propagationSeason,
        pruning_season: tips.pruningSeason,
        ideal_temp_range: tips.idealTempRange,
        notes: tips.notes,
        seasonal_tasks: tips.seasonalTasks,
      },
      { onConflict: 'species_key,locale' },
    );
    if (cacheError) console.error('plant_tips_cache write failed', cacheError);

    return new Response(JSON.stringify({ tips }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('plant-tips error', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
