import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { CareItem, Plant } from '../types';
import { KIND_ICONS, daysUntil, dueLabel, ingredientSummary } from '../utils/careDisplay';

type GardenCanvasProps = {
  yardImageUrl: string;
  plants: Plant[];
  /** Powers the due-badges above each marker. */
  careItems: CareItem[];
  /** Empty-spot click: starts the add-plant flow. A click near existing
   *  plant(s) instead reports them, so the caller can offer a chooser. */
  onYardClick: (x: number, y: number, existing: Plant[]) => void;
  /** Marker clicked (not dragged): open that plant's care items. */
  onSelectPlant: (plant: Plant) => void;
  /** Marker dropped after a real drag: persist its new spot. Rejecting lets
   *  the canvas know the save failed, so it can revert and say why. */
  onMovePlant: (plantId: string, x: number, y: number) => Promise<void>;
  /** Rendered as a small overlay in the top-right corner of the banner —
   *  e.g. the account menu, so it doesn't need a separate header bar. */
  accountSlot?: ReactNode;
};

type Point = { x: number; y: number };

/** Pointer must move this many px before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 6;
/**
 * Clustering thresholds below are all in REAL pixels, not container-relative
 * percent. Markers render at a fixed 44px (h-11 w-11) CSS size no matter how
 * big or small the yard photo is displayed, so a percent-of-container
 * threshold drifts with image size/aspect ratio and can group plants that
 * are actually far apart (or fail to group ones that visually overlap).
 * Measuring real pixel distance via the container's tracked size fixes that.
 */
/** Two markers cluster (fan out into a ring) once their centers are closer
 *  than this — roughly the marker's own diameter, so they'd otherwise overlap. */
const CLUSTER_TRIGGER_PX = 46;
/** A yard click within this many px of a plant counts as "on that plant". */
const SPOT_CLICK_TRIGGER_PX = 32;
/** Fan-out ring radius, in real pixels, once markers do need to spread apart. */
const CLUSTER_SPREAD_PX = 26;
/** Care badges shown per marker before the rest collapse into "+N". */
const MAX_VISIBLE_BADGES = 3;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

/** Percent-space distance — only for the "did the save round-trip land"
 *  equality check below, where the actual unit doesn't matter. */
function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type Size = { width: number; height: number };

/** Converts a percent-of-container point into real pixels for this render. */
function toPixels(point: Point, size: Size): Point {
  return { x: (point.x / 100) * size.width, y: (point.y / 100) * size.height };
}

