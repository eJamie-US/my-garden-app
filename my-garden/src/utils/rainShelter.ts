// src/utils/rainShelter.ts
// Whether a plant sitting under a roofed yard obstacle (a building, covered
// porch, or gazebo) actually stays dry right now — a roof blocks rain
// falling straight down, but wind can still carry rain in sideways through
// any side that isn't walled off. Same photo-space/orientation conventions
// as sunExposure.ts, and the same "no real-world scale" caveat: this
// reasons in percent-of-yard-photo distance, not metres.

import type { TFunction } from 'i18next';
import type { ObstacleEdge, Plant, YardObstacle } from '../types';

type Point = { x: number; y: number };

/** Obstacle types with an actual roof — the only ones rain shelter applies
 *  to. A tree's canopy and a fence don't shelter anything from rain in this
 *  model (canopy cover is handled qualitatively, not geometrically). */
const ROOFED_TYPES = new Set<YardObstacle['type']>(['building', 'covered-porch', 'gazebo']);

/** How close to an open edge, as a fraction of the structure's own size in
 *  that direction, still counts as "wind-driven rain can reach it" — a
 *  ground-level plant in the middle of a big carport stays dry even with
 *  one open side; one right next to that opening doesn't. */
const EXPOSURE_FRACTION = 0.4;

/** How far off dead-on a wind direction can be from an edge's outward
 *  bearing and still count as blowing in through it, rather than past it. */
const WIND_CONE_DEG = 60;

/** Outward-facing bearing of one rect edge, in photo space before
 *  orientation — 'top' (the obstacle's min-y edge) points the same
 *  direction as bearingTo's 0, i.e. "up" in the photo; same convention as
 *  sunExposure.ts's bearingTo. */
const EDGE_PHOTO_BEARING: Record<ObstacleEdge, number> = {
  top: 0,
  right: 90,
  bottom: 180,
  left: 270,
};

function edgeBearing(edge: ObstacleEdge, orientationDeg: number): number {
  return ((EDGE_PHOTO_BEARING[edge] + orientationDeg) % 360 + 360) % 360;
}

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function rectBounds(location: Point, to: Point) {
  return {
    left: Math.min(location.x, to.x),
    right: Math.max(location.x, to.x),
    top: Math.min(location.y, to.y),
    bottom: Math.max(location.y, to.y),
  };
}

export interface RainShelterResult {
  /** True when a roof is actually keeping this plant dry right now. False
   *  either because it isn't under any roofed obstacle at all, or wind is
   *  driving rain in through an open side close enough to reach it. */
  sheltered: boolean;
  /** The roofed obstacle the plant sits under, if any — for messaging. */
  obstacle?: YardObstacle;
  /** Which open edge is letting rain in, when not sheltered but under a roof. */
  exposedEdge?: ObstacleEdge;
}

/**
 * Whether `plant` currently sits dry under any roofed obstacle.
 *
 * `windFromDeg` is the compass direction wind is blowing FROM (Open-Meteo's
 * convention, same as WeatherData.windDirection) — omit it (no weather
 * available) to fall back to "a roof with any open side is assumed to
 * shelter it," since there's nothing to reason about wind with.
 *
 * `plant.mount === 'hanging'` treats the plant as sitting right at the
 * roofline — exposed through *any* open edge the wind faces, not just
 * whichever one its marker happens to be nearest.
 */
export function computeRainShelter(
  plant: Pick<Plant, 'location' | 'mount'>,
  obstacles: YardObstacle[],
  orientationDeg: number,
  windFromDeg?: number,
): RainShelterResult {
  for (const obstacle of obstacles) {
    if (!ROOFED_TYPES.has(obstacle.type)) continue;
    const shape = obstacle.shape;
    if (!shape || shape.kind !== 'rect') continue;

    const bounds = rectBounds(obstacle.location, shape.to);
    const { x, y } = plant.location;
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;

    const openEdges = obstacle.openEdges ?? [];
    if (openEdges.length === 0) return { sheltered: true, obstacle };
    if (windFromDeg == null) return { sheltered: true, obstacle };

    const width = bounds.right - bounds.left || 1;
    const height = bounds.bottom - bounds.top || 1;
    const nearEdge: Record<ObstacleEdge, boolean> = {
      left: x - bounds.left <= width * EXPOSURE_FRACTION,
      right: bounds.right - x <= width * EXPOSURE_FRACTION,
      top: y - bounds.top <= height * EXPOSURE_FRACTION,
      bottom: bounds.bottom - y <= height * EXPOSURE_FRACTION,
    };

    const exposedEdge = openEdges.find((edge) => {
      const facingWind = angularDiff(edgeBearing(edge, orientationDeg), windFromDeg) < WIND_CONE_DEG;
      if (!facingWind) return false;
      return plant.mount === 'hanging' || nearEdge[edge];
    });

    return exposedEdge ? { sheltered: false, obstacle, exposedEdge } : { sheltered: true, obstacle };
  }
  return { sheltered: false };
}

const EDGE_COMPASS_KEY: Record<ObstacleEdge, string> = {
  top: 'North', right: 'East', bottom: 'South', left: 'West',
};

/** Readout of a shelter result, for the plant form/care modal. `t` comes
 *  from the caller's own useTranslation() — this file has no component of
 *  its own to call it from. */
export function describeRainShelter(t: TFunction, result: RainShelterResult, obstacleLabel: string): string {
  if (!result.obstacle) return t('rainShelter.outInOpen');
  if (result.sheltered) return t('rainShelter.sheltered', { obstacle: obstacleLabel });
  if (!result.exposedEdge) return t('rainShelter.exposed', { obstacle: obstacleLabel });
  const edge = t(`rainShelter.compass${EDGE_COMPASS_KEY[result.exposedEdge]}`);
  return t('rainShelter.exposedThroughEdge', { obstacle: obstacleLabel, edge });
}
