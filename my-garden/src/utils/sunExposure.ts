// src/utils/sunExposure.ts
// Combines the sun's real position (sunPosition.ts — exact) with
// user-marked yard obstacles (buildings, covered porches, trees, fences —
// approximate: position is known, but height and the yard photo's scale
// aren't, so this reasons in relative/qualitative terms) to estimate
// whether a spot is sunny or shaded, season by season. It's a heuristic,
// not a physical shadow simulation — see the thresholds below for exactly
// what it assumes, so the estimate can be judged (and corrected by moving
// or adding obstacles) rather than taken as ground truth.

import { solarPosition, isDaytime } from './sunPosition';
import type { ObstacleHeightTier, Plant, YardObstacle } from '../types';

export type Season = 'spring' | 'summer' | 'fall' | 'winter';

type Point = { x: number; y: number };

const SEASON_DATES: { season: Season; monthDay: string }[] = [
  { season: 'spring', monthDay: '03-20' },
  { season: 'summer', monthDay: '06-21' },
  { season: 'fall', monthDay: '09-22' },
  { season: 'winter', monthDay: '12-21' },
];

/** How wide a cone, either side of the sun's exact bearing, counts as
 *  "roughly in that direction" for an obstacle to plausibly block it. */
const CONE_HALF_WIDTH_DEG = 30;

/**
 * Blocking distance thresholds, in the same 0-100 percent-of-photo units
 * as Plant.location — there's no real-world scale to work in (no ruler in
 * the yard photo). `near` applies when the sun is high (midday, obstacles
 * only block if quite close); `far` applies when the sun is low (near
 * sunrise/sunset, when even a distant obstacle's long shadow can reach).
 */
const TIER_RANGE: Record<ObstacleHeightTier, { near: number; far: number }> = {
  low: { near: 6, far: 10 },
  medium: { near: 15, far: 25 },
  tall: { near: 30, far: 45 },
};

function bearingTo(from: Point, to: Point, orientationDeg: number): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const photoBearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((photoBearing + orientationDeg) % 360 + 360) % 360;
}

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Signed difference `to - from`, in (-180, 180] — which side of `from`
 *  `to` falls on, not just how far. */
