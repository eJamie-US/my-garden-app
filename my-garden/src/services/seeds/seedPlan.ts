// src/services/seeds/seedPlan.ts
// Sowing plan for a plant NAME (no photo — there is nothing to photograph yet).
// Asks an LLM for the plan, validates the shape, and falls back to a local table
// when the key is missing, the call fails, or the answer doesn't parse.

import axios from 'axios';
import type { CareIngredient, DraftCareItem } from '../../types';

const AI_URL = import.meta.env.VITE_AI_API_URL || 'https://api.anthropic.com/v1/messages';
const AI_KEY = import.meta.env.VITE_AI_API_KEY as string | undefined;
const AI_MODEL = import.meta.env.VITE_AI_MODEL || 'claude-sonnet-4-5';

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;
const ing = (name: string, amount: string, unit: CareIngredient['unit']): CareIngredient => ({
  id: uid('ing'), name, amount, unit,
});

export type SowMethod = 'direct-sow' | 'start-indoors' | 'either';

export interface SeedPlan {
  plantName: string;
  species?: string;
  method: SowMethod;
  sowDepthMm: number;
  spacingCm: number;
  /** null when the plant is direct-sown only. */
  startIndoorsWeeksBeforeLastFrost: number | null;
  germinationDays: [number, number];
  daysToHarvestOrBloom?: number;
  soilTempC?: [number, number];
  /** Ordered, plain-language steps. */
  steps: string[];
  /** Care items for the seed/seedling stage, editable in CareItemsEditor. */
  careItems: DraftCareItem[];
  source: 'ai' | 'fallback';
  notes?: string;
}

/* ---------- local fallback ---------- */

interface FallbackEntry {
  match: RegExp;
  method: SowMethod;
  sowDepthMm: number;
  spacingCm: number;
  indoorsWeeks: number | null;
  germination: [number, number];
  steps: string[];
}

const FALLBACKS: FallbackEntry[] = [
  {
    match: /tomato|lycopersicum/i, method: 'start-indoors', sowDepthMm: 6, spacingCm: 60,
    indoorsWeeks: 6, germination: [5, 10],
    steps: [
      'Fill trays with damp seed compost and firm it lightly.',
      'Sow two seeds per cell about 6mm deep and cover.',
      'Keep at 20–24°C in bright light; thin to the stronger seedling.',
      'Pot on when the first true leaves appear.',
      'Harden off for a week, then plant out once nights stay above 10°C.',
    ],
  },
  {
    match: /basil|ocimum/i, method: 'start-indoors', sowDepthMm: 3, spacingCm: 25,
    indoorsWeeks: 4, germination: [5, 10],
    steps: [
      'Sow thinly on damp compost and barely cover — basil needs warmth and light.',
      'Keep at 18–22°C and never let the compost dry out.',
      'Pinch the growing tip at four leaf pairs to make it bush.',
    ],
  },
  {
    match: /lettuce|lactuca|spinach|rocket|arugula|radish/i, method: 'direct-sow', sowDepthMm: 10, spacingCm: 20,
    indoorsWeeks: null, germination: [4, 10],
    steps: [
      'Rake the bed level and water it before sowing.',
      'Sow in a shallow drill about 1cm deep and cover lightly.',
      'Thin seedlings to a hand-width apart as soon as they can be handled.',
      'Sow a short row every two weeks for a continuous crop.',
    ],
  },
  {
    match: /sunflower|helianthus|bean|pea|pisum|phaseolus|courgette|zucchini|squash|cucumber/i,
    method: 'direct-sow', sowDepthMm: 25, spacingCm: 45, indoorsWeeks: null, germination: [7, 14],
    steps: [
      'Wait until the soil has warmed and frost has passed.',
      'Sow individually about 2.5cm deep, two seeds per station.',
      'Protect emerging shoots from slugs and birds.',
      'Remove the weaker seedling once both are up.',
    ],
  },
  {
    match: /lavender|lavandula|rosemary|thyme|perennial herb/i, method: 'start-indoors', sowDepthMm: 2,
    spacingCm: 40, indoorsWeeks: 10, germination: [14, 35],
    steps: [
      'Sow onto gritty, free-draining compost and barely cover.',
      'Germination is slow and uneven — be patient and keep it only just moist.',
      'Grow on in bright, airy conditions; overwatering is the usual killer.',
    ],
  },
];

const GENERIC_FALLBACK: FallbackEntry = {
  match: /.^/, method: 'either', sowDepthMm: 6, spacingCm: 30, indoorsWeeks: 6, germination: [7, 21],
  steps: [
    'Sow into damp seed compost at roughly twice the seed\'s own depth.',
    'Keep it warm, bright and evenly moist until it germinates.',
    'Thin or pot on once the first true leaves appear.',
    'Harden off before planting out if it was started indoors.',
  ],
};

