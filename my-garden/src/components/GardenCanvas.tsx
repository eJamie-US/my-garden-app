import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { CareItem, Plant, YardSection } from '../types';
import { KIND_ICONS, daysUntil, dueLabel, ingredientSummary } from '../utils/careDisplay';
import { boxFromSection, sectionTransformStyle, type Box } from '../utils/sectionView';

type GardenCanvasProps = {
  yardImageUrl: string;
  plants: Plant[];
  /** Powers the due-badges above each marker. */
  careItems: CareItem[];
  /** Only badge items of these kinds — empty/omitted shows every kind. */
  kindFilter?: Set<CareItem['kind']>;
  /** Saved zoom regions of this same photo — see utils/sectionView.ts. */
  sections: YardSection[];
  /** Drag out a new one on the whole-yard view; resolves once saved. */
  onCreateSection: (box: Box, name: string) => Promise<void>;
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
  /** Rendered between the banner and the yard map — e.g. Due Today, so it
   *  reads as "banner, then your to-do list, then the yard" top to bottom. */
  belowBanner?: ReactNode;
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
/** Orbit radius for care badges around a marker, in px — half the marker's
 *  own size (h-11 w-11 = 44px), so badges sit right on the edge of the
 *  plant's png, circularly, rather than stacked in a row above it. */
const BADGE_ORBIT_RADIUS_PX = 22;
/** Badges start at 12 o'clock and go clockwise around the marker. */
const BADGE_ANGLE_START = -Math.PI / 2;

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

/** One small due-care badge above a marker: hover on desktop, tap on touch.
 *  Hover and click are tracked as separate flags (open = either one) rather
 *  than one shared toggle — a real mouse click always fires mouseenter
 *  right before the click, so a single "setOpen(o => !o)" driven by both
 *  would flip it open then immediately closed again in one interaction. */
function CareBadge({ item }: { item: CareItem }) {
  const [hovering, setHovering] = useState(false);
  const [clicked, setClicked] = useState(false);
  const open = hovering || clicked;
  const days = daysUntil(item.nextDueDate);
  const summary = ingredientSummary(item);
  const overdue = days !== null && days < 0;

  return (
    <span className="pointer-events-auto relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setClicked((c) => !c);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
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

/** The "+N" badge for care items beyond MAX_VISIBLE_BADGES — same tap/hover
 *  interaction as CareBadge (see its comment re: separate hover/click flags),
 *  but lists every remaining item at once. */
function OverflowBadge({ items }: { items: CareItem[] }) {
  const [hovering, setHovering] = useState(false);
  const [clicked, setClicked] = useState(false);
  const open = hovering || clicked;

  return (
    <span className="pointer-events-auto relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setClicked((c) => !c);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        aria-label={`${items.length} more care items due`}
        className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-[9px] font-bold text-white shadow ring-1 ring-white"
      >
        +{items.length}
      </button>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 w-36 -translate-x-1/2 space-y-1.5 rounded-md bg-gray-900 px-2 py-1.5 text-[10px] leading-snug text-white shadow-lg"
        >
          {items.map((item) => (
            <span key={item.id} className="block">
              <span className="block font-semibold">{item.title}</span>
              <span className="block text-gray-300">{dueLabel(daysUntil(item.nextDueDate))}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export function GardenCanvas({
  yardImageUrl,
  plants,
  careItems,
  kindFilter,
  sections,
  onCreateSection,
  onYardClick,
  onSelectPlant,
  onMovePlant,
  accountSlot,
  belowBanner,
}: GardenCanvasProps) {
  const yardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  // The pointerup that ends a section drag still fires a native click right
  // after it — by the time that click's handler runs, addingSection has
  // already flipped back to false (state updates from the pointerup handler
  // land before the browser dispatches the click), so checking addingSection
  // alone let that click slip through and open Add Plant. A ref updates
  // synchronously in the same handler, so it's read correctly regardless of
  // render timing.
  const suppressNextClickRef = useRef(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);

  // Which saved zoom region (if any) the view is currently zoomed into —
  // null means the whole yard. Purely a display transform; see
  // utils/sectionView.ts — nothing about how plants/obstacles are stored
  // depends on this.
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const activeSection = sections.find((s) => s.id === activeSectionId) ?? null;
  const activeBox = activeSection ? boxFromSection(activeSection) : null;

  // Drawing a brand-new section: drag a rectangle on the whole-yard view,
  // then name it. Reuses the same drag-a-rect gesture as obstacle drawing,
  // just scoped to this one mode so it can't be confused with the normal
  // "click empty spot to add a plant" / "drag a marker to move it" gestures.
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState<{ start: Point; current: Point } | null>(null);
  const [namingBox, setNamingBox] = useState<Box | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [savingSection, setSavingSection] = useState(false);

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
      if (kindFilter && kindFilter.size > 0 && !kindFilter.has(item.kind)) continue;
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
  }, [careItems, kindFilter]);

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

  /** Whole-photo percent from a raw pointer position, whatever the current
   *  zoom — contentRef is the element that actually carries the zoom
   *  transform, so its own bounding rect already reflects it; no separate
   *  remap step needed (browser geometry does that for free). */
  function toContentPercent(clientX: number, clientY: number): Point | null {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clampPercent(((clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((clientY - rect.top) / rect.height) * 100),
    };
  }

  function handleYardClick(event: MouseEvent<HTMLDivElement>) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return; // the click that follows the pointerup ending a section drag
    }
    if (addingSection) return; // drawing is handled by the pointer handlers below
    const p = toContentPercent(event.clientX, event.clientY);
    if (!p) return;
    const rect = contentRef.current!.getBoundingClientRect();
    const size: Size = { width: rect.width, height: rect.height };

    const nearby = plants.filter(
      (plant) => pixelDistance(plant.location, p, size) <= SPOT_CLICK_TRIGGER_PX,
    );
    onYardClick(p.x, p.y, nearby);
  }

  function positionFromPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    return toContentPercent(event.clientX, event.clientY);
  }

  function handleSectionDrawDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!addingSection) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = toContentPercent(event.clientX, event.clientY);
    if (p) setSectionDraft({ start: p, current: p });
  }

  function handleSectionDrawMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!addingSection || !sectionDraft) return;
    const p = toContentPercent(event.clientX, event.clientY);
    if (p) setSectionDraft({ ...sectionDraft, current: p });
  }

  function handleSectionDrawUp() {
    if (!addingSection || !sectionDraft) return;
    const { start, current } = sectionDraft;
    setSectionDraft(null);
    const dist = Math.hypot(current.x - start.x, current.y - start.y);
    if (dist < 3) return; // too small to be a real region — ignore the tap
    suppressNextClickRef.current = true;
    setNamingBox({
      x0: Math.min(start.x, current.x),
      y0: Math.min(start.y, current.y),
      x1: Math.max(start.x, current.x),
      y1: Math.max(start.y, current.y),
    });
    setAddingSection(false);
  }

  async function saveSectionName() {
    if (!namingBox) return;
    const name = sectionName.trim();
    if (!name) return;
    setSavingSection(true);
    try {
      await onCreateSection(namingBox, name);
      setNamingBox(null);
      setSectionName('');
    } finally {
      setSavingSection(false);
    }
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
    <main className="mt-4">
      {/* Garden banner. The background photo is clipped to the banner's own
          box so it can never bleed outside it; the title art sits in a
          separate, unclipped layer on top so it can spill over the top/
          bottom edges on purpose (see below). The section itself is NOT
          clipped and sits in a raised stacking context, so accountSlot's
          dropdown (which is taller than the 100px banner) can extend below
          it instead of being cut off. */}
      <section className="relative z-30 mx-auto h-[100px] w-full max-w-[1600px]">
        <div className="absolute inset-0 overflow-hidden">
          <img
            src="/garden-banner.png"
            alt="Garden banner"
            className="block h-full w-full object-cover"
          />
          {/* The title's own descenders/flourish deliberately spill past this
              clipped photo onto the plain page background below (see the
              title comment) — without this, that handoff is a hard cut from
              photo texture to flat page color. A soft fade to the exact page
              background (#f0fdf4, index.css) makes it read as an intentional
              vignette instead. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-[#f0fdf4]" />
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-end justify-center">
          <div className="absolute h-20 w-64 -translate-y-1 rounded-full bg-yellow-200/30 blur-3xl" />

          {/* The user's own gold-lettering artwork. It shipped as a flat
              mockup preview (checkerboard baked into the pixels, not a
              real alpha channel) — the transparent version was rebuilt
              from it, so a CSS drop-shadow here is what grounds it on the
              banner instead of a shadow baked into the art.

              The letters' own baseline sits well above the PNG's bottom
              edge — below it, the "y"/"G" descender loops reach down to
              about 18% of the image's height from the bottom, and a small
              leaf flourish off to the side reaches further still, to about
              6% from the bottom. Sizing and nudging by the image's outer
              box alone would put the whole word too high — this pushes it
              down by the measured baseline-to-image-bottom offset (~25% of
              the image's height) so the baseline itself lands on the
              banner's bottom edge, with the loops and that flourish
              spilling past it. The extra height beyond the 100px banner is
              what keeps the top of the lettering poking above it too.
              Smaller below the `sm` breakpoint: at that width the banner
              itself is only as wide as the screen, and the full-size title
              runs into accountSlot's chip in the corner. */}
          <img
            src="/my-garden-title.png"
            alt="My Garden"
            className="relative h-[64px] w-auto max-w-[80%] translate-y-[16px] select-none sm:h-[108px] sm:max-w-[85%] sm:translate-y-[27px]"
            style={{
              filter: 'drop-shadow(0 3px 5px rgba(40, 25, 5, 0.55)) drop-shadow(0 1px 2px rgba(40, 25, 5, 0.4))',
            }}
            draggable={false}
          />
        </div>

        {accountSlot && (
          <div className="absolute right-3 top-3 z-20">{accountSlot}</div>
        )}
      </section>

      {belowBanner}

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

        {sections.length > 0 || addingSection ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveSectionId(null)}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                !activeSectionId
                  ? 'border-emerald-500 bg-emerald-100 text-emerald-800'
                  : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              Whole yard
            </button>
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSectionId(section.id)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                  activeSectionId === section.id
                    ? 'border-emerald-500 bg-emerald-100 text-emerald-800'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                }`}
              >
                {section.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setActiveSectionId(null);
                setAddingSection((a) => !a);
              }}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                addingSection
                  ? 'border-emerald-500 bg-emerald-600 text-white'
                  : 'border-dashed border-gray-300 bg-white text-gray-500 hover:border-gray-400'
              }`}
            >
              {addingSection ? <X size={11} /> : <Plus size={11} />}
              {addingSection ? 'Drag out the new section…' : 'Add section'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingSection(true)}
            className="mb-2 flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-500 hover:border-gray-400"
          >
            <Plus size={11} /> Zoom into part of this yard
          </button>
        )}

        <div
          ref={yardRef}
          className="relative w-full cursor-crosshair overflow-hidden rounded-xl shadow-lg"
          onClick={handleYardClick}
          onPointerDown={handleSectionDrawDown}
          onPointerMove={handleSectionDrawMove}
          onPointerUp={handleSectionDrawUp}
        >
          <div ref={contentRef} className="relative" style={activeBox ? sectionTransformStyle(activeBox) : undefined}>
            <img
              src={yardImageUrl}
              alt="Garden yard"
              className="block h-auto w-full"
              draggable={false}
            />

            {sectionDraft && (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-emerald-500 bg-emerald-500/15"
                style={{
                  left: `${Math.min(sectionDraft.start.x, sectionDraft.current.x)}%`,
                  top: `${Math.min(sectionDraft.start.y, sectionDraft.current.y)}%`,
                  width: `${Math.abs(sectionDraft.current.x - sectionDraft.start.x)}%`,
                  height: `${Math.abs(sectionDraft.current.y - sectionDraft.start.y)}%`,
                }}
              />
            )}

          {(plants ?? []).map((plant) => {
            const isDragging = draggingId === plant.id;
            const pos = isDragging && dragPos ? dragPos : visualPositions.get(plant.id) ?? plant.location;
            // Real plant image wins (cut-out sprite first, then the raw photo);
            // the emoji is only a fallback for plants with no photo yet.
            const iconSrc = plant.spriteUrl || plant.photoUrl;
            const due = dueByPlant.get(plant.id) ?? [];
            const visibleDue = due.slice(0, MAX_VISIBLE_BADGES);
            const overflowDue = due.slice(MAX_VISIBLE_BADGES);
            // One slot per visible item, plus one more for "+N" if there's
            // overflow — laid out clockwise around the marker's edge below.
            const badgeSlots: ({ kind: 'item'; item: CareItem } | { kind: 'overflow'; items: CareItem[] })[] = [
              ...visibleDue.map((item) => ({ kind: 'item' as const, item })),
              ...(overflowDue.length > 0 ? [{ kind: 'overflow' as const, items: overflowDue }] : []),
            ];

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

                  {badgeSlots.map((slot, i) => {
                    const angle = BADGE_ANGLE_START + i * ((2 * Math.PI) / badgeSlots.length);
                    const dx = BADGE_ORBIT_RADIUS_PX * Math.cos(angle);
                    const dy = BADGE_ORBIT_RADIUS_PX * Math.sin(angle);
                    return (
                      <div
                        key={slot.kind === 'item' ? slot.item.id : 'overflow'}
                        className="pointer-events-none absolute left-1/2 top-1/2"
                        style={{ transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px)` }}
                      >
                        {slot.kind === 'item' ? (
                          <CareBadge item={slot.item} />
                        ) : (
                          <OverflowBadge items={slot.items} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </section>

      {namingBox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xs rounded-lg bg-white p-4 shadow-xl">
            <h3 className="mb-2 text-sm font-bold text-gray-900">Name this section</h3>
            <input
              autoFocus
              type="text"
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveSectionName()}
              placeholder="e.g. Back deck, Herb corner"
              className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setNamingBox(null);
                  setSectionName('');
                }}
                className="flex-1 rounded-lg border border-gray-300 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSectionName}
                disabled={!sectionName.trim() || savingSection}
                className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
              >
                {savingSection ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
