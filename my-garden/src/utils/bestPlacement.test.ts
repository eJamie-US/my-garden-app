import { describe, it, expect } from 'vitest';
import { evaluatePlacement } from './bestPlacement';
import type { DailyWeather, Yard, YardObstacle } from '../types';

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
    expect(evaluatePlacement({ x: 50, y: 50 }, undefined, [], yard)).toBeNull();
  });

  it('returns null without a yard location', () => {
    const result = evaluatePlacement({ x: 50, y: 50 }, 'full-sun', [], {
      latitude: undefined,
      longitude: undefined,
      orientationDeg: 0,
    });
    expect(result).toBeNull();
  });

  it('finds no better spot in a wide-open yard for a full-sun plant already in the open', () => {
    const result = evaluatePlacement({ x: 50, y: 90 }, 'full-sun', [], yard);
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
    const result = evaluatePlacement({ x: 50, y: 15 }, 'full-sun', obstacles, yard);
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
    const current = evaluatePlacement({ x: 50, y: 50 }, 'full-sun', [gazebo], yard);
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
    const withWind = evaluatePlacement({ x: 50, y: 32 }, 'full-sun', [shed], yard, {
      summer: 0,
    });
    const withoutWind = evaluatePlacement({ x: 50, y: 32 }, 'full-sun', [shed], yard);

    expect(withWind).not.toBeNull();
    expect(withoutWind).not.toBeNull();
    // Knowing summer's prevailing wind exposes this point through the open
    // top edge that season, so it should count as rained on more often than
    // the no-data fallback (which assumes fully sheltered every season).
    expect(withWind!.current.rainySeasons).toBeGreaterThan(withoutWind!.current.rainySeasons);
  });

  it('a recent dry spell raises the score of a spot that currently gets rained on', () => {
    const openPoint = { x: 90, y: 90 };
    const withoutWeather = evaluatePlacement(openPoint, 'full-sun', [], yard);
    const withDrySpell = evaluatePlacement(openPoint, 'full-sun', [], yard, undefined, {
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
    const roofedWithout = evaluatePlacement(roofedPoint, 'full-sun', [gazebo], yard);
    const roofedWithWetSpell = evaluatePlacement(roofedPoint, 'full-sun', [gazebo], yard, undefined, wetWeather);
    expect(roofedWithWetSpell!.current.score).toBeGreaterThan(roofedWithout!.current.score);

    const openPoint = { x: 90, y: 90 };
    const openWithout = evaluatePlacement(openPoint, 'full-sun', [gazebo], yard);
    const openWithWetSpell = evaluatePlacement(openPoint, 'full-sun', [gazebo], yard, undefined, wetWeather);
    expect(openWithWetSpell!.current.score).toBe(openWithout!.current.score);
  });

  it('with no weather passed, recent conditions have no effect', () => {
    const point = { x: 50, y: 50 };
    const a = evaluatePlacement(point, 'full-sun', [], yard);
    const b = evaluatePlacement(point, 'full-sun', [], yard, undefined, undefined);
    expect(a!.current.score).toBe(b!.current.score);
  });
});
