// src/utils/bestPlacement.ts
// When adding a plant, is there a spot in this yard that suits it better
// than the one just picked? A coarse grid search over the whole yard
// photo, scoring sun, rain, and wind together — each classified the same
// three-bucket way and matched against the plant's own preference the same
// way, so no one factor dominates by construction. (Before rain/wind
// preferences existed, sun alone drove almost the entire score, which meant
// any two plants sharing a sunRequirement always got the exact same
// suggested spots — see migration 032.)
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
// Wind reuses the same per-point shelter check as a proxy for "is this spot
// sheltered from wind generally," scaling down that season's average wind
// speed when it says yes — a simplification (a plain fence isn't a
// windbreak in this model, only the roofed obstacle types rain-shelter
// already recognizes are), but avoids inventing a whole separate wind-
// geometry model for what's otherwise a coarse, photo-space estimate to
// begin with.
//
// On top of all three, a small nudge from *current* conditions (the
// trailing 14 days already in WeatherData.past) — a recent dry spell
// slightly favors a spot that actually catches rain right now, and a recent
// soaking slightly favors one that's sheltered. This is deliberately a
// tiebreaker, not a rewrite of the year-round picture above: a plant's
// permanent spot shouldn't flip every time the weather does.

import { estimateSeasonalExposure, type Season } from './sunExposure';
import { computeRainShelter } from './rainShelter';
import type { SeasonalClimate } from '../services/weather/climateWind';
import type { Plant, Point, WeatherData, Yard, YardObstacle } from '../types';

export type SunClassification = 'full-sun' | 'partial-shade' | 'full-shade';
export type RainClassification = 'dry' | 'mixed' | 'wet';
export type WindClassification = 'calm' | 'breezy' | 'windy';

const SEASONS: Season[] = ['spring', 'summer', 'fall', 'winter'];

/** Per-season climate data, keyed the same way estimateSeasonalExposure's
 *  bySeason is — see services/weather/climateWind.ts. Passing undefined (no
 *  data fetched at all) is equivalent to every season having no data. */
export type SeasonalClimateBySeason = Partial<Record<Season, SeasonalClimate>>;

function classifySun(bySeason: { sunny: boolean }[]): SunClassification {
  const sunnySeasons = bySeason.filter((s) => s.sunny).length;
  return sunnySeasons === bySeason.length ? 'full-sun' : sunnySeasons === 0 ? 'full-shade' : 'partial-shade';
}

function classifyRain(rainySeasons: number): RainClassification {
  if (rainySeasons <= 1) return 'dry';
  if (rainySeasons >= 3) return 'wet';
  return 'mixed';
}

const CALM_THRESHOLD_KMH = 10;
const WINDY_THRESHOLD_KMH = 20;
/** How much a point's effective wind speed is discounted when it's
 *  sheltered (by the same roofed-obstacle geometry computeRainShelter
 *  already uses) — not zeroed out, since shelter from a building's lee side
 *  cuts wind a lot but rarely to nothing. */
const WIND_SHELTER_FACTOR = 0.4;

function classifyWind(avgSpeedKmh: number | null): WindClassification {
  if (avgSpeedKmh == null) return 'breezy'; // no data — neutral middle bucket, same spirit as an unmatched sun tolerance
  if (avgSpeedKmh < CALM_THRESHOLD_KMH) return 'calm';
  if (avgSpeedKmh > WINDY_THRESHOLD_KMH) return 'windy';
  return 'breezy';
}

/** How well a classification matches what the plant wants: 2 = ideal, 1 =
 *  tolerable, 0 = poor. */
const SUN_MATCH: Record<NonNullable<Plant['sunRequirement']>, Record<SunClassification, number>> = {
  'full-sun': { 'full-sun': 2, 'partial-shade': 1, 'full-shade': 0 },
  'full-shade': { 'full-shade': 2, 'partial-shade': 1, 'full-sun': 0 },
  'partial-shade': { 'partial-shade': 2, 'full-sun': 1, 'full-shade': 1 },
};

const RAIN_MATCH: Record<NonNullable<Plant['rainPreference']>, Record<RainClassification, number>> = {
  'prefers-dry': { dry: 2, mixed: 1, wet: 0 },
  neutral: { mixed: 2, dry: 1, wet: 1 },
  'prefers-wet': { wet: 2, mixed: 1, dry: 0 },
};

