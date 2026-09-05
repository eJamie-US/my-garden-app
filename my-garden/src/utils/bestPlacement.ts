// src/utils/bestPlacement.ts
// When adding a plant, is there a spot in this yard that suits its sun needs
// better than the one just picked? A coarse grid search over the whole yard
// photo, classified the same way computeSunMap classifies cells.
//
// Rain is checked per season against that season's real prevailing
// wind-on-rainy-days direction (from services/weather/climateWind.ts —
// Open-Meteo's historical archive, not a forecast or a guess), reusing
// computeRainShelter's existing wind-cone logic once per season. A season
// with no climatology available (fetch failed, or too few rainy days in the
// sample) falls back to computeRainShelter's own no-wind-data behavior:
// "any roof shelters," which is the same honest fallback used everywhere
// else in the app when there's nothing to reason about wind with.
//
// On top of that, a small nudge from *current* conditions (the trailing 14
// days already in WeatherData.past) — a recent dry spell slightly favors a
// spot that actually catches rain right now, and a recent soaking slightly
// favors one that's sheltered. This is deliberately a tiebreaker, not a
// rewrite of the year-round picture above: a plant's permanent spot
// shouldn't flip every time the weather does.

import { estimateSeasonalExposure, type Season } from './sunExposure';
import { computeRainShelter } from './rainShelter';
import type { Plant, Point, WeatherData, Yard, YardObstacle } from '../types';

export type SunClassification = 'full-sun' | 'partial-shade' | 'full-shade';

/** Real prevailing wind-on-rainy-days direction per season, or null where
 *  there's no climatology to reason from — see climateWind.ts. Passing
 *  undefined (no data fetched at all) is equivalent to every season null. */
export type SeasonalRainWind = Partial<Record<Season, number | null>>;

function classify(bySeason: { sunny: boolean }[]): SunClassification {
  const sunnySeasons = bySeason.filter((s) => s.sunny).length;
  return sunnySeasons === bySeason.length ? 'full-sun' : sunnySeasons === 0 ? 'full-shade' : 'partial-shade';
}

/** How well a classification matches what the plant wants: 2 = ideal, 1 =
 *  tolerable, 0 = poor. A partial-shade plant is treated as fine at either
 *  sunny or shady extremes, matching the existing exposure-summary framing. */
const SUN_MATCH: Record<NonNullable<Plant['sunRequirement']>, Record<SunClassification, number>> = {
  'full-sun': { 'full-sun': 2, 'partial-shade': 1, 'full-shade': 0 },
  'full-shade': { 'full-shade': 2, 'partial-shade': 1, 'full-sun': 0 },
  'partial-shade': { 'partial-shade': 2, 'full-sun': 1, 'full-shade': 1 },
};

export interface PlacementSpot extends Point {
  classification: SunClassification;
  /** How many of the 4 seasons this spot actually gets rained on, given
   *  each season's real prevailing rain-wind direction where known. 4 =
   *  rained on year-round; 0 = stays dry year-round (fully sheltered). */
  rainySeasons: number;
  score: number;
}

const RECENT_DRY_DAYS = 4;
const RECENT_DRY_THRESHOLD_MM = 2; // essentially no rain over that stretch
const RECENT_WET_DAYS = 3;
const RECENT_WET_THRESHOLD_MM = 10; // a real, recent soaking
const RECENT_WEATHER_BIAS = 1;

function trailingRainfall(past: WeatherData['past'], days: number): number {
  return past.slice(-days).reduce((sum, day) => sum + (day.precipitation || 0), 0);
}

/** Small nudge from right-now conditions — uses the live wind direction,
 *  same as the rest of the app's "sheltered right now" checks, not the
 *  seasonal climatology above. Zero unless there's a real recent dry spell
 *  or soaking to react to. */
