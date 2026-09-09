// src/utils/sectionView.ts
// A "section" is a saved zoom/crop rectangle into a yard's one photo — not
// a second photo or a separate coordinate space. Zooming in is purely a
// CSS transform on the same image+markers wrapper every other view already
// renders; placing/dragging something while zoomed just needs one extra
// remap step to turn a click inside the zoomed viewport back into true
// whole-photo percent coordinates before it's saved. Nothing about how a
// plant or obstacle is stored ever changes.

import type { CSSProperties } from 'react';
import type { Point, YardSection } from '../types';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxFromSection(section: Pick<YardSection, 'boxX0' | 'boxY0' | 'boxX1' | 'boxY1'>): Box {
  return {
    x0: Math.min(section.boxX0, section.boxX1),
    y0: Math.min(section.boxY0, section.boxY1),
    x1: Math.max(section.boxX0, section.boxX1),
    y1: Math.max(section.boxY0, section.boxY1),
  };
}

/**
 * CSS transform that zooms a wrapper into just `box` — apply to the same
 * element that already holds the yard photo + SVG + markers, with
 * `transform-origin: 0 0` and `overflow: hidden` on its parent.
 *
 * Uses a single uniform scale, not independent X/Y factors: the container
 * this zooms into keeps the whole photo's own aspect ratio no matter which
 * section is active (its height is sized to the untransformed photo, and a
 * transform doesn't affect that layout size), but a hand-drawn box is
 * rarely square in percent terms. Stretching X and Y independently to force
 * a non-square box to exactly fill that fixed-aspect frame visibly distorts
 * the photo — buildings and plants stretch or squash.
 *
 * Scales uniformly by whichever axis needs *less* zoom (`contain`-style),
 * not more (`cover`-style) — there's no panning in this view, just a fixed
 * transform, so `cover` would crop part of the drawn box off-screen with no
 * way to reach it (this was tried and reported as "can't scroll to the
 * other side of the section"). `contain` guarantees the entire drawn box is
 * always visible, at the cost of showing a bit more than the drawn box
 * along the other axis rather than exactly the drawn rectangle.
 */
/** The uniform scale factor sectionTransformStyle applies for `box` —
 *  exposed on its own so callers can counteract it (e.g. keeping a marker's
 *  on-screen size constant regardless of zoom) without redoing this math. */
export function sectionZoomScale(box: Box): number {
  const width = Math.max(box.x1 - box.x0, 0.01);
  const height = Math.max(box.y1 - box.y0, 0.01);
  return Math.min(100 / width, 100 / height);
}

export function sectionTransformStyle(box: Box): CSSProperties {
  const scale = sectionZoomScale(box);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return {
    transformOrigin: '0 0',
    transform: `scale(${scale}) translate(${50 / scale - cx}%, ${50 / scale - cy}%)`,
  };
}

/** A point captured inside a zoomed viewport (percent of the *visible*
 *  area) back to true whole-photo percent coordinates — the exact inverse
 *  of toViewportPercent below (and note: NOT simply box-relative percent —
 *  that only agrees with this for a box that's square-in-percent, since
 *  sectionTransformStyle's "contain" scaling can leave slack on one axis). */
export function toYardPercent(localPoint: Point, box: Box): Point {
  const scale = sectionZoomScale(box);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return {
    x: (localPoint.x - 50) / scale + cx,
    y: (localPoint.y - 50) / scale + cy,
  };
}

/**
 * Whole-photo percent → percent of the visible (post-zoom) viewport —
 * the exact inverse of the `scale(...) translate(...)` sectionTransformStyle
 * applies, so a marker positioned with this lands exactly where the CSS
 * transform would have visually put it.
 *
 * Markers used to just sit inside the same transformed wrapper as the photo,
 * letting the CSS transform reposition (and resize) them "for free". That
 * relied on nested `transform: scale()` (the photo's zoom, and a counter-
 * scale on each marker to cancel out the size blow-up) composing reliably
 * across browsers — Chrome and Samsung Internet on Android turned out to
 * disagree about that badly enough that markers came out scattered in one
 * and invisible in the other. Computing the on-screen position in plain JS
 * math instead, and rendering markers in an unscaled sibling layer, sidesteps
 * that entirely: no nested transforms, just a left/top percent that already
 * accounts for the zoom.
 */
export function toViewportPercent(point: Point, box: Box | null): Point {
  if (!box) return point;
  const scale = sectionZoomScale(box);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return {
    x: scale * point.x + 50 - scale * cx,
    y: scale * point.y + 50 - scale * cy,
  };
}

/** Whether a whole-photo point falls inside a section's box — used to
 *  filter which plants/obstacles are relevant while adding a new section
 *  (drawn against the whole-yard view) or deciding what a zoomed view
 *  should visually contain. */
export function pointInBox(point: Point, box: Box): boolean {
  return point.x >= box.x0 && point.x <= box.x1 && point.y >= box.y0 && point.y <= box.y1;
}
