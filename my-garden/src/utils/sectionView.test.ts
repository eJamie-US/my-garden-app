import { describe, it, expect } from 'vitest';
import { boxFromSection, toYardPercent, pointInBox } from './sectionView';

describe('boxFromSection', () => {
  it('normalizes a box drawn in either corner order', () => {
    const box = boxFromSection({ boxX0: 60, boxY0: 40, boxX1: 20, boxY1: 10 });
    expect(box).toEqual({ x0: 20, y0: 10, x1: 60, y1: 40 });
  });
});

describe('toYardPercent', () => {
  it('maps the top-left of the zoomed viewport to the box origin', () => {
    const box = { x0: 20, y0: 10, x1: 60, y1: 50 };
    expect(toYardPercent({ x: 0, y: 0 }, box)).toEqual({ x: 20, y: 10 });
  });

  it('maps the center of the zoomed viewport to the center of the box', () => {
    const box = { x0: 20, y0: 10, x1: 60, y1: 50 };
    expect(toYardPercent({ x: 50, y: 50 }, box)).toEqual({ x: 40, y: 30 });
  });

  it('maps the bottom-right of the zoomed viewport to the box corner', () => {
    const box = { x0: 20, y0: 10, x1: 60, y1: 50 };
    expect(toYardPercent({ x: 100, y: 100 }, box)).toEqual({ x: 60, y: 50 });
  });
});

describe('pointInBox', () => {
  const box = { x0: 20, y0: 10, x1: 60, y1: 50 };

  it('is true for a point inside the box, including its edges', () => {
    expect(pointInBox({ x: 40, y: 30 }, box)).toBe(true);
    expect(pointInBox({ x: 20, y: 10 }, box)).toBe(true);
    expect(pointInBox({ x: 60, y: 50 }, box)).toBe(true);
  });

  it('is false for a point outside the box', () => {
    expect(pointInBox({ x: 10, y: 30 }, box)).toBe(false);
    expect(pointInBox({ x: 40, y: 60 }, box)).toBe(false);
  });
});