function pixelDistance(a: Point, b: Point, size: Size) {
  const pa = toPixels(a, size);
  const pb = toPixels(b, size);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/**
 * Plants whose (effective) locations are within CLUSTER_TRIGGER_PX real
 * pixels of each other are spread into a small ring around their shared
 * spot, so every one of them stays individually visible and clickable.
 * Plants that are actually far apart on the photo — even if close as a
 * percent of the image — are left exactly where they are. A plant on its
 * own always keeps its exact location; this only changes rendering, never
 * what's saved.
 */
function fanOutPositions(
  items: { id: string; location: Point }[],
  size: Size,
): Map<string, Point> {
  // Container not measured yet (first paint, before the ResizeObserver
  // fires) — show real locations rather than clustering with a guessed scale.
  if (size.width === 0 || size.height === 0) {
    return new Map(items.map((item) => [item.id, item.location]));
  }

  const clusters: { centroid: Point; members: { id: string; location: Point }[] }[] = [];

  for (const item of items) {
    const home = clusters.find((c) => pixelDistance(c.centroid, item.location, size) <= CLUSTER_TRIGGER_PX);
    if (home) {
      home.members.push(item);
    } else {
      clusters.push({ centroid: item.location, members: [item] });
    }
  }

  const positions = new Map<string, Point>();
  for (const cluster of clusters) {
    if (cluster.members.length === 1) {
      positions.set(cluster.members[0].id, cluster.members[0].location);
      continue;
    }
    const cx = cluster.members.reduce((sum, m) => sum + m.location.x, 0) / cluster.members.length;
    const cy = cluster.members.reduce((sum, m) => sum + m.location.y, 0) / cluster.members.length;
    // Convert the pixel spread radius to per-axis percent so the ring comes
    // out as an actual circle instead of a squashed ellipse on a non-square
    // yard photo.
    const spreadXPercent = (CLUSTER_SPREAD_PX / size.width) * 100;
    const spreadYPercent = (CLUSTER_SPREAD_PX / size.height) * 100;
    cluster.members.forEach((member, index) => {
      const angle = (2 * Math.PI * index) / cluster.members.length - Math.PI / 2;
      positions.set(member.id, {
        x: clampPercent(cx + spreadXPercent * Math.cos(angle)),
        y: clampPercent(cy + spreadYPercent * Math.sin(angle)),
      });
    });
  }
  return positions;
}

/** One small due-care badge above a marker: hover on desktop, tap on touch. */
function CareBadge({ item }: { item: CareItem }) {
  const [open, setOpen] = useState(false);
  const days = daysUntil(item.nextDueDate);
  const summary = ingredientSummary(item);
  const overdue = days !== null && days < 0;

  return (
    <span className="pointer-events-auto relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((o) => !o);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-label={`${item.title} — ${dueLabel(days)}`}
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] shadow ring-1 ring-white ${
          overdue ? 'bg-red-500' : 'bg-amber-400'
        }`}
      >
        {KIND_ICONS[item.kind]}
      </button>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 w-36 -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1.5 text-[10px] leading-snug text-white shadow-lg"
        >
          <span className="block font-semibold">{item.title}</span>
          <span className="block text-gray-300">{dueLabel(days)}</span>
          {summary && <span className="block truncate text-gray-300">{summary}</span>}
        </span>
      )}
    </span>
  );
}

export function GardenCanvas({
  yardImageUrl,
  plants,
  careItems,
  onYardClick,
  onSelectPlant,
  onMovePlant,
  accountSlot,
}: GardenCanvasProps) {
  const yardRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);

  // Real rendered size of the yard container, kept current across window
  // resizes/layout changes so clustering math (below) works in real pixels
  // instead of guessing from container-relative percent.
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = yardRef.current;
    if (!el) return;
    const measure = () => setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A move is shown immediately at its dropped spot and stays there — even
  // through the save's network round-trip — instead of snapping back to the
  // old location and then jumping again once the save resolves. Cleared once
  // the store's plant.location actually catches up, or on failure.
  const [optimisticPositions, setOptimisticPositions] = useState<Map<string, Point>>(new Map());
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticPositions((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const plant of plants) {
        const opt = next.get(plant.id);
        if (opt && distance(opt, plant.location) < 0.01) {
          next.delete(plant.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [plants]);

  // Stable per-plant display position: saved location, or its still-pending
  // optimistic move. A live drag never reshuffles the plant's cluster-mates
  // mid-gesture, since neither of those changes until the drag ends.
  const visualPositions = useMemo(() => {
    const effective = plants.map((p) => ({
      id: p.id,
      location: optimisticPositions.get(p.id) ?? p.location,
    }));
    return fanOutPositions(effective, containerSize);
  }, [plants, optimisticPositions, containerSize]);

  const dueByPlant = useMemo(() => {
    const map = new Map<string, CareItem[]>();
    for (const item of careItems) {
      const days = daysUntil(item.nextDueDate);
      // No due date counts as due now, same as Due Today — an item that lost
      // its date (e.g. cleared in the editor) shouldn't silently drop off
      // the map badges while still showing up everywhere else.
      if (days !== null && days > 0) continue;
      const list = map.get(item.plantId) ?? [];
      list.push(item);
      map.set(item.plantId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (daysUntil(a.nextDueDate) ?? 0) - (daysUntil(b.nextDueDate) ?? 0));
    }
    return map;
  }, [careItems]);

  async function commitMove(plant: Plant, finalPos: Point) {
    setOptimisticPositions((prev) => new Map(prev).set(plant.id, finalPos));
    setMoveError(null);
    try {
      await onMovePlant(plant.id, finalPos.x, finalPos.y);
    } catch (err) {
      // The save failed — don't keep showing a position that was never saved.
      setOptimisticPositions((prev) => {
        const next = new Map(prev);
        next.delete(plant.id);
        return next;
      });
      setMoveError(
        `Couldn't move ${plant.name}${err instanceof Error && err.message ? ` — ${err.message}` : '.'}`,
      );
    }
  }

  function handleYardClick(event: MouseEvent<HTMLDivElement>) {
    const rectangle = event.currentTarget.getBoundingClientRect();

    const x = clampPercent(((event.clientX - rectangle.left) / rectangle.width) * 100);
    const y = clampPercent(((event.clientY - rectangle.top) / rectangle.height) * 100);
    const size: Size = { width: rectangle.width, height: rectangle.height };

    const nearby = plants.filter(
      (plant) => pixelDistance(plant.location, { x, y }, size) <= SPOT_CLICK_TRIGGER_PX,
    );
    onYardClick(x, y, nearby);
  }

  function positionFromPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = yardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
    };
  }

  function handleMarkerPointerDown(event: ReactPointerEvent<HTMLButtonElement>, plant: Plant) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    draggedRef.current = false;
    setDraggingId(plant.id);
  }

  function handleMarkerPointerMove(event: ReactPointerEvent<HTMLButtonElement>, plant: Plant) {
    if (draggingId !== plant.id || !dragStartRef.current) return;

    const dx = event.clientX - dragStartRef.current.x;
    const dy = event.clientY - dragStartRef.current.y;
    if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    draggedRef.current = true;
    const pos = positionFromPointer(event);
    if (pos) setDragPos(pos);
  }

  function handleMarkerPointerUp(event: ReactPointerEvent<HTMLButtonElement>, plant: Plant) {
    if (draggingId !== plant.id) return;

    const wasDrag = draggedRef.current;
    const finalPos = wasDrag ? positionFromPointer(event) : null;

    setDraggingId(null);
    setDragPos(null);
    dragStartRef.current = null;
    draggedRef.current = false;

    if (wasDrag && finalPos) {
      void commitMove(plant, finalPos);
    } else {
      onSelectPlant(plant);
    }
  }

  return (
    <main className="mt-16">
      {/* Garden banner. The background image + decorative text are wrapped in
          their own clipped layer so they stay confined to the banner's
          rounded box; the section itself is NOT clipped and sits in a
          raised stacking context, so accountSlot's dropdown (which is
          taller than the 100px banner) can extend below it instead of being
          cut off. */}
      <section className="relative z-30 mx-auto h-[170px] w-full max-w-[1600px]">
        <div className="absolute inset-0 overflow-hidden">
          <img
            src="/garden-banner.png"
            alt="Garden banner"
            className="block h-full w-full object-fill"
          />

          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute h-24 w-64 rounded-full bg-yellow-200/25 blur-3xl" />

            {/* The user's own gold-lettering artwork. It shipped as a flat
                mockup preview (checkerboard baked into the pixels, not a
                real alpha channel) — the transparent version was rebuilt
                from it, so a CSS drop-shadow here is what grounds it on the
                banner instead of a shadow baked into the art. */}
            <img
              src="/my-garden-title.png"
              alt="My Garden"
              className="relative h-auto w-[62%] max-w-[380px] select-none"
              style={{
                filter: 'drop-shadow(0 3px 5px rgba(40, 25, 5, 0.55)) drop-shadow(0 1px 2px rgba(40, 25, 5, 0.4))',
              }}
              draggable={false}
            />
          </div>
        </div>

        {accountSlot && (
          <div className="absolute right-3 top-3 z-20">{accountSlot}</div>
        )}
      </section>

      <section className="mx-auto mt-6 w-full max-w-5xl px-4 pb-10">
        {moveError && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            <span>{moveError}</span>
            <button
              type="button"
              onClick={() => setMoveError(null)}
              className="shrink-0 font-semibold underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div
          ref={yardRef}
          className="relative w-full cursor-crosshair overflow-hidden rounded-xl shadow-lg"
          onClick={handleYardClick}
        >
          <img
            src={yardImageUrl}
            alt="Garden yard"
            className="block h-auto w-full"
            draggable={false}
          />

          {(plants ?? []).map((plant) => {
            const isDragging = draggingId === plant.id;
            const pos = isDragging && dragPos ? dragPos : visualPositions.get(plant.id) ?? plant.location;
            // Real plant image wins (cut-out sprite first, then the raw photo);
            // the emoji is only a fallback for plants with no photo yet.
            const iconSrc = plant.spriteUrl || plant.photoUrl;
            const due = dueByPlant.get(plant.id) ?? [];
            const visibleDue = due.slice(0, MAX_VISIBLE_BADGES);
            const overflow = due.length - visibleDue.length;

            return (
              <div
                key={plant.id}
                className={`absolute -translate-x-1/2 -translate-y-1/2 ${isDragging ? 'z-20' : 'z-10'}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`${plant.name} — click for care items, drag to move`}
                    className={`flex h-11 w-11 touch-none select-none items-center justify-center rounded-full transition-transform ${
                      isDragging ? 'scale-125 cursor-grabbing' : 'cursor-grab hover:scale-125'
                    }`}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => handleMarkerPointerDown(event, plant)}
                    onPointerMove={(event) => handleMarkerPointerMove(event, plant)}
                    onPointerUp={(event) => handleMarkerPointerUp(event, plant)}
                    onPointerCancel={() => {
                      setDraggingId(null);
                      setDragPos(null);
                      dragStartRef.current = null;
                      draggedRef.current = false;
                    }}
                  >
                    {iconSrc ? (
                      <img
                        src={iconSrc}
                        alt={plant.name}
                        draggable={false}
                        className={`h-full w-full object-contain drop-shadow-md ${
                          isDragging ? 'drop-shadow-xl' : ''
                        }`}
                      />
                    ) : (
                      <span className={`text-3xl drop-shadow-md ${isDragging ? 'drop-shadow-xl' : ''}`}>
                        🌱
                      </span>
                    )}
                  </button>

                  {visibleDue.length > 0 && (
                    <div className="pointer-events-none absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-[125%] items-center gap-0.5">
                      {visibleDue.map((item) => (
                        <CareBadge key={item.id} item={item} />
                      ))}
                      {overflow > 0 && (
                        <span className="rounded-full bg-gray-700 px-1 text-[9px] font-bold text-white shadow ring-1 ring-white">
                          +{overflow}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
