import { describe, it, expect } from 'vitest';
import { findBlocker, estimateSeasonalExposure, summarizeExposure } from './sunExposure';
import type { YardObstacle } from '../types';

const LAT = 45.5152;
const LON = -122.6784;

function obstacle(overrides: Partial<YardObstacle> = {}): YardObstacle {
  return {
    id: 'o1',
    userId: 'u1',
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
    season, sunFraction: 1, sunny: true,
  }));
  const shadedAll = (['spring', 'summer', 'fall', 'winter'] as const).map((season) => ({
    season, sunFraction: 0, sunny: false,
  }));

  it('confirms a match for a full-sun plant that is sunny year-round', () => {
    expect(summarizeExposure('full-sun', sunnyAll)).toMatch(/matches its full-sun/i);
  });

  it('flags a full-sun plant shaded in summer', () => {
    const bySeason = sunnyAll.map((s) => (s.season === 'summer' ? { ...s, sunny: false, sunFraction: 0 } : s));
    expect(summarizeExposure('full-sun', bySeason)).toMatch(/shaded in summer/i);
  });

  it('confirms a match for a full-shade plant that is shaded year-round', () => {
    expect(summarizeExposure('full-shade', shadedAll)).toMatch(/matches its full-shade/i);
  });

  it('flags a full-shade plant getting direct summer sun', () => {
    const bySeason = shadedAll.map((s) => (s.season === 'summer' ? { ...s, sunny: true, sunFraction: 1 } : s));
    expect(summarizeExposure('full-shade', bySeason)).toMatch(/direct summer sun/i);
  });

  it('calls out a partial-shade plant that is sunny year-round as more sun than typical', () => {
    expect(summarizeExposure('partial-shade', sunnyAll)).toMatch(/more sun than typical/i);
  });
});
