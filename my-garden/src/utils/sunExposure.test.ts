import { describe, it, expect } from 'vitest';
import { findBlocker, estimateSeasonalExposure, summarizeExposure } from './sunExposure';
import type { YardObstacle } from '../types';

const LAT = 45.5152;
const LON = -122.6784;

function obstacle(overrides: Partial<YardObstacle> = {}): YardObstacle {
  return {
    id: 'o1',
    userId: 'u1',
    yardId: 'y1',
    type: 'tree',
    location: { x: 50, y: 20 }, // north of a plant at (50, 50), orientation 0
    heightTier: 'tall',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('findBlocker', () => {
  const plant = { x: 50, y: 50 };

  it('blocks when a tall obstacle sits right in the sun\'s direction, close enough', () => {
    // Obstacle due north of the plant (photo-space "up") = bearing 0 with orientation 0.
    const blocker = findBlocker(plant, [obstacle({ location: { x: 50, y: 35 } })], 0, 30, 0);
    expect(blocker).not.toBeNull();
  });

  it('does not block when the obstacle is roughly opposite the sun', () => {
    // Obstacle due south (bearing 180) while the sun is due north (azimuth 0).
    const blocker = findBlocker(plant, [obstacle({ location: { x: 50, y: 65 } })], 0, 30, 0);
    expect(blocker).toBeNull();
  });

  it('does not block when the same obstacle is too far away for its height tier', () => {
    const far = obstacle({ location: { x: 50, y: 51 }, heightTier: 'low' });
    // A low obstacle 40 percent-units away, with the sun still fairly high
    // (30°) — well outside the 'low' tier's blocking range even at its
    // widest, and 'low' never blocks above 15° elevation at all.
    const blocker = findBlocker({ x: 50, y: 90 }, [far], 0, 30, 0);
    expect(blocker).toBeNull();
  });

  it('a low obstacle only blocks a low (near-sunrise/sunset) sun, not a high midday sun', () => {
    const fence = obstacle({ location: { x: 50, y: 45 }, heightTier: 'low' });
    const atMidday = findBlocker(plant, [fence], 0, 45, 0);
    const atSunset = findBlocker(plant, [fence], 0, 8, 0);
    expect(atMidday).toBeNull();
    expect(atSunset).not.toBeNull();
  });

  it('respects yard orientation — a photo not drawn north-up still resolves correctly', () => {
    // Obstacle is to the photo-right of the plant (east in photo-space).
    // If the photo's "up" is actually East (orientation 90°), photo-right
    // ("east" in photo-space, bearing 90 unrotated) becomes true bearing 180 (south).
    const eastOfPlant = obstacle({ location: { x: 65, y: 50 } });
    const blockedWhenSunSouth = findBlocker(plant, [eastOfPlant], 180, 30, 90);
    const blockedWhenSunNorth = findBlocker(plant, [eastOfPlant], 0, 30, 90);
    expect(blockedWhenSunSouth).not.toBeNull();
    expect(blockedWhenSunNorth).toBeNull();
  });
});

describe('findBlocker with a sized shape', () => {
  const plant = { x: 50, y: 50 };

  it('a circle widens the blocking cone beyond the flat-point guess', () => {
    // Obstacle bearing 0 (due north), 10 units away — a sun at bearing 45°
    // sits outside the legacy ±30° point-cone but within a circle wide
    // enough to actually subtend that angle from 10 units off.
    const asPoint = obstacle({ location: { x: 50, y: 40 }, heightTier: 'tall' });
    const asCircle: typeof asPoint = { ...asPoint, shape: { kind: 'circle', radius: 8 } };

    expect(findBlocker(plant, [asPoint], 45, 30, 0)).toBeNull();
    expect(findBlocker(plant, [asCircle], 45, 30, 0)).not.toBeNull();
  });

  it('a line only blocks sun bearings that fall within its span', () => {
    const fence: YardObstacle = {
      ...obstacle({ location: { x: 40, y: 40 }, heightTier: 'tall' }),
      shape: { kind: 'line', to: { x: 60, y: 40 } },
    };
    // The fence runs east-west, 10 units north of the plant — due north
    // (bearing 0) passes straight through its span; due east (bearing 90)
    // passes well outside it.
    expect(findBlocker(plant, [fence], 0, 30, 0)).not.toBeNull();
    expect(findBlocker(plant, [fence], 90, 30, 0)).toBeNull();
  });

  it('a rectangle blocks across its whole footprint, not just its anchor corner', () => {
    const building: YardObstacle = {
      ...obstacle({ location: { x: 40, y: 30 }, heightTier: 'tall' }),
      shape: { kind: 'rect', to: { x: 60, y: 45 } },
    };
    // Bearing to the far (60,45) corner from the plant differs from the
    // bearing to the (40,30) anchor corner — both should still resolve to
    // "blocked" since the sun passes over the footprint either way.
    expect(findBlocker(plant, [building], 0, 30, 0)).not.toBeNull();
  });

  it('a plant standing inside a shape\'s footprint is always blocked by it', () => {
    const overhead: YardObstacle = {
      ...obstacle({ location: { x: 45, y: 45 }, heightTier: 'tall' }),
      shape: { kind: 'triangle', b: { x: 55, y: 45 }, c: { x: 50, y: 55 } },
    };
    // Whatever direction the sun happens to be in, standing under the
    // obstacle's own footprint should block it.
    expect(findBlocker(plant, [overhead], 200, 60, 0)).not.toBeNull();
  });
});

describe('estimateSeasonalExposure', () => {
  it('is sunny in every season with no obstacles marked', () => {
    const result = estimateSeasonalExposure({ x: 50, y: 50 }, [], LAT, LON, 0, 2026);
    expect(result).toHaveLength(4);
    for (const s of result) expect(s.sunny).toBe(true);
  });

  it('a tall obstacle due south measurably reduces sun compared to no obstacles at all', () => {
    // In the northern hemisphere the sun sits roughly south around solar
    // noon — a close, tall obstacle placed due south should knock out at
    // least the midday sample in some season, even if it doesn't block the
    // whole day (the sun swings well east/west of due south by morning
    // and afternoon, outside this obstacle's narrow blocking cone).
    const obstacles = [obstacle({ location: { x: 50, y: 65 }, heightTier: 'tall' })];
    const withObstacle = estimateSeasonalExposure({ x: 50, y: 50 }, obstacles, LAT, LON, 0, 2026);
    const clear = estimateSeasonalExposure({ x: 50, y: 50 }, [], LAT, LON, 0, 2026);

    const totalSunWith = withObstacle.reduce((sum, s) => sum + s.sunFraction, 0);
    const totalSunClear = clear.reduce((sum, s) => sum + s.sunFraction, 0);
    expect(totalSunWith).toBeLessThan(totalSunClear);
  });
});

describe('summarizeExposure', () => {
  const sunnyAll = (['spring', 'summer', 'fall', 'winter'] as const).map((season) => ({
    season, sunHours: 10, sunFraction: 1, sunny: true,
  }));
  const shadedAll = (['spring', 'summer', 'fall', 'winter'] as const).map((season) => ({
    season, sunHours: 0, sunFraction: 0, sunny: false,
  }));

  it('confirms a match for a full-sun plant that is sunny year-round', () => {
    expect(summarizeExposure('full-sun', sunnyAll)).toMatch(/matches its full-sun/i);
  });

  it('flags a full-sun plant shaded in summer', () => {
    const bySeason = sunnyAll.map((s) => (s.season === 'summer' ? { ...s, sunny: false, sunHours: 0, sunFraction: 0 } : s));
    expect(summarizeExposure('full-sun', bySeason)).toMatch(/shaded in summer/i);
  });

  it('confirms a match for a full-shade plant that is shaded year-round', () => {
    expect(summarizeExposure('full-shade', shadedAll)).toMatch(/matches its full-shade/i);
  });

  it('flags a full-shade plant getting direct summer sun', () => {
    const bySeason = shadedAll.map((s) => (s.season === 'summer' ? { ...s, sunny: true, sunHours: 10, sunFraction: 1 } : s));
    expect(summarizeExposure('full-shade', bySeason)).toMatch(/direct summer sun/i);
  });

  it('calls out a partial-shade plant that is sunny year-round as more sun than typical', () => {
    expect(summarizeExposure('partial-shade', sunnyAll)).toMatch(/more sun than typical/i);
  });
});
