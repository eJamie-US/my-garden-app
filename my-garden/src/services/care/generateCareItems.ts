// src/services/care/generateCareItems.ts
// Rule-based care suggestions from species + local weather. No AI call: the rules
// are legible, testable, and work offline. Every item is editable afterwards.
//
// Every generated item starts due today, not a full frequency-cycle from now —
// a newly added plant needs its first watering/feeding/inspection right away,
// not a week (or three) from now. Completing an item is what rolls its next
// occurrence out by its own frequency (see careItemsService.complete).

import type {
  CareFrequency,
  CareIngredient,
  DailyWeather,
  DraftCareItem,
  Plant,
  WeatherData,
} from '../../types';
import { today } from '../../utils/careDisplay';

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`;

const ing = (name: string, amount: string, unit: CareIngredient['unit']): CareIngredient => ({
  id: uid('ing'),
  name,
  amount,
  unit,
});

const every = (n: number, unit: CareFrequency['unit']): CareFrequency => ({ every: n, unit });

/* ---------- species profiles ---------- */

interface Profile {
  match: RegExp;
  label: string;
  /** Baseline days between waterings in mild weather. */
  waterDays: number;
  feed?: { title: string; frequency: CareFrequency; ingredients: CareIngredient[]; instructions?: string };
  extras?: Array<Omit<DraftCareItem, 'id' | 'source'>>;
  frostTender?: boolean;
}

const PROFILES: Profile[] = [
  {
    match: /tomato|solanum lycopersicum|pepper|capsicum|aubergine|eggplant/i,
    label: 'Fruiting nightshade',
    waterDays: 2,
    frostTender: true,
    feed: {
      title: 'Feed for fruiting',
      frequency: every(2, 'week'),
      ingredients: [
        ing('Tomato fertiliser (5-10-10)', '1', 'tbsp'),
        ing('Epsom salt', '1/2', 'tsp'),
        ing('Water', '1', 'gal'),
      ],
      instructions: 'Dissolve fully and water at the base — keep it off the leaves.',
    },
    extras: [
      {
        title: 'Pinch out side shoots',
        kind: 'prune',
        frequency: every(1, 'week'),
        ingredients: [],
        instructions: 'Remove shoots in the leaf joints so energy goes to the fruit.',
      },
    ],
  },
  {
    // Checked before the "Rose" profile below: several drought-tolerant
    // plants have "rose" in their common name (desert rose, rock rose, sun
    // rose) without being a true Rosa — matching here first keeps e.g. a
    // desert rose (Adenium obesum) from getting a rose bush's weekly
    // deadheading and thirstier watering schedule.
    match: /lavandula|lavender|rosmarinus|salvia rosmarinus|rosemary|thymus|thyme|sedum|agave|echeveria|cact|succulent|adenium|desert rose/i,
    label: 'Drought-tolerant / Mediterranean',
    waterDays: 10,
    feed: {
      title: 'Occasional feed',
      frequency: every(3, 'month'),
      ingredients: [ing('Low-nitrogen granular feed', '1', 'tbsp')],
      instructions: 'Scatter around the base. These plants resent rich soil.',
    },
  },
  {
    match: /rosa|rose\b/i,
    label: 'Rose',
    waterDays: 3,
    feed: {
      title: 'Feed roses',
      frequency: every(3, 'week'),
      ingredients: [
        ing('Rose fertiliser (10-10-10)', '2', 'tbsp'),
        ing('Epsom salt', '1', 'tbsp'),
        ing('Water', '1', 'gal'),
      ],
    },
    extras: [
      {
        title: 'Deadhead spent blooms',
        kind: 'prune',
        frequency: every(1, 'week'),
        ingredients: [],
        instructions: 'Cut back to the first outward-facing five-leaflet leaf.',
      },
    ],
  },
  {
    match: /basil|ocimum|mint|mentha|coriander|cilantro|parsley|petroselinum/i,
    label: 'Soft herb',
    waterDays: 2,
    frostTender: true,
    feed: {
      title: 'Light feed',
      frequency: every(3, 'week'),
      ingredients: [ing('Balanced liquid feed (half strength)', '1/2', 'tsp'), ing('Water', '1', 'l')],
    },
    extras: [
      {
        title: 'Pinch tips to keep it bushy',
        kind: 'prune',
        frequency: every(10, 'day'),
        ingredients: [],
        instructions: 'Take the top two leaves off each stem before it flowers.',
      },
    ],
  },
  {
    match: /hydrangea|rhododendron|azalea|camellia|blueberry|vaccinium|acer palmatum/i,
    label: 'Acid-loving shrub',
    waterDays: 3,
    feed: {
      title: 'Feed with ericaceous food',
      frequency: every(1, 'month'),
      ingredients: [ing('Ericaceous liquid feed', '1', 'tbsp'), ing('Water', '1', 'gal')],
    },
    extras: [
      {
        title: 'Top up mulch',
        kind: 'mulch',
        frequency: every(6, 'month'),
        ingredients: [ing('Pine bark or leaf mould', '2', 'handful')],
        instructions: 'Keep mulch off the stem itself.',
      },
    ],
  },
  {
    match: /lactuca|lettuce|spinacia|spinach|brassica|kale|cabbage|rucola|arugula|radish|raphanus/i,
    label: 'Leafy annual',
    waterDays: 1,
    feed: {
      title: 'Feed for leaf growth',
      frequency: every(2, 'week'),
      ingredients: [ing('High-nitrogen feed', '1', 'tsp'), ing('Water', '1', 'gal')],
    },
  },
  {
    match: /fern|hosta|impatiens|begonia|caladium/i,
    label: 'Shade lover',
    waterDays: 2,
    feed: {
      title: 'Gentle feed',
      frequency: every(1, 'month'),
      ingredients: [ing('Balanced liquid feed', '1', 'tsp'), ing('Water', '1', 'gal')],
    },
  },
];

const GENERIC: Profile = {
  match: /.^/,
  label: 'General garden plant',
  waterDays: 4,
  feed: {
    title: 'Feed during the growing season',
    frequency: every(1, 'month'),
    ingredients: [ing('Balanced fertiliser (10-10-10)', '1', 'tbsp'), ing('Water', '1', 'gal')],
  },
};

function profileFor(plant: Pick<Plant, 'species' | 'commonName' | 'name'>): Profile {
  const haystack = [plant.species, plant.commonName, plant.name].filter(Boolean).join(' ');
  return PROFILES.find((p) => p.match.test(haystack)) ?? GENERIC;
}

/* ---------- weather reading ---------- */

interface WeatherRead {
  recentRainMm: number;
  hotDaysAhead: number;
  frostAhead?: DailyWeather;
  rainAheadMm: number;
  dry: boolean;
  available: boolean;
}

function readWeather(weather?: WeatherData | null): WeatherRead {
  if (!weather) {
    return { recentRainMm: 0, hotDaysAhead: 0, rainAheadMm: 0, dry: false, available: false };
  }
  const past7 = weather.past.slice(-7);
  const recentRainMm = past7.reduce((sum, d) => sum + (d.precipitation || 0), 0);
  const ahead = weather.upcoming.slice(0, 7);
  return {
    recentRainMm,
    hotDaysAhead: ahead.filter((d) => d.tempMax >= 29).length,
    frostAhead: ahead.find((d) => d.tempMin <= 2),
    rainAheadMm: ahead.reduce((sum, d) => sum + (d.precipitation || 0), 0),
    dry: recentRainMm < 5,
    available: true,
  };
}

/**
 * Nudges the baseline watering interval by what the sky has been doing.
 * `covered` (sheltered from rain — an eave, a patio roof, grown under
 * glass) skips every rain-derived branch: a covered plant never actually
 * gets whatever fell or is forecast, so crediting it with that rain would
 * under-water it. Heat still dries covered soil out just the same, so
 * hotDaysAhead still applies.
 */
function adjustWaterDays(
  baseDays: number,
  read: WeatherRead,
  sun?: Plant['sunRequirement'],
  covered?: boolean,
) {
  let days = baseDays;
  const why: string[] = [];

  if (read.available) {
    if (covered) {
      if (read.recentRainMm >= 10 || read.rainAheadMm >= 20) {
        why.push("covered, so rain doesn't reach it — watering on its usual schedule regardless");
      }
    } else if (read.recentRainMm >= 25) {
      days = Math.round(days * 1.75);
      why.push(`${Math.round(read.recentRainMm)}mm of rain in the last week`);
    } else if (read.recentRainMm >= 10) {
      days = Math.round(days * 1.3);
      why.push('a damp week behind us');
    } else if (read.dry) {
      days = Math.max(1, Math.round(days * 0.75));
      why.push('a dry week behind us');
    }

    if (read.hotDaysAhead >= 3) {
      days = Math.max(1, Math.round(days * 0.7));
      why.push(`${read.hotDaysAhead} hot days coming`);
    }
    if (!covered && read.rainAheadMm >= 20) {
      days = Math.round(days * 1.25);
      why.push('rain in the forecast');
    }
  }

  if (sun === 'full-sun') days = Math.max(1, days - 1);
  if (sun === 'full-shade') days = days + 1;

  return { days: Math.min(days, 30), why };
}

function toFrequency(days: number): CareFrequency {
  if (days <= 1) return every(1, 'day');
  if (days % 7 === 0 && days >= 7) return every(days / 7, 'week');
  if (days >= 28) return every(Math.round(days / 30) || 1, 'month');
  return every(days, 'day');
}

export interface GenerateResult {
  items: DraftCareItem[];
  /** Plain-English summary of what the weather changed, for the UI. */
  rationale: string[];
  weatherUsed: boolean;
  profileLabel: string;
}

export function generateCareItems(
  plant: Pick<Plant, 'species' | 'commonName' | 'name' | 'sunRequirement' | 'rainCovered'>,
  weather?: WeatherData | null,
): GenerateResult {
  const profile = profileFor(plant);
  const read = readWeather(weather);
  const rationale: string[] = [];
  const items: DraftCareItem[] = [];
  // Every item below starts due today — see the file header note.
  const dueNow = today();

  const { days, why } = adjustWaterDays(profile.waterDays, read, plant.sunRequirement, plant.rainCovered);
  const waterFreq = toFrequency(days);

  items.push({
    id: uid('care'),
    title: 'Water',
    kind: 'water',
    frequency: waterFreq,
    nextDueDate: dueNow,
    ingredients: [ing('Water', days <= 2 ? '2' : '4', 'l')],
    instructions:
      plant.sunRequirement === 'full-sun'
        ? 'Water in the early morning or evening so it soaks in rather than evaporating.'
        : 'Water at the base until the top few centimetres are damp.',
    source: 'generated',
  });

  if (why.length) {
    rationale.push(
      `Watering set to every ${waterFreq.every} ${waterFreq.unit}${waterFreq.every > 1 ? 's' : ''} — ${why.join(', ')}.`,
    );
  } else if (!read.available) {
    rationale.push(
      `No local weather available, so watering uses the baseline for ${profile.label.toLowerCase()}s. Adjust it if your week has been wet or dry.`,
    );
  }

  if (profile.feed) {
    items.push({ id: uid('care'), kind: 'feed', source: 'generated', nextDueDate: dueNow, ...profile.feed });
  }

  for (const extra of profile.extras ?? []) {
    items.push({ id: uid('care'), source: 'generated', nextDueDate: dueNow, ...extra });
  }

  if (read.frostAhead && profile.frostTender) {
    items.push({
      id: uid('care'),
      title: 'Cover before frost',
      kind: 'protect',
      frequency: every(1, 'day'),
      nextDueDate: dueNow,
      ingredients: [ing('Horticultural fleece', '1', 'part')],
      instructions: `Low of ${Math.round(read.frostAhead.tempMin)}° forecast for ${read.frostAhead.date}. Cover overnight, uncover in the morning.`,
      source: 'generated',
    });
    rationale.push('Added a frost-protection item — a cold night is in the forecast.');
  }

  if (read.available && read.hotDaysAhead >= 4) {
    items.push({
      id: uid('care'),
      title: 'Mulch to hold moisture',
      kind: 'mulch',
      frequency: every(3, 'month'),
      nextDueDate: dueNow,
      ingredients: [ing('Compost or bark mulch', '2', 'handful')],
      instructions: 'Spread a few centimetres around the base, clear of the stem.',
      source: 'generated',
    });
    rationale.push('Added mulching — a hot stretch is coming.');
  }

  items.push({
    id: uid('care'),
    title: 'Check leaves for pests',
    kind: 'inspect',
    frequency: every(2, 'week'),
    nextDueDate: dueNow,
    ingredients: [],
    instructions: 'Look under the leaves and at new growth for aphids and holes.',
    source: 'generated',
  });

  return { items, rationale, weatherUsed: read.available, profileLabel: profile.label };
}

/** e.g. "every 2 weeks", "daily" */
export function describeFrequency(f: CareFrequency): string {
  if (f.every === 1) {
    return { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[f.unit];
  }
  if (f.every === 2 && f.unit === 'week') return 'every 2 weeks';
  return `every ${f.every} ${f.unit}s`;
}

export function nextDueFrom(f: CareFrequency, from: Date = new Date()): string {
  const d = new Date(from);
  if (f.unit === 'day') d.setDate(d.getDate() + f.every);
  if (f.unit === 'week') d.setDate(d.getDate() + f.every * 7);
  if (f.unit === 'month') d.setMonth(d.getMonth() + f.every);
  if (f.unit === 'year') d.setFullYear(d.getFullYear() + f.every);
  return d.toISOString().slice(0, 10);
}
