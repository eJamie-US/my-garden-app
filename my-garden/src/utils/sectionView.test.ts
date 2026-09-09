import { describe, it, expect } from 'vitest';
import {
  boxFromSection,
  sectionTransformStyle,
  sectionZoomScale,
  toYardPercent,
  toViewportPercent,
  pointInBox,
} from './sectionView';

/** Pulls the scale factor(s) and translate percentages out of a
 *  `scale(...) translate(...)` transform string for easy assertions. */
function parseTransform(transform: string) {
  const scaleMatch = transform.match(/scale\(([^)]+)\)/);
  const translateMatch = transform.match(/translate\(([^)]+)\)/);
  const scaleParts = (scaleMatch?.[1] ?? '').split(',').map((n) => parseFloat(n));
  const translateParts = (translateMatch?.[1] ?? '').split(',').map((n) => parseFloat(n));
  return { scaleParts, translateParts };
}

describe('boxFromSection', () => {
  it('normalizes a box drawn in either corner order', () => {
    const box = boxFromSection({ boxX0: 60, boxY0: 40, boxX1: 20, boxY1: 10 });
    expect(box).toEqual({ x0: 20, y0: 10, x1: 60, y1: 40 });
  });
});

describe('sectionTransformStyle', () => {
  it('uses one uniform scale factor, never independent X/Y factors', () => {
    // A wide, short box — the kind a "back yard" strip is likely to be —
    // is nowhere near square in percent terms.
    const box = { x0: 0, y0: 40, x1: 100, y1: 60 };
    const { transform } = sectionTransformStyle(box);
    const { scaleParts } = parseTransform(transform!.toString());
    // A single-argument scale(s) applies the same factor to both axes —
    // this is the actual bug fix: previously this was scale(sx, sy) with
    // sx !== sy, which stretches the photo non-uniformly.
    expect(scaleParts).toHaveLength(1);
  });

  it('matches the old exact-fit behavior for a square-in-percent box', () => {
    const box = { x0: 20, y0: 10, x1: 60, y1: 50 }; // 40 wide, 40 tall
    const { transform } = sectionTransformStyle(box);
    const { scaleParts, translateParts } = parseTransform(transform!.toString());
    expect(scaleParts[0]).toBeCloseTo(100 / 40);
    expect(translateParts[0]).toBeCloseTo(-20); // -box.x0
    expect(translateParts[1]).toBeCloseTo(-10); // -box.y0
  });

  it('centers a non-square box in the viewport instead of stretching it', () => {
    const box = { x0: 0, y0: 40, x1: 100, y1: 60 }; // 100 wide, 20 tall
    const { transform } = sectionTransformStyle(box);
    const { scaleParts, translateParts } = parseTransform(transform!.toString());
    const scale = scaleParts[0];
    // The box's own center, after this transform, should land exactly at
    // the viewport's center (50%, 50%) — same "translate first, then
    // scale" composition toYardPercent-adjacent code assumes.
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    expect((cx + translateParts[0]) * scale).toBeCloseTo(50);
    expect((cy + translateParts[1]) * scale).toBeCloseTo(50);
  });

  it('never crops any part of the drawn box out of the viewport', () => {
    // There's no panning in this view — a corner landing outside [0,100]
    // means that part of the box is permanently unreachable, not just
    // temporarily off-screen. Checked on both a wide-short and a tall-thin
    // box, since only one axis is ever the "extra margin" one.
    for (const box of [
      { x0: 0, y0: 40, x1: 100, y1: 60 }, // wide, short
      { x0: 40, y0: 0, x1: 60, y1: 100 }, // tall, thin
    ]) {
      const { transform } = sectionTransformStyle(box);
      const { scaleParts, translateParts } = parseTransform(transform!.toString());
      const scale = scaleParts[0];
      const corners = [
        { x: box.x0, y: box.y0 },
        { x: box.x1, y: box.y1 },
      ];
      for (const corner of corners) {
        const viewportX = (corner.x + translateParts[0]) * scale;
        const viewportY = (corner.y + translateParts[1]) * scale;
        expect(viewportX).toBeGreaterThanOrEqual(-0.01);
        expect(viewportX).toBeLessThanOrEqual(100.01);
        expect(viewportY).toBeGreaterThanOrEqual(-0.01);
        expect(viewportY).toBeLessThanOrEqual(100.01);
      }
    }
  });
});

describe('sectionZoomScale', () => {
  it('matches the scale factor sectionTransformStyle actually applies', () => {
    // GardenCanvas counter-scales markers and corrects clustering math by
    // this value — if it ever drifted from sectionTransformStyle's own
    // scale, markers would render at the wrong size (or clustering would
    // measure the wrong on-screen distance) the moment a section zooms in.
    for (const box of [
      { x0: 20, y0: 10, x1: 60, y1: 50 }, // square-in-percent
      { x0: 0, y0: 40, x1: 100, y1: 60 }, // wide, short
      { x0: 70, y0: 80, x1: 90, y1: 95 }, // a small, tightly-zoomed corner
    ]) {
      const { transform } = sectionTransformStyle(box);
      const { scaleParts } = parseTransform(transform!.toString());
      expect(sectionZoomScale(box)).toBeCloseTo(scaleParts[0]);
    }
  });

  it('is 1 for a box spanning the whole photo — no zoom, no correction needed', () => {
    expect(sectionZoomScale({ x0: 0, y0: 0, x1: 100, y1: 100 })).toBeCloseTo(1);
  });
});

describe('toViewportPercent', () => {
  it('is the identity when no section is active', () => {
    expect(toViewportPercent({ x: 37, y: 81 }, null)).toEqual({ x: 37, y: 81 });
  });

  it('puts the box center at the viewport center', () => {
    const box = { x0: 20, y0: 10, x1: 60, y1: 50 };
    const { x, y } = toViewportPercent({ x: 40, y: 30 }, box);
    expect(x).toBeCloseTo(50);
    expect(y).toBeCloseTo(50);
  });

  it('is the exact inverse of the CSS transform sectionTransformStyle applies', () => {
    // A wide, short box on a portrait photo (matches a real "Back Yard"
    // section) — width and height need different zoom to fit, so this only
    // passes if the *slack* axis (height, here) is handled correctly too,
    // not just the axis the scale factor was chosen from.
    const box = { x0: 42.4919119738339, y0: 2.25173935577089, x1: 97.0776450511945, y1: 37.4762458184788 };
    const scale = sectionZoomScale(box);
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    for (const point of [
      { x: box.x0, y: box.y0 },
      { x: box.x1, y: box.y1 },
      { x: 51.337, y: 34.182 }, // a real plant location inside this box
    ]) {
      const { x, y } = toViewportPercent(point, box);
      // What sectionTransformStyle's own transform does to this point:
      // screen = scale*content + 50 - scale*center.
      expect(x).toBeCloseTo(scale * point.x + 50 - scale * cx);
      expect(y).toBeCloseTo(scale * point.y + 50 - scale * cy);
    }
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

describe('toViewportPercent / toYardPercent round-trip', () => {
  it('are exact inverses of each other, including on a wide/short box', () => {
    const box = { x0: 0, y0: 40, x1: 100, y1: 60 };
    for (const point of [{ x: 10, y: 45 }, { x: 90, y: 55 }, { x: 50, y: 50 }]) {
      const roundTripped = toYardPercent(toViewportPercent(point, box), box);
      expect(roundTripped.x).toBeCloseTo(point.x);
      expect(roundTripped.y).toBeCloseTo(point.y);
    }
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