function seedCareItems(depthMm: number, indoors: boolean): DraftCareItem[] {
  const items: DraftCareItem[] = [
    {
      id: uid('care'), title: 'Mist the seed tray', kind: 'water',
      frequency: { every: 1, unit: 'day' }, ingredients: [ing('Water', '1/4', 'cup')],
      instructions: 'Mist rather than pour — a watering can washes shallow seed out of place.',
      source: 'generated',
    },
    {
      id: uid('care'), title: 'Check for germination', kind: 'inspect',
      frequency: { every: 2, unit: 'day' }, ingredients: [],
      instructions: `Sown about ${depthMm}mm deep. Look for the first loops breaking the surface.`,
      source: 'generated',
    },
  ];

  if (indoors) {
    items.push({
      id: uid('care'), title: 'Turn the tray and check the light', kind: 'other',
      frequency: { every: 2, unit: 'day' }, ingredients: [],
      instructions: 'Seedlings lean towards the light — turning the tray keeps them straight.',
      source: 'generated',
    });
    items.push({
      id: uid('care'), title: 'Feed once true leaves appear', kind: 'feed',
      frequency: { every: 2, unit: 'week' },
      ingredients: [ing('Balanced liquid feed (quarter strength)', '1/4', 'tsp'), ing('Water', '1', 'l')],
      instructions: 'Seed compost holds almost no nutrients; start feeding weakly once true leaves show.',
      source: 'generated',
    });
  }

  return items;
}

function fallbackPlan(plantName: string): SeedPlan {
  const entry = FALLBACKS.find((f) => f.match.test(plantName)) ?? GENERIC_FALLBACK;
  return {
    plantName,
    method: entry.method,
    sowDepthMm: entry.sowDepthMm,
    spacingCm: entry.spacingCm,
    startIndoorsWeeksBeforeLastFrost: entry.indoorsWeeks,
    germinationDays: entry.germination,
    steps: entry.steps,
    careItems: seedCareItems(entry.sowDepthMm, entry.indoorsWeeks !== null),
    source: 'fallback',
    notes:
      entry === GENERIC_FALLBACK
        ? `No specific sowing data for "${plantName}" — these are general seed-raising defaults. Check the packet and adjust.`
        : undefined,
  };
}

/* ---------- AI ---------- */

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

function coerceRange(value: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(value) && value.length === 2) {
    const [a, b] = value.map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
  }
  return fallback;
}

function parsePlan(raw: string, plantName: string): SeedPlan | null {
  // Models sometimes wrap JSON in prose or a fence; take the outermost object.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || parsed.error || !Array.isArray(parsed.steps) || !parsed.steps.length) return null;

  const base = fallbackPlan(plantName);
  const depth = Number(parsed.sowDepthMm);
  const indoorsWeeks =
    parsed.startIndoorsWeeksBeforeLastFrost === null
      ? null
      : Number(parsed.startIndoorsWeeksBeforeLastFrost) || null;

  const method: SowMethod = ['direct-sow', 'start-indoors', 'either'].includes(parsed.method)
    ? parsed.method
    : base.method;

  return {
    plantName,
    species: typeof parsed.species === 'string' ? parsed.species : undefined,
    method,
    sowDepthMm: Number.isFinite(depth) && depth > 0 ? depth : base.sowDepthMm,
    spacingCm: Number(parsed.spacingCm) || base.spacingCm,
    startIndoorsWeeksBeforeLastFrost: method === 'direct-sow' ? null : indoorsWeeks,
    germinationDays: coerceRange(parsed.germinationDays, base.germinationDays),
    daysToHarvestOrBloom: Number(parsed.daysToHarvestOrBloom) || undefined,
    soilTempC: Array.isArray(parsed.soilTempC) ? coerceRange(parsed.soilTempC, [15, 25]) : undefined,
    steps: parsed.steps.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 6),
    careItems: seedCareItems(
      Number.isFinite(depth) && depth > 0 ? depth : base.sowDepthMm,
      method !== 'direct-sow',
    ),
    source: 'ai',
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
  };
}

export const seedPlanService = {
  isConfigured(): boolean {
    return Boolean(AI_KEY);
  },

  /** Never throws — an unusable answer degrades to the local table. */
  async getSeedPlan(plantName: string, signal?: AbortSignal): Promise<SeedPlan> {
    const name = plantName.trim();
    if (!name) return fallbackPlan('plant');
    if (!AI_KEY) return fallbackPlan(name);

    try {
      const { data } = await axios.post(
        AI_URL,
        {
          model: AI_MODEL,
          max_tokens: 700,
          system: SCHEMA_PROMPT,
          messages: [{ role: 'user', content: `Plant name: ${name}` }],
        },
        {
          signal,
          timeout: 25_000,
          headers: {
            'content-type': 'application/json',
            'x-api-key': AI_KEY,
            'anthropic-version': '2023-06-01',
          },
        },
      );

      const text: string =
        data?.content?.map?.((part: any) => part?.text ?? '').join('') ??
        data?.choices?.[0]?.message?.content ??
        '';

      return parsePlan(text, name) ?? fallbackPlan(name);
    } catch (error) {
      if (axios.isCancel?.(error)) throw error;
      console.error('Seed plan lookup failed', error);
      return fallbackPlan(name);
    }
  },

  /** Calendar dates from a last-frost date, for the sowing checklist. */
  schedule(plan: SeedPlan, lastFrostDate: Date) {
    const sow = new Date(lastFrostDate);
    if (plan.startIndoorsWeeksBeforeLastFrost) {
      sow.setDate(sow.getDate() - plan.startIndoorsWeeksBeforeLastFrost * 7);
    }
    const germinateBy = new Date(sow);
    germinateBy.setDate(germinateBy.getDate() + plan.germinationDays[1]);

    const plantOut = new Date(lastFrostDate);
    plantOut.setDate(plantOut.getDate() + 7);

    return {
      sowOn: sow.toISOString().slice(0, 10),
      germinateBy: germinateBy.toISOString().slice(0, 10),
      plantOutAfter: plan.startIndoorsWeeksBeforeLastFrost
        ? plantOut.toISOString().slice(0, 10)
        : null,
    };
  },
};