function signedAngularOffset(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function blockingDistance(tier: ObstacleHeightTier, elevationDeg: number): number {
  const { near, far } = TIER_RANGE[tier];
  if (elevationDeg >= 40) return near;
  if (elevationDeg <= 15) return far;
  const t = (40 - elevationDeg) / (40 - 15);
  return near + t * (far - near);
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function pointInPolygon(p: Point, verts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const { x: xi, y: yi } = verts[i];
    const { x: xj, y: yj } = verts[j];
    const crosses = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a filled polygon's boundary — 0 if the point falls inside it. */
function polygonDistance(p: Point, verts: Point[]): number {
  if (pointInPolygon(p, verts)) return 0;
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) {
    min = Math.min(min, pointToSegmentDistance(p, verts[i], verts[(i + 1) % verts.length]));
  }
  return min;
}

function rectCorners(a: Point, b: Point): Point[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}

/** Whether the sun's bearing falls within the angular slice a set of
 *  vertices (seen from `plant`) spans — the shape's actual angular width,
 *  in place of a fixed guess. Assumes the shape doesn't wrap more than
 *  180° from the viewer, true for any convex shape seen from outside it. */
function angularSpanBlocks(plant: Point, vertices: Point[], orientationDeg: number, sunAzimuthDeg: number): boolean {
  const refBearing = bearingTo(plant, vertices[0], orientationDeg);
  let min = 0;
  let max = 0;
  for (const v of vertices) {
    const offset = signedAngularOffset(refBearing, bearingTo(plant, v, orientationDeg));
    if (offset < min) min = offset;
    if (offset > max) max = offset;
  }
  const sunOffset = signedAngularOffset(refBearing, sunAzimuthDeg);
  return sunOffset >= min && sunOffset <= max;
}

/** Whether this one obstacle plausibly blocks the sun from `plant` right now. */
function shapeBlocks(
  plant: Point,
  obstacle: YardObstacle,
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  orientationDeg: number,
): boolean {
  const maxDist = blockingDistance(obstacle.heightTier, sunElevationDeg);
  const shape = obstacle.shape;

  if (!shape) {
    // No measured size — the original fixed guess at how wide a slice of
    // sky a "there's something roughly here" marker covers.
    const bearing = bearingTo(plant, obstacle.location, orientationDeg);
    if (angularDiff(bearing, sunAzimuthDeg) > CONE_HALF_WIDTH_DEG) return false;
    const dist = Math.hypot(plant.x - obstacle.location.x, plant.y - obstacle.location.y);
    return dist <= maxDist;
  }

  if (shape.kind === 'circle') {
    const center = obstacle.location;
    const dist = Math.hypot(plant.x - center.x, plant.y - center.y);
    if (dist <= shape.radius) return true; // plant sits under the canopy/footprint itself
    if (dist - shape.radius > maxDist) return false;
    const bearing = bearingTo(plant, center, orientationDeg);
    const halfWidthDeg = (Math.asin(Math.min(1, shape.radius / dist)) * 180) / Math.PI;
    return angularDiff(bearing, sunAzimuthDeg) <= halfWidthDeg;
  }

  const vertices: Point[] =
    shape.kind === 'line'
      ? [obstacle.location, shape.to]
      : shape.kind === 'rect'
        ? rectCorners(obstacle.location, shape.to)
        : [obstacle.location, shape.b, shape.c];

  const edgeDist =
    shape.kind === 'line'
      ? pointToSegmentDistance(plant, obstacle.location, shape.to)
      : polygonDistance(plant, vertices);
  if (edgeDist > maxDist) return false;
  if (edgeDist === 0) return true; // plant falls inside the footprint
  return angularSpanBlocks(plant, vertices, orientationDeg, sunAzimuthDeg);
}

/** The first obstacle (if any) that plausibly blocks the sun from this spot at this moment. */
export function findBlocker(
  plantLocation: Point,
  obstacles: YardObstacle[],
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  orientationDeg: number,
): YardObstacle | null {
  for (const obstacle of obstacles) {
    // A fence-height obstacle only matters when the sun is already very
    // low — it can't block a high midday sun no matter how close.
    if (obstacle.heightTier === 'low' && sunElevationDeg > 15) continue;
    if (shapeBlocks(plantLocation, obstacle, sunAzimuthDeg, sunElevationDeg, orientationDeg)) return obstacle;
  }
  return null;
}

function approxSolarNoonUTCHour(lon: number): number {
  return (((12 - lon / 15) % 24) + 24) % 24;
}

/** Morning / midday / afternoon sample instants for one reference date, in UTC. */
function sampleTimesUTC(monthDay: string, year: number, lon: number): Date[] {
  const noonHour = approxSolarNoonUTCHour(lon);
  const base = new Date(`${year}-${monthDay}T00:00:00Z`);
  return [-3, 0, 3].map((offsetHours) => {
    const d = new Date(base.getTime());
    d.setUTCHours(0, 0, 0, 0);
    d.setTime(d.getTime() + ((noonHour + offsetHours + 24) % 24) * 3_600_000);
    return d;
  });
}

export interface SeasonExposure {
  season: Season;
  /** Of the sampled daylight moments (morning/midday/afternoon), the fraction that were sunny. */
  sunFraction: number;
  sunny: boolean;
  /** One obstacle seen blocking the sun this season, if any — for "what's blocking it" messaging. */
  blockedBy?: YardObstacle;
}

/** Season-by-season sun/shade estimate for one point in the yard. */
export function estimateSeasonalExposure(
  plantLocation: Point,
  obstacles: YardObstacle[],
  lat: number,
  lon: number,
  orientationDeg = 0,
  year = new Date().getFullYear(),
): SeasonExposure[] {
  return SEASON_DATES.map(({ season, monthDay }) => {
    let sunnyCount = 0;
    let daylightCount = 0;
    let blockedBy: YardObstacle | undefined;

    for (const t of sampleTimesUTC(monthDay, year, lon)) {
      const pos = solarPosition(lat, lon, t);
      if (!isDaytime(pos)) continue;
      daylightCount++;
      const blocker = findBlocker(plantLocation, obstacles, pos.azimuthDeg, pos.elevationDeg, orientationDeg);
      if (blocker) blockedBy = blocker;
      else sunnyCount++;
    }

    const sunFraction = daylightCount ? sunnyCount / daylightCount : 0;
    return { season, sunFraction, sunny: sunFraction >= 0.5, blockedBy };
  });
}

export interface SunMapCell {
  x: number;
  y: number;
  /** Averaged across all four seasons. */
  sunFraction: number;
  classification: 'full-sun' | 'partial-shade' | 'full-shade';
}

/**
 * A grid of season-aware sun/shade estimates across the whole yard — for
 * picking a spot a plant can stay in year-round rather than checking one
 * point at a time. Same heuristics as `estimateSeasonalExposure`, just run
 * over every cell.
 */
export function computeSunMap(
  obstacles: YardObstacle[],
  lat: number,
  lon: number,
  orientationDeg = 0,
  cols = 20,
  rows = 14,
  year = new Date().getFullYear(),
): SunMapCell[] {
  const cells: SunMapCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = ((col + 0.5) / cols) * 100;
      const y = ((row + 0.5) / rows) * 100;
      const bySeason = estimateSeasonalExposure({ x, y }, obstacles, lat, lon, orientationDeg, year);
      const sunFraction = bySeason.reduce((sum, s) => sum + s.sunFraction, 0) / bySeason.length;
      const sunnySeasons = bySeason.filter((s) => s.sunny).length;
      const classification: SunMapCell['classification'] =
        sunnySeasons === bySeason.length ? 'full-sun' : sunnySeasons === 0 ? 'full-shade' : 'partial-shade';
      cells.push({ x, y, sunFraction, classification });
    }
  }
  return cells;
}

