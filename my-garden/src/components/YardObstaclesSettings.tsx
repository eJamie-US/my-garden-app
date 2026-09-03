// src/components/YardObstaclesSettings.tsx
// Mark roughly where buildings, covered porches, shade sails, trees and
// fences sit in the yard photo, sized to their actual footprint — a circle
// for a tree, a line for a fence, a rectangle for a building/porch, a
// triangle for a triangular shade sail. Feeds the sun/shade exposure
// estimate (see utils/sunExposure.ts); position and size only need to be
// approximate, same as everything else that estimate does.

import { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { yardObstaclesService } from '../services/supabase/yardObstacles';
import type { ObstacleEdge, ObstacleHeightTier, ObstacleShape, Point, YardObstacle, YardObstacleType } from '../types';

type ShapeKind = 'point' | 'circle' | 'line' | 'rect' | 'triangle';

const TYPE_OPTIONS: { value: YardObstacleType; label: string; icon: string }[] = [
  { value: 'building', label: 'Building', icon: '🏠' },
  { value: 'covered-porch', label: 'Covered porch/roof', icon: '⛺' },
  { value: 'gazebo', label: 'Gazebo / carport / open picnic shelter', icon: '🏛️' },
  { value: 'shade-sail', label: 'Sun tarp / shade sail', icon: '⛱️' },
  { value: 'tree', label: 'Tree', icon: '🌳' },
  { value: 'fence', label: 'Fence', icon: '🚧' },
];

/** Reused wherever an obstacle needs a plain-English label outside this
 *  file — e.g. the rain-shelter readout on the plant form. */
export const OBSTACLE_TYPE_LABEL: Record<YardObstacleType, string> = Object.fromEntries(
  TYPE_OPTIONS.map((t) => [t.value, t.label]),
) as Record<YardObstacleType, string>;

/** Types with an actual roof, whose open sides matter for the rain-shelter
 *  estimate (utils/rainShelter.ts) — only meaningful with a rect shape. */
const ROOFED_TYPES = new Set<YardObstacleType>(['building', 'covered-porch', 'gazebo']);

const EDGE_OPTIONS: { value: ObstacleEdge; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
];

const ALL_EDGES: ObstacleEdge[] = ['top', 'right', 'bottom', 'left'];

const SHAPE_OPTIONS: { value: ShapeKind; label: string; hint: string }[] = [
  { value: 'point', label: 'Just a point', hint: 'Click a spot to place it.' },
  { value: 'circle', label: 'Circle', hint: 'Click and drag out from the center to size it.' },
  { value: 'line', label: 'Line', hint: 'Click two points — start, then end.' },
  { value: 'rect', label: 'Rectangle', hint: 'Click and drag from one corner to the opposite corner.' },
  { value: 'triangle', label: 'Triangle', hint: 'Click and drag out from a corner to size it.' },
];

/** Upward-pointing triangle inscribed in the box between two drag points —
 *  apex at the top, base spanning the bottom, regardless of drag direction. */
function boundingTriangle(start: Point, current: Point): { location: Point; b: Point; c: Point } {
  const x0 = Math.min(start.x, current.x);
  const x1 = Math.max(start.x, current.x);
  const y0 = Math.min(start.y, current.y);
  const y1 = Math.max(start.y, current.y);
  return {
    location: { x: (x0 + x1) / 2, y: y0 },
    b: { x: x0, y: y1 },
    c: { x: x1, y: y1 },
  };
}

const TIER_OPTIONS: { value: ObstacleHeightTier; label: string }[] = [
  { value: 'low', label: 'Low (~fence height)' },
  { value: 'medium', label: 'Medium (~single-story roof)' },
  { value: 'tall', label: 'Tall (~tree or two-story)' },
];

const SHORT_TIER_LABEL: Record<ObstacleHeightTier, string> = {
  low: 'Low',
  medium: 'Medium',
  tall: 'Tall',
};

const ICON_BY_TYPE: Record<YardObstacleType, string> = {
  building: '🏠',
  'covered-porch': '⛺',
  gazebo: '🏛️',
  'shade-sail': '⛱️',
  tree: '🌳',
  fence: '🚧',
};

/** A starting point the user can still override before drawing. */
const SUGGESTED_SHAPE: Record<YardObstacleType, ShapeKind> = {
  building: 'rect',
  'covered-porch': 'rect',
  gazebo: 'rect',
  // Rectangular is the common case; switch to Triangle for a triangular sail.
  'shade-sail': 'rect',
  tree: 'circle',
  fence: 'line',
};

// A complete mapping (not partial) so switching types always resets the
// tier to a sensible default instead of leaking whatever tier the
// previous type happened to have selected — a building picked right
// after a shade-sail would otherwise silently stay "low."
const SUGGESTED_TIER: Record<YardObstacleType, ObstacleHeightTier> = {
  building: 'medium',
  'covered-porch': 'medium',
  gazebo: 'medium',
  // Strung overhead but usually lower than a roofline — closer to a fence
  // than a building in practice.
  'shade-sail': 'low',
  tree: 'tall',
  fence: 'low',
};

// A gazebo/open picnic shelter has no walls at all by definition; anything
// else defaults to fully enclosed until the user says otherwise.
const SUGGESTED_OPEN_EDGES: Record<YardObstacleType, ObstacleEdge[]> = {
  building: [],
  'covered-porch': [],
  gazebo: ALL_EDGES,
  'shade-sail': [],
  tree: [],
  fence: [],
};

type Draft =
  | { mode: 'idle' }
  | { mode: 'dragging'; start: Point; current: Point }
  | { mode: 'clicking'; points: Point[]; cursor: Point };

interface PendingObstacle {
  location: Point;
  shape?: ObstacleShape;
}

const OBSTACLE_STYLE = { fill: 'rgba(217, 119, 6, 0.3)', stroke: '#b45309' };
const PENDING_STYLE = { fill: 'rgba(16, 185, 129, 0.3)', stroke: '#059669' };
const DRAFT_STYLE = { fill: 'rgba(16, 185, 129, 0.18)', stroke: '#059669' };

function ShapeMark({
  location,
  shape,
  fill,
  stroke,
  dashed = false,
}: {
  location: Point;
  shape?: ObstacleShape;
  fill: string;
  stroke: string;
  dashed?: boolean;
}) {
  const dash = dashed ? '2,1.2' : undefined;
  // A white halo behind the colored stroke keeps a thin shape outline
  // visible against whatever the yard photo happens to look like underneath.
  const halo = { stroke: 'rgba(255,255,255,0.9)', strokeWidth: 2.2 };
  const main = { stroke, strokeWidth: 1.1, strokeDasharray: dash };

  if (!shape) {
    return (
      <>
        <circle cx={location.x} cy={location.y} r={1.6} fill="none" {...halo} />
        <circle cx={location.x} cy={location.y} r={1.6} fill={fill} {...main} />
      </>
    );
  }
  if (shape.kind === 'circle') {
    return (
      <>
        <circle cx={location.x} cy={location.y} r={shape.radius} fill="none" {...halo} />
        <circle cx={location.x} cy={location.y} r={shape.radius} fill={fill} {...main} />
      </>
    );
  }
  if (shape.kind === 'line') {
    const { to } = shape;
    return (
      <>
        <line x1={location.x} y1={location.y} x2={to.x} y2={to.y} strokeLinecap="round" {...halo} />
        <line x1={location.x} y1={location.y} x2={to.x} y2={to.y} strokeLinecap="round" {...main} />
      </>
    );
  }
  if (shape.kind === 'rect') {
    const x = Math.min(location.x, shape.to.x);
    const y = Math.min(location.y, shape.to.y);
    const width = Math.abs(shape.to.x - location.x);
    const height = Math.abs(shape.to.y - location.y);
    return (
      <>
        <rect x={x} y={y} width={width} height={height} fill="none" {...halo} />
        <rect x={x} y={y} width={width} height={height} fill={fill} {...main} />
      </>
    );
  }
  const points = `${location.x},${location.y} ${shape.b.x},${shape.b.y} ${shape.c.x},${shape.c.y}`;
  return (
    <>
      <polygon points={points} fill="none" {...halo} />
      <polygon points={points} fill={fill} {...main} />
    </>
  );
}

interface YardObstaclesSettingsProps {
  userId: string;
  yardImageUrl: string;
  obstacles: YardObstacle[];
  onSaved: (obstacles: YardObstacle[]) => void;
  onClose: () => void;
}

export function YardObstaclesSettings({
  userId,
  yardImageUrl,
  obstacles,
  onSaved,
  onClose,
}: YardObstaclesSettingsProps) {
  const [type, setType] = useState<YardObstacleType>('tree');
  const [shapeKind, setShapeKind] = useState<ShapeKind>(SUGGESTED_SHAPE.tree);
  const [heightTier, setHeightTier] = useState<ObstacleHeightTier>('medium');
  const [openEdges, setOpenEdges] = useState<ObstacleEdge[]>([]);
  const [draft, setDraft] = useState<Draft>({ mode: 'idle' });
  const [pending, setPending] = useState<PendingObstacle | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const changeType = (next: YardObstacleType) => {
    setType(next);
    setShapeKind(SUGGESTED_SHAPE[next]);
    setHeightTier(SUGGESTED_TIER[next]);
    setOpenEdges(SUGGESTED_OPEN_EDGES[next]);
  };

  const toggleOpenEdge = (edge: ObstacleEdge) => {
    setOpenEdges((prev) => (prev.includes(edge) ? prev.filter((e) => e !== edge) : [...prev, edge]));
  };

  const toPercent = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pending) return;
    const p = toPercent(e);
    setError('');

    if (shapeKind === 'point') {
      setPending({ location: p });
      return;
    }
    if (shapeKind === 'circle' || shapeKind === 'rect' || shapeKind === 'triangle') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft({ mode: 'dragging', start: p, current: p });
      return;
    }
    // line — accumulate two clicked points (start, then end)
    const points = draft.mode === 'clicking' ? [...draft.points, p] : [p];
    if (points.length >= 2) {
      setDraft({ mode: 'idle' });
      const [a, b] = points;
      setPending({ location: a, shape: { kind: 'line', to: b } });
    } else {
      setDraft({ mode: 'clicking', points, cursor: p });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draft.mode === 'idle') return;
    const p = toPercent(e);
    if (draft.mode === 'dragging') setDraft({ ...draft, current: p });
    else setDraft({ ...draft, cursor: p });
  };

  const handlePointerUp = () => {
    if (draft.mode !== 'dragging') return;
    const { start, current } = draft;
    setDraft({ mode: 'idle' });
    const dist = Math.hypot(current.x - start.x, current.y - start.y);
    if (dist < 1.5) {
      // Barely dragged — treat it as a quick point placement instead of a
      // near-invisible sliver of a shape.
      setPending({ location: start });
      return;
    }
    if (shapeKind === 'circle') {
      setPending({ location: start, shape: { kind: 'circle', radius: dist } });
    } else if (shapeKind === 'rect') {
      setPending({ location: start, shape: { kind: 'rect', to: current } });
    } else {
      const { location, b, c } = boundingTriangle(start, current);
      setPending({ location, shape: { kind: 'triangle', b, c } });
    }
  };

  const cancelDraft = () => {
    setDraft({ mode: 'idle' });
    setPending(null);
    setError('');
  };

  const addObstacle = async () => {
    if (!pending) return;
    setSaving(true);
    setError('');
    try {
      const created = await yardObstaclesService.create(userId, {
        type,
        location: pending.location,
        shape: pending.shape,
        heightTier,
        openEdges: ROOFED_TYPES.has(type) && pending.shape?.kind === 'rect' ? openEdges : undefined,
      });
      onSaved([...obstacles, created]);
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that obstacle');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (obstacle: YardObstacle) => {
    setRemovingId(obstacle.id);
    setError('');
    try {
      await yardObstaclesService.remove(obstacle.id);
      onSaved(obstacles.filter((o) => o.id !== obstacle.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that obstacle');
    } finally {
      setRemovingId(null);
    }
  };

  const updateHeightTier = async (obstacle: YardObstacle, heightTier: ObstacleHeightTier) => {
    if (heightTier === obstacle.heightTier) return;
    setUpdatingId(obstacle.id);
    setError('');
    try {
      const updated = await yardObstaclesService.update(obstacle.id, { heightTier });
      onSaved(obstacles.map((o) => (o.id === obstacle.id ? updated : o)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that obstacle');
    } finally {
      setUpdatingId(null);
    }
  };

  const hint = SHAPE_OPTIONS.find((s) => s.value === shapeKind)?.hint ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">Yard obstacles</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close yard obstacles"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-600">
            Mark anything that blocks the sun — the house, a covered porch, trees, fences — sized
            to its actual footprint so the sun/shade estimate can tell how wide a slice of sky it
            really covers.
          </p>

          {error && (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
              {error}
            </div>
          )}

          {!pending && (
            <div className="flex flex-wrap gap-2">
              <select
                value={type}
                onChange={(e) => changeType(e.target.value as YardObstacleType)}
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
              <select
                value={shapeKind}
                onChange={(e) => setShapeKind(e.target.value as ShapeKind)}
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                {SHAPE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}

          {!pending && <p className="text-xs text-gray-500">{hint}</p>}

          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative w-full touch-none select-none overflow-hidden rounded-lg border border-gray-200"
            style={{ cursor: pending ? 'default' : 'crosshair' }}
          >
            <img src={yardImageUrl} alt="Your yard" className="block h-auto w-full select-none" draggable={false} />
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {obstacles.map((o) => (
                <ShapeMark key={o.id} location={o.location} shape={o.shape} {...OBSTACLE_STYLE} />
              ))}
              {pending && <ShapeMark location={pending.location} shape={pending.shape} {...PENDING_STYLE} />}
              {draft.mode === 'dragging' && shapeKind === 'circle' && (
                <ShapeMark
                  location={draft.start}
                  shape={{ kind: 'circle', radius: Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y) }}
                  {...DRAFT_STYLE}
                  dashed
                />
              )}
              {draft.mode === 'dragging' && shapeKind === 'rect' && (
                <ShapeMark location={draft.start} shape={{ kind: 'rect', to: draft.current }} {...DRAFT_STYLE} dashed />
              )}
              {draft.mode === 'dragging' && shapeKind === 'triangle' && (() => {
                const { location, b, c } = boundingTriangle(draft.start, draft.current);
                return <ShapeMark location={location} shape={{ kind: 'triangle', b, c }} {...DRAFT_STYLE} dashed />;
              })()}
              {draft.mode === 'clicking' && (
                <polyline
                  points={[...draft.points, draft.cursor].map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={DRAFT_STYLE.stroke}
                  strokeWidth={0.7}
                  strokeDasharray="1.5,1"
                />
              )}
            </svg>
            {obstacles.map((o) => (
              <span
                key={o.id}
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm shadow ring-1 ring-gray-300"
                style={{ left: `${o.location.x}%`, top: `${o.location.y}%` }}
                title={`${o.label || TYPE_OPTIONS.find((t) => t.value === o.type)?.label} (${o.heightTier})`}
              >
                {ICON_BY_TYPE[o.type]}
              </span>
            ))}
            {pending && (
              <span
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-pulse items-center justify-center rounded-full bg-white text-sm shadow ring-2 ring-emerald-500"
                style={{ left: `${pending.location.x}%`, top: `${pending.location.y}%` }}
              >
                {ICON_BY_TYPE[type]}
              </span>
            )}
          </div>

          {draft.mode === 'clicking' && (
            <button
              type="button"
              onClick={cancelDraft}
              className="w-full rounded-lg border border-gray-300 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel ({draft.points.length}/2 points placed)
            </button>
          )}

          {pending && (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex gap-2">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as YardObstacleType)}
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
                <select
                  value={heightTier}
                  onChange={(e) => setHeightTier(e.target.value as ObstacleHeightTier)}
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {ROOFED_TYPES.has(type) && pending.shape?.kind === 'rect' && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-700">
                    Which sides are open (no wall)? Matters for wind-driven rain, not sun.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {EDGE_OPTIONS.map((edge) => {
                      const active = openEdges.includes(edge.value);
                      return (
                        <button
                          key={edge.value}
                          type="button"
                          onClick={() => toggleOpenEdge(edge.value)}
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                            active
                              ? 'border-emerald-500 bg-emerald-100 text-emerald-800'
                              : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {edge.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setOpenEdges(openEdges.length === 4 ? [] : ALL_EDGES)}
                      className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-500 hover:border-gray-400"
                    >
                      {openEdges.length === 4 ? 'None open (enclosed)' : 'All open (gazebo)'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelDraft}
                  className="flex-1 rounded-lg border border-gray-300 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addObstacle}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  Add
                </button>
              </div>
            </div>
          )}

          {obstacles.length > 0 && (
            <ul className="divide-y rounded-lg border border-gray-200">
              {obstacles.map((o) => (
                <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-base">{ICON_BY_TYPE[o.type]}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-700">
                    {o.label || TYPE_OPTIONS.find((t) => t.value === o.type)?.label}
                    {o.shape && <span className="text-gray-400"> · {o.shape.kind}</span>}
                    {ROOFED_TYPES.has(o.type) && o.shape?.kind === 'rect' && (
                      <span className="text-gray-400">
                        {' '}
                        · {o.openEdges?.length ? `${o.openEdges.length} side${o.openEdges.length > 1 ? 's' : ''} open` : 'enclosed'}
                      </span>
                    )}
                  </span>
                  <div className="relative shrink-0">
                    <select
                      value={o.heightTier}
                      onChange={(e) => updateHeightTier(o, e.target.value as ObstacleHeightTier)}
                      disabled={updatingId === o.id}
                      aria-label="Height"
                      className="rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 disabled:opacity-50"
                    >
                      {TIER_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>{SHORT_TIER_LABEL[t.value]}</option>
                      ))}
                    </select>
                    {updatingId === o.id && (
                      <Loader2
                        size={11}
                        className="pointer-events-none absolute -right-1 -top-1 animate-spin rounded-full bg-white text-emerald-600"
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(o)}
                    disabled={removingId === o.id}
                    aria-label="Remove obstacle"
                    className="shrink-0 p-1 text-gray-400 hover:text-red-600"
                  >
                    {removingId === o.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-green-500 py-2 text-sm font-semibold text-white hover:bg-green-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