function recentWeatherBias(
  point: Point,
  obstacles: YardObstacle[],
  orientationDeg: number,
  weather: Pick<WeatherData, 'past' | 'windDirection'> | null | undefined,
): number {
  if (!weather?.past.length) return 0;
  const shelteredNow = computeRainShelter(
    { location: point },
    obstacles,
    orientationDeg,
    weather.windDirection,
  ).sheltered;
  const dryStreak = trailingRainfall(weather.past, RECENT_DRY_DAYS) < RECENT_DRY_THRESHOLD_MM;
  const wetStreak = trailingRainfall(weather.past, RECENT_WET_DAYS) >= RECENT_WET_THRESHOLD_MM;
  if (dryStreak && !shelteredNow) return RECENT_WEATHER_BIAS; // catching whatever rain comes matters more right now
  if (wetStreak && shelteredNow) return RECENT_WEATHER_BIAS; // already soaked — no benefit to more exposure right now
  return 0;
}

function scoreAt(
  point: Point,
  sunRequirement: NonNullable<Plant['sunRequirement']>,
  obstacles: YardObstacle[],
  yard: Pick<Yard, 'latitude' | 'longitude' | 'orientationDeg'>,
  seasonalRainWind: SeasonalRainWind | null | undefined,
  weather: Pick<WeatherData, 'past' | 'windDirection'> | null | undefined,
): PlacementSpot {
  const bySeason = estimateSeasonalExposure(point, obstacles, yard.latitude!, yard.longitude!, yard.orientationDeg);
  const classification = classify(bySeason);

  const rainySeasons = bySeason.filter(({ season }) => {
    const windFromDeg = seasonalRainWind?.[season] ?? undefined;
    return !computeRainShelter({ location: point }, obstacles, yard.orientationDeg, windFromDeg).sheltered;
  }).length;

  const score =
    SUN_MATCH[sunRequirement][classification] * 10 +
    rainySeasons +
    recentWeatherBias(point, obstacles, yard.orientationDeg, weather);
  return { ...point, classification, rainySeasons, score };
}

const GRID_COLS = 16;
const GRID_ROWS = 12;
/** Minimum distance apart (percent of photo) for two suggested spots to
 *  count as meaningfully different rather than the same patch of yard. */
const MIN_SPOT_SEPARATION = 15;
const MAX_SUGGESTIONS = 3;

export interface PlacementEvaluation {
  current: PlacementSpot;
  /** Better-scoring spots than `current`, most-different-from-each-other
   *  first, best score first. Empty means the current spot is already at
   *  least as good as anywhere else in the yard. */
  alternatives: PlacementSpot[];
  hasBetter: boolean;
}

/**
 * Compares the chosen spot against a coarse grid over the whole yard.
 * Returns null when there isn't enough data to judge (no yard location on
 * file, or the plant has no sun requirement set) — the caller should just
 * skip the popup rather than guessing.
 */
export function evaluatePlacement(
  location: Point,
  sunRequirement: Plant['sunRequirement'],
  obstacles: YardObstacle[],
  yard: Pick<Yard, 'latitude' | 'longitude' | 'orientationDeg'>,
  seasonalRainWind?: SeasonalRainWind | null,
  weather?: Pick<WeatherData, 'past' | 'windDirection'> | null,
): PlacementEvaluation | null {
  if (!sunRequirement || yard.latitude == null || yard.longitude == null) return null;

  const current = scoreAt(location, sunRequirement, obstacles, yard, seasonalRainWind, weather);

  const candidates: PlacementSpot[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = ((col + 0.5) / GRID_COLS) * 100;
      const y = ((row + 0.5) / GRID_ROWS) * 100;
      candidates.push(scoreAt({ x, y }, sunRequirement, obstacles, yard, seasonalRainWind, weather));
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const alternatives: PlacementSpot[] = [];
  for (const candidate of candidates) {
    if (candidate.score <= current.score) break;
    const tooClose = alternatives.some(
      (chosen) => Math.hypot(chosen.x - candidate.x, chosen.y - candidate.y) < MIN_SPOT_SEPARATION,
    );
    if (tooClose) continue;
    alternatives.push(candidate);
    if (alternatives.length >= MAX_SUGGESTIONS) break;
  }

  return { current, alternatives, hasBetter: alternatives.length > 0 };
}
