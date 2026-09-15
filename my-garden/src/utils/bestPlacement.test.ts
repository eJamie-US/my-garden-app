import { describe, it, expect } from 'vitest';
import { evaluatePlacement } from './bestPlacement';
import type { DailyWeather, Plant, Yard, YardObstacle } from '../types';

function pastDays(precipitations: number[]): DailyWeather[] {
  return precipitations.map((precipitation, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    tempMax: 20,
    tempMin: 10,
    precipitation,
    weatherCode: 0,
    condition: 'Clear sky',
    icon: '☀️',
  }));
}

const yard: Pick<Yard, 'latitude' | 'longitude' | 'orientationDeg'> = {
  latitude: 40,
  longitude: -105,
  orientationDeg: 0,
};

const fullSun: Pick<Plant, 'sunRequirement' | 'rainPreference' | 'windTolerance'> = {
  sunRequirement: 'full-sun',
  rainPreference: 'neutral',
  windTolerance: 'hardy',
};

function building(overrides: Partial<YardObstacle> = {}): YardObstacle {
  return {
    id: 'o1',
    userId: 'u1',
    yardId: 'y1',
    type: 'building',
    location: { x: 0, y: 0 },
    shape: { kind: 'rect', to: { x: 100, y: 30 } },
    heightTier: 'tall',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('evaluatePlacement', () => {
  it('returns null without a sun requirement', () => {
    expect(evaluatePlacement({ x: 50, y: 50 }, {}, [], yard)).toBeNull();
  });

  it('returns null without a yard location', () => {
    const result = evaluatePlacement({ x: 50, y: 50 }, fullSun, [], {
      latitude: undefined,
      longitude: undefined,
      orientationDeg: 0,
    });
    expect(result).toBeNull();
  });

  it('finds no better spot in a wide-open yard for a full-sun plant already in the open', () => {
    const result = evaluatePlacement({ x: 50, y: 90 }, fullSun, [], yard);
    expect(result).not.toBeNull();
    expect(result!.hasBetter).toBe(false);
    expect(result!.alternatives).toHaveLength(0);
    // Fully open ground gets rained on in all 4 seasons regardless of wind.
    expect(result!.current.rainySeasons).toBe(4);
  });

  it('suggests a better spot for a full-sun plant placed in a shaded strip', () => {
    // A tall building spans the top of the yard, casting shade nearby; the
    // rest of the yard (further from it) should score at least as well.
    const obstacles = [building()];
    const result = evaluatePlacement({ x: 50, y: 15 }, fullSun, obstacles, yard);
    expect(result).not.toBeNull();
    if (result!.hasBetter) {
      expect(result!.alternatives[0].score).toBeGreaterThan(result!.current.score);
    }
  });

  it('with no climatology, any roof shelters in every season (fallback behavior)', () => {
    const gazebo = building({
      type: 'gazebo',
      location: { x: 40, y: 40 },
      shape: { kind: 'rect', to: { x: 60, y: 60 } },
      heightTier: 'low',
      openEdges: ['top', 'right', 'bottom', 'left'],
    });
    const current = evaluatePlacement({ x: 50, y: 50 }, fullSun, [gazebo], yard);
    expect(current).not.toBeNull();
    expect(current!.current.rainySeasons).toBe(0);
  });

  it('uses a season-specific prevailing rain-wind direction when given one', () => {
    // A building with only its top edge open. Wind blowing straight in from
    // the north (bearing 0) in summer should expose a point near that edge,
    // while a season with no climatology (winter, here) falls back to
    // "any roof shelters."
    const shed = building({
      location: { x: 30, y: 30 },
      shape: { kind: 'rect', to: { x: 70, y: 70 } },
      openEdges: ['top'],
    });
    const withWind = evaluatePlacement({ x: 50, y: 32 }, fullSun, [shed], yard, {
      summer: { rainWindDirection: 0, avgWindSpeedKmh: null },
    });
    const withoutWind = evaluatePlacement({ x: 50, y: 32 }, fullSun, [shed], yard);

    expect(withWind).not.toBeNull();
    expect(withoutWind).not.toBeNull();
    // Knowing summer's prevailing wind exposes this point through the open
    // top edge that season, so it should count as rained on more often than
    // the no-data fallback (which assumes fully sheltered every season).
    expect(withWind!.current.rainySeasons).toBeGreaterThan(withoutWind!.current.rainySeasons);
  });

  it('a recent dry spell raises the score of a spot that currently gets rained on', () => {
    const openPoint = { x: 90, y: 90 };
    const withoutWeather = evaluatePlacement(openPoint, fullSun, [], yard);
    const withDrySpell = evaluatePlacement(openPoint, fullSun, [], yard, undefined, {
      past: pastDays([0, 0, 0, 0]),
      windDirection: 0,
    });
    expect(withoutWeather).not.toBeNull();
    expect(withDrySpell).not.toBeNull();
    expect(withDrySpell!.current.score).toBeGreaterThan(withoutWeather!.current.score);
  });

  it('a recent soaking raises the score of a spot that is currently sheltered, but not an open one', () => {
    // A gazebo with all edges open, but its center is far enough from every
    // edge that it still reads as sheltered right now (same geometry the
    // rainShelter tests use for "near an edge" vs not).
    const gazebo = building({
      type: 'gazebo',
      location: { x: 40, y: 40 },
      shape: { kind: 'rect', to: { x: 60, y: 60 } },
      heightTier: 'low',
      openEdges: ['top', 'right', 'bottom', 'left'],
    });
    const wetWeather = { past: pastDays([5, 5, 15]), windDirection: 0 };

    const roofedPoint = { x: 50, y: 50 };
    const roofedWithout = evaluatePlacement(roofedPoint, fullSun, [gazebo], yard);
    const roofedWithWetSpell = evaluatePlacement(roofedPoint, fullSun, [gazebo], yard, undefined, wetWeather);
    expect(roofedWithWetSpell!.current.score).toBeGreaterThan(roofedWithout!.current.score);

    const openPoint = { x: 90, y: 90 };
    const openWithout = evaluatePlacement(openPoint, fullSun, [gazebo], yard);
    const openWithWetSpell = evaluatePlacement(openPoint, fullSun, [gazebo], yard, undefined, wetWeather);
    expect(openWithWetSpell!.current.score).toBe(openWithout!.current.score);
  });

  it('with no weather passed, recent conditions have no effect', () => {
    const point = { x: 50, y: 50 };
    const a = evaluatePlacement(point, fullSun, [], yard);
    const b = evaluatePlacement(point, fullSun, [], yard, undefined, undefined);
    expect(a!.current.score).toBe(b!.current.score);
  });

  // Regression coverage for the original bug report: two plants sharing a
  // sunRequirement used to always get the exact same suggested spots, since
  // sun was nearly the whole score. Rain/wind preferences now genuinely
  // differentiate them.
  describe('rain and wind preferences differentiate scoring', () => {
    const gazebo = building({
      type: 'gazebo',
      location: { x: 40, y: 40 },
      shape: { kind: 'rect', to: { x: 60, y: 60 } },
      heightTier: 'low',
      openEdges: ['top', 'right', 'bottom', 'left'],
    });
    const shelteredPoint = { x: 50, y: 50 }; // under the gazebo, far from its open edges
    const openPoint = { x: 90, y: 90 };

    it('a dry-preferring plant scores a sheltered spot higher than a wet-preferring plant does', () => {
      const dryLover = { ...fullSun, rainPreference: 'prefers-dry' as const };
      const wetLover = { ...fullSun, rainPreference: 'prefers-wet' as const };

      const dryAtSheltered = evaluatePlacement(shelteredPoint, dryLover, [gazebo], yard)!.current;
      const wetAtSheltered = evaluatePlacement(shelteredPoint, wetLover, [gazebo], yard)!.current;

      expect(dryAtSheltered.rainClassification).toBe('dry');
      expect(dryAtSheltered.score).toBeGreaterThan(wetAtSheltered.score);
    });

    it('a wet-preferring plant scores an open spot higher than a dry-preferring plant does', () => {
      const dryLover = { ...fullSun, rainPreference: 'prefers-dry' as const };
      const wetLover = { ...fullSun, rainPreference: 'prefers-wet' as const };

      const dryAtOpen = evaluatePlacement(openPoint, dryLover, [gazebo], yard)!.current;
      const wetAtOpen = evaluatePlacement(openPoint, wetLover, [gazebo], yard)!.current;

      expect(wetAtOpen.rainClassification).toBe('wet');
      expect(wetAtOpen.score).toBeGreaterThan(dryAtOpen.score);
    });

    it('a fragile plant scores a wind-sheltered spot higher than a hardy plant does, in a windy climate', () => {
      // 22 km/h ambient: sheltered (×0.4 shelter factor) lands at 8.8 —
      // "calm" — while unsheltered stays at 22 — "windy". A fragile plant's
      // match table treats calm as strictly better (2) than a hardy
      // plant's flat treatment (1 everywhere), so only the fragile plant's
      // score should actually move.
      const windyClimate = {
        spring: { rainWindDirection: null, avgWindSpeedKmh: 22 },
        summer: { rainWindDirection: null, avgWindSpeedKmh: 22 },
        fall: { rainWindDirection: null, avgWindSpeedKmh: 22 },
        winter: { rainWindDirection: null, avgWindSpeedKmh: 22 },
      };
      const fragile = { ...fullSun, windTolerance: 'fragile' as const };
      const hardy = { ...fullSun, windTolerance: 'hardy' as const };

      const fragileSheltered = evaluatePlacement(shelteredPoint, fragile, [gazebo], yard, windyClimate)!.current;
      const hardySheltered = evaluatePlacement(shelteredPoint, hardy, [gazebo], yard, windyClimate)!.current;

      expect(fragileSheltered.score).toBeGreaterThan(hardySheltered.score);
    });
  });
});
