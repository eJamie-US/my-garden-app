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

/** CSS transform that zooms a 100%-square wrapper into just `box` — apply
 *  to the same element that already holds the yard photo + SVG + markers,
 *  with `transform-origin: 0 0` and `overflow: hidden` on its parent. */
export function sectionTransformStyle(box: Box): CSSProperties {
  const width = Math.max(box.x1 - box.x0, 0.01);
  const height = Math.max(box.y1 - box.y0, 0.01);
  const scaleX = 100 / width;
  const scaleY = 100 / height;
  return {
    transformOrigin: '0 0',
    transform: `scale(${scaleX}, ${scaleY}) translate(${-box.x0}%, ${-box.y0}%)`,
  };
}

/** A point captured inside a zoomed viewport (percent of the *visible*
 *  area) back to true whole-photo percent coordinates. */
export function toYardPercent(localPoint: Point, box: Box): Point {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  return {
    x: box.x0 + (localPoint.x / 100) * width,
    y: box.y0 + (localPoint.y / 100) * height,
  };
}

/** Whether a whole-photo point falls inside a section's box — used to
 *  filter which plants/obstacles are relevant while adding a new section
 *  (drawn against the whole-yard view) or deciding what a zoomed view
 *  should visually contain. */
export function pointInBox(point: Point, box: Box): boolean {
  return point.x >= box.x0 && point.x <= box.x1 && point.y >= box.y0 && point.y <= box.y1;
}
