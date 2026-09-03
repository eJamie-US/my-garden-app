import { describe, it, expect } from 'vitest';
import { computeRainShelter } from './rainShelter';
import type { YardObstacle } from '../types';

function porch(overrides: Partial<YardObstacle> = {}): YardObstacle {
  return {
    id: 'o1',
    userId: 'u1',
    type: 'covered-porch',
    location: { x: 30, y: 30 },
    shape: { kind: 'rect', to: { x: 70, y: 70 } },
    heightTier: 'medium',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('computeRainShelter', () => {
  it('is not sheltered when the plant is out in the open', () => {
    const result = computeRainShelter({ location: { x: 10, y: 10 } }, [porch()], 0, 180);
    expect(result.sheltered).toBe(false);
    expect(result.obstacle).toBeUndefined();
  });

  it('fully enclosed (no open edges) always shelters, regardless of wind', () => {
    const result = computeRainShelter({ location: { x: 50, y: 50 } }, [porch({ openEdges: [] })], 0, 0);
    expect(result.sheltered).toBe(true);
  });

  it('with no wind data, any roof is assumed to shelter', () => {
    const result = computeRainShelter(
      { location: { x: 50, y: 50 } },
      [porch({ openEdges: ['top'] })],
      0,
      undefined,
    );
    expect(result.sheltered).toBe(true);
  });

  it('a ground plant near an open edge gets wet when wind blows straight through it', () => {
    // Top edge open, plant near the top (low y) — wind from the north
    // (bearing 0) blows straight in through the photo-top edge.
    const obstacles = [porch({ openEdges: ['top'] })];
    const nearTop = computeRainShelter({ location: { x: 50, y: 32 } }, obstacles, 0, 0);
    expect(nearTop.sheltered).toBe(false);
    expect(nearTop.exposedEdge).toBe('top');
  });

  it('a ground plant far from the only open edge stays dry', () => {
    const obstacles = [porch({ openEdges: ['top'] })];
    // Same wind, but this plant sits near the bottom (far from the open top edge).
    const nearBottom = computeRainShelter({ location: { x: 50, y: 68 } }, obstacles, 0, 0);
    expect(nearBottom.sheltered).toBe(true);
  });

  it('wind blowing away from the only open edge leaves everyone dry', () => {
    const obstacles = [porch({ openEdges: ['top'] })];
    // Wind from the south (180) blows away from the north-facing open edge.
    const result = computeRainShelter({ location: { x: 50, y: 32 } }, obstacles, 0, 180);
    expect(result.sheltered).toBe(true);
  });

  it('a hanging plant is exposed through a facing open edge no matter where under the roof it sits', () => {
    const obstacles = [porch({ openEdges: ['top'] })];
    // Middle of the structure, far from the top edge — a ground plant here is fine...
    const grounded = computeRainShelter({ location: { x: 50, y: 68 }, mount: 'ground' }, obstacles, 0, 0);
    expect(grounded.sheltered).toBe(true);
    // ...but a hanging one at the same spot is treated as being at the roofline.
    const hanging = computeRainShelter({ location: { x: 50, y: 68 }, mount: 'hanging' }, obstacles, 0, 0);
    expect(hanging.sheltered).toBe(false);
  });

  it('a gazebo (all sides open) exposes a plant near whichever edge the wind is blowing through', () => {
    const gazebo = porch({ type: 'gazebo', openEdges: ['top', 'right', 'bottom', 'left'] });
    const nearEachEdge: Record<'top' | 'right' | 'bottom' | 'left', { x: number; y: number }> = {
      top: { x: 50, y: 32 },
      right: { x: 68, y: 50 },
      bottom: { x: 50, y: 68 },
      left: { x: 32, y: 50 },
    };
    const windForEdge = { top: 0, right: 90, bottom: 180, left: 270 };
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const result = computeRainShelter({ location: nearEachEdge[edge] }, [gazebo], 0, windForEdge[edge]);
      expect(result.sheltered).toBe(false);
    }
  });

  it('a gazebo still keeps a well-centered plant dry, since no single wind direction reaches that far in', () => {
    const gazebo = porch({ type: 'gazebo', openEdges: ['top', 'right', 'bottom', 'left'] });
    const result = computeRainShelter({ location: { x: 50, y: 50 } }, [gazebo], 0, 0);
    expect(result.sheltered).toBe(true);
  });

  it('respects yard orientation when resolving which edge faces which wind', () => {
    // Orientation 90: the photo's "top" edge now faces true east (bearing 90).
    const obstacles = [porch({ openEdges: ['top'] })];
    const windFromEast = computeRainShelter({ location: { x: 50, y: 32 } }, obstacles, 90, 90);
    expect(windFromEast.sheltered).toBe(false);
    const windFromNorth = computeRainShelter({ location: { x: 50, y: 32 } }, obstacles, 90, 0);
    expect(windFromNorth.sheltered).toBe(true);
  });
});