const SEASON_LABEL: Record<Season, string> = {
  spring: 'spring', summer: 'summer', fall: 'fall', winter: 'winter',
};

/** Plain-English readout comparing the estimate to what the plant wants. */
export function summarizeExposure(
  sunRequirement: Plant['sunRequirement'],
  bySeason: SeasonExposure[],
): string {
  const sunny = bySeason.filter((s) => s.sunny).map((s) => SEASON_LABEL[s.season]);
  const shaded = bySeason.filter((s) => !s.sunny).map((s) => SEASON_LABEL[s.season]);
  const allSunny = sunny.length === bySeason.length;
  const allShaded = shaded.length === bySeason.length;
  const summerShaded = bySeason.find((s) => s.season === 'summer' && !s.sunny);
  const summerSunny = bySeason.find((s) => s.season === 'summer' && s.sunny);

  if (sunRequirement === 'full-sun') {
    if (allSunny) return 'Sunny year-round — matches its full-sun needs.';
    if (summerShaded) {
      const hint = summerShaded.blockedBy ? ` (looks like the ${summerShaded.blockedBy.label || summerShaded.blockedBy.type} is in the way)` : '';
      return `Shaded in summer despite wanting full sun${hint} — worth a sunnier spot if it's struggling.`;
    }
    return `Mostly sunny, shaded in ${shaded.join('/')} — should still be fine for a full-sun plant.`;
  }

  if (sunRequirement === 'full-shade') {
    if (allShaded) return 'Shaded year-round — matches its full-shade needs.';
    if (summerSunny) return 'Gets direct summer sun despite wanting full shade — watch for scorch and extra water needs in hot months.';
    return `Mostly shaded, some sun in ${sunny.join('/')} — should still be fine for a shade plant.`;
  }

  // partial-shade — tolerant; only worth a note at the extremes.
  if (allSunny) return 'Sunny year-round — more sun than typical for partial shade; keep an eye on it in summer heat.';
  if (allShaded) return 'Shaded year-round — more shade than typical for partial shade; growth may be slower.';
  return `A mix through the year — sunny in ${sunny.join('/') || 'no season'}, shaded in ${shaded.join('/') || 'no season'} — a reasonable match for partial shade.`;
}