const WIND_MATCH: Record<NonNullable<Plant['windTolerance']>, Record<WindClassification, number>> = {
  fragile: { calm: 2, breezy: 1, windy: 0 },
  hardy: { calm: 1, breezy: 1, windy: 1 }, // wind genuinely doesn't matter to this plant — flat, never penalized
};

const MATCH_WEIGHT = 10;

export interface PlacementSpot extends Point {
  classification: SunClassification;
  /** How many of the 4 seasons this spot actually gets rained on, given
   *  each season's real prevailing rain-wind direction where known. 4 =
   *  rained on year-round; 0 = stays dry year-round (fully sheltered). */
  rainySeasons: number;
  rainClassification: RainClassification;
  windClassification: WindClassification;
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

/** Effective average wind speed at this point, across the seasons with
 *  data — the season's climatology, discounted when the point is sheltered
 *  (same geometry computeRainShelter uses, generalized as a wind-shelter
 *  proxy — see the file header). Null when no season has climate data. */
function windSpeedAt(
  point: Point,
  obstacles: YardObstacle[],
  orientationDeg: number,
  seasonalClimate: SeasonalClimateBySeason | null | undefined,
): number | null {
  const speeds: number[] = [];
  for (const season of SEASONS) {
    const climate = seasonalClimate?.[season];
    if (climate?.avgWindSpeedKmh == null) continue;
    const sheltered = computeRainShelter(
      { location: point },
      obstacles,
      orientationDeg,
      climate.rainWindDirection ?? undefined,
    ).sheltered;
    speeds.push(sheltered ? climate.avgWindSpeedKmh * WIND_SHELTER_FACTOR : climate.avgWindSpeedKmh);
  }
  if (!speeds.length) return null;
  return speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
}

function scoreAt(
  point: Point,
  plant: Pick<Plant, 'sunRequirement' | 'rainPreference' | 'windTolerance'>,
  obstacles: YardObstacle[],
  yard: Pick<Yard, 'latitude' | 'longitude' | 'orientationDeg'>,
  seasonalClimate: SeasonalClimateBySeason | null | undefined,
  weather: Pick<WeatherData, 'past' | 'windDirection'> | null | undefined,
): PlacementSpot {
  const sunRequirement = plant.sunRequirement!;
  const rainPreference = plant.rainPreference ?? 'neutral';
  const windTolerance = plant.windTolerance ?? 'hardy';

  const bySeason = estimateSeasonalExposure(point, obstacles, yard.latitude!, yard.longitude!, yard.orientationDeg);
  const classification = classifySun(bySeason);

  const rainySeasons = bySeason.filter(({ season }) => {
    const windFromDeg = seasonalClimate?.[season]?.rainWindDirection ?? undefined;
    return !computeRainShelter({ location: point }, obstacles, yard.orientationDeg, windFromDeg).sheltered;
  }).length;
  const rainClassification = classifyRain(rainySeasons);

  const windClassification = classifyWind(windSpeedAt(point, obstacles, yard.orientationDeg, seasonalClimate));

  const score =
    SUN_MATCH[sunRequirement][classification] * MATCH_WEIGHT +
    RAIN_MATCH[rainPreference][rainClassification] * MATCH_WEIGHT +
    WIND_MATCH[windTolerance][windClassification] * MATCH_WEIGHT +
    recentWeatherBias(point, obstacles, yard.orientationDeg, weather);

  return { ...point, classification, rainySeasons, rainClassification, windClassification, score };
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
  plant: Pick<Plant, 'sunRequirement' | 'rainPreference' | 'windTolerance'>,
  obstacles: YardObstacle[],
  yard: Pick<Yard, 'latitude' | 'longitude' | 'orientationDeg'>,
  seasonalClimate?: SeasonalClimateBySeason | null,
  weather?: Pick<WeatherData, 'past' | 'windDirection'> | null,
): PlacementEvaluation | null {
  if (!plant.sunRequirement || yard.latitude == null || yard.longitude == null) return null;

  const current = scoreAt(location, plant, obstacles, yard, seasonalClimate, weather);

  const candidates: PlacementSpot[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = ((col + 0.5) / GRID_COLS) * 100;
      const y = ((row + 0.5) / GRID_ROWS) * 100;
      candidates.push(scoreAt({ x, y }, plant, obstacles, yard, seasonalClimate, weather));
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
