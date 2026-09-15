import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Plus, X } from 'lucide-react';
import type { CareItem, Plant, YardSection } from '../types';
import { KIND_ICONS, daysUntil, dueLabel, ingredientSummary, plantDisplayName } from '../utils/careDisplay';
import { boxFromSection, sectionTransformStyle, toViewportPercent, toYardPercent, type Box } from '../utils/sectionView';

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
  /** Omit to hide the delete affordance entirely (e.g. read-only contexts).
   *  Only removes the saved zoom/crop — plants and obstacles inside it are
   *  untouched, since a section never owns them. */
  onDeleteSection?: (sectionId: string) => void;
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
 *  than this. Deliberately much smaller than the marker's own diameter (44px):
 *  this exists to keep plants added at *the same spot* (e.g. several "use
 *  this suggested spot" adds in a row) individually tappable, not to
 *  re-arrange anything a person deliberately dragged near — but for a
 *  while this was 46px (~one full marker width), so dropping a plant
 *  anywhere near an existing one silently pulled it into a shared ring
 *  well away from where it was actually dropped, which reads exactly like
 *  the drag failing and snapping back. A near-exact-overlap threshold still
 *  catches the original problem without hijacking ordinary close plantings. */
const CLUSTER_TRIGGER_PX = 18;
/** A real-pixel threshold alone isn't resolution-independent — the same two
 *  deliberately-planted-nearby spots (a few percent of the photo apart) sit
 *  comfortably far apart in pixels on a wide desktop container, but the
 *  *same* percent gap shrinks to fewer real pixels on a narrow phone screen,
 *  small enough to dip under CLUSTER_TRIGGER_PX and false-positive into a
 *  shared ring — confirmed happening for two real, intentionally-separate
 *  plants at mobile widths. Requiring the percent gap *itself* to also be
 *  tiny keeps "same spot" meaning the same thing regardless of screen size.
 *
 *  Set tight (0.5%, not the original 1.5%) on purpose: a densely-planted
 *  real yard can easily have two distinct plants 1% of the photo apart —
 *  with markers this small, letting them render at their own true positions
 *  and visually overlap/touch reads better than snapping them apart into a
 *  ring, which looks like the app moved a plant nobody touched. The ring is
 *  now reserved for genuinely-identical-spot placements (e.g. repeated "use
 *  this suggested spot" clicks), not merely-close ones. */
const CLUSTER_TRIGGER_PERCENT = 0.5;
/** A yard click within this many px of a plant counts as "on that plant". */
const SPOT_CLICK_TRIGGER_PX = 32;
/** Roughly a marker's own radius, plus a little breathing room — the basis
 *  for how far apart a fan-out ring needs to space its members (below) so
 *  their tap targets don't overlap. */
const MARKER_TOUCH_RADIUS_PX = 26;
/** Care badges shown per marker before the rest collapse into "+N". */
const MAX_VISIBLE_BADGES = 3;
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
  box: Box | null,
): Map<string, Point> {
  // Container not measured yet (first paint, before the ResizeObserver
  // fires) — show real locations rather than clustering with a guessed scale.
  if (size.width === 0 || size.height === 0) {
    return new Map(items.map((item) => [item.id, item.location]));
  }

  // Cluster in on-screen (post-zoom) percent, not raw whole-photo percent —
  // "close together" has to mean close together as actually shown right now,
  // and `size` (the container's own unzoomed pixel box) already corresponds
  // 1:1 with that 0-100% screen range regardless of which section is active.
  const screenItems = items.map((item) => ({
    id: item.id,
    location: item.location,
    screen: toViewportPercent(item.location, box),
  }));

  const clusters: { centroid: Point; locationCentroid: Point; members: typeof screenItems }[] = [];

  for (const item of screenItems) {
    // Both checks have to agree this is "the same spot": real on-screen
    // pixels (via centroid/size) catches true overlaps without the
    // aspect-ratio distortion a raw percent check alone would have, while
    // the percent check (against the original whole-photo location, not the
    // zoomed/screen-mapped one) keeps that meaning independent of how wide
    // the container currently is or how zoomed in the active section is.
    const home = clusters.find(
      (c) =>
        pixelDistance(c.centroid, item.screen, size) <= CLUSTER_TRIGGER_PX &&
        distance(c.locationCentroid, item.location) <= CLUSTER_TRIGGER_PERCENT,
    );
    if (home) {
      home.members.push(item);
    } else {
      clusters.push({ centroid: item.screen, locationCentroid: item.location, members: [item] });
    }
  }

  const positions = new Map<string, Point>();
  for (const cluster of clusters) {
    if (cluster.members.length === 1) {
      positions.set(cluster.members[0].id, cluster.members[0].location);
      continue;
    }
    const cx = cluster.members.reduce((sum, m) => sum + m.screen.x, 0) / cluster.members.length;
    const cy = cluster.members.reduce((sum, m) => sum + m.screen.y, 0) / cluster.members.length;
    // A fixed ring radius works for 2-3 members, but packs more of them
    // tightly enough that adjacent markers' tap targets actually overlap —
    // which a mis-hit drag lands on the wrong plant. The chord between two
    // adjacent members of an N-point ring of radius R is 2R·sin(π/N); solving
    // for the R that keeps that chord at least two touch-radii apart (so
    // neither marker's own footprint overlaps its neighbor's) scales the
    // ring out as more plants share a spot, instead of packing them in.
    const n = cluster.members.length;
    const spreadPx = MARKER_TOUCH_RADIUS_PX / Math.sin(Math.PI / n);
    // Convert the pixel spread radius to per-axis percent so the ring comes
    // out as an actual circle instead of a squashed ellipse on a non-square
    // yard photo.
    const spreadXPercent = (spreadPx / size.width) * 100;
    const spreadYPercent = (spreadPx / size.height) * 100;
    cluster.members.forEach((member, index) => {
      const angle = (2 * Math.PI * index) / n - Math.PI / 2;
      const screenPos = {
        x: clampPercent(cx + spreadXPercent * Math.cos(angle)),
        y: clampPercent(cy + spreadYPercent * Math.sin(angle)),
      };
      // Ring positions are computed in screen percent — convert back to
      // whole-photo percent before storing, same space as everything else
      // a plant's location is ever expressed in (including what gets saved).
      positions.set(member.id, box ? toYardPercent(screenPos, box) : screenPos);
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
  const { t } = useTranslation();
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
        aria-label={`${item.title} — ${dueLabel(t, days)}`}
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
          <span className="block text-gray-300">{dueLabel(t, days)}</span>
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
  const { t } = useTranslation();
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
        aria-label={t('gardenCanvas.moreDue', { count: items.length })}
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
              <span className="block text-gray-300">{dueLabel(t, daysUntil(item.nextDueDate))}</span>
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
  onDeleteSection,
  onYardClick,
  onSelectPlant,
  onMovePlant,
  accountSlot,
  belowBanner,
}: GardenCanvasProps) {
  const { t } = useTranslation();
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

  // Care badges ring every marker and intercept taps over their own small
  // area — fine normally, but it makes tapping precisely between two plants
  // placed close together hard. Hiding them frees that space up.
  const [showCareBadges, setShowCareBadges] = useState(false);

  // Which saved zoom region (if any) the view is currently zoomed into —
  // null means the whole yard. Purely a display transform; see
  // utils/sectionView.ts — nothing about how plants/obstacles are stored
  // depends on this.
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const activeSection = sections.find((s) => s.id === activeSectionId) ?? null;
  const activeBox = activeSection ? boxFromSection(activeSection) : null;
  const [confirmingDeleteSectionId, setConfirmingDeleteSectionId] = useState<string | null>(null);

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
    return fanOutPositions(effective, containerSize, activeBox);
  }, [plants, optimisticPositions, containerSize, activeBox]);

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
        err instanceof Error && err.message
          ? t('gardenCanvas.moveFailedReason', { name: plantDisplayName(t, plant), reason: err.message })
          : t('gardenCanvas.moveFailed', { name: plantDisplayName(t, plant) }),
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
      {/* mb-8 guarantees clearance below the section's own 100px box for
          the title's own spilling descenders (see below) — those overflow
          the section unclipped, and without this margin they'd crowd or
          visually merge into whatever renders right after (Due Today's
          card) instead of resting on the page background as intended. */}
      <section className="relative z-30 mx-auto mb-8 h-[100px] w-full max-w-[1600px]">
        <div className="absolute inset-0 overflow-hidden">
          <img
            src="/garden-banner.jpg"
            alt={t('gardenCanvas.bannerAlt')}
            className="block h-full w-full object-cover"
          />
          {/* The title's own descenders/flourish deliberately spill past this
              clipped photo onto the plain page background below (see the
              title comment) — without this, that handoff is a hard cut from
              photo texture to flat page color. A soft fade to the exact page
              background (#f4fbf4, styles.css) makes it read as an intentional
              vignette instead. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-[#f4fbf4]" />
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-end justify-center">
          {/* Two layered glows — a big soft one plus a smaller, brighter
              core right behind the letters — read as "glowing" rather
              than the single flat blur a single layer gives. */}
          <div className="absolute h-24 w-80 -translate-y-2 rounded-full bg-yellow-200/40 blur-[50px]" />
          <div className="absolute h-14 w-52 -translate-y-2 rounded-full bg-yellow-300/60 blur-3xl" />

          {/* Real text, not baked pixel art — a requirement for
              translating the rest of the app (a PNG can't be swapped
              per-locale) though the name itself always stays "My Garden"
              regardless of language, by design (kept as a brand name, the
              way Spotify/Duolingo don't translate theirs either). Great
              Vibes was already imported (unused) from an earlier,
              abandoned attempt at exactly this; background-clip:text plus a
              drop-shadow gives the gold-on-dark-photo look the previous
              3D-chrome PNG had, at a fraction of the visual weight — no
              bevel, no sparkle overlay, just a gradient and a shadow.
              Small leaf accents echo the original artwork's leaf
              flourishes without trying to recreate their full 3D detail. */}
          <div className="relative flex translate-y-[18px] items-center sm:translate-y-[30px]">
            {/* No filter/drop-shadow on these — same WebView compositing
                issue as the h1's textShadow swap below, but here a shadow
                isn't worth the risk: at this size it mostly blurred away
                the vein-line detail and gradient shading, leaving a flat
                blob rather than a leaf, which is exactly what showed up in
                the installed Android app. Each leaf also gets its own
                gradient def now instead of the two sharing one by
                cross-referencing an id defined in the other's <svg> — a
                reference some engines don't resolve reliably. */}
            <svg
              viewBox="0 0 24 24"
              className="absolute -left-3 -top-3 h-6 w-6 -rotate-[25deg] sm:-left-5 sm:-top-5 sm:h-9 sm:w-9"
            >
              <defs>
                <linearGradient id="leafGoldTopLeft" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fffbe0" />
                  <stop offset="45%" stopColor="#ffd966" />
                  <stop offset="100%" stopColor="#e0a530" />
                </linearGradient>
              </defs>
              <path
                d="M12 2C12 2 3 7 3 14.5C3 19.2 7 22 12 22C17 22 21 19.2 21 14.5C21 7 12 2 12 2Z"
                fill="url(#leafGoldTopLeft)"
              />
              <path d="M12 4.5V20" stroke="rgba(160, 115, 20, 0.45)" strokeWidth="1" />
            </svg>

            <h1
              // leading-none (line-height: 1) used to size this box so
              // tightly that the CSS `filter` below — which computes its
              // effect region from the element's own box — clipped off the
              // top of Great Vibes' tall capital swashes (the loop on "M"
              // and "G") instead of letting them spill past it the way
              // `overflow: visible` normally would. A generous line-height
              // gives the box enough headroom that the filter's region
              // comfortably contains the full glyph ink; confirmed by
              // toggling the filter on/off directly in the browser, which
              // reproduced (and fixed) the clipping independent of the
              // gradient-fill/background-clip technique below. 1.2 is the
              // smallest value that stayed clip-free in testing (1.0 clips
              // the swash tops; much above 1.2 pads visible dead space
              // between the text and Due Today below, since the box still
              // bottom-anchors at the same spot — line-height only grows it
              // upward — so a bigger value doesn't move the text, it just
              // adds empty line-box room around it).
              className="select-none whitespace-nowrap text-[44px] leading-[1.2] sm:text-[76px]"
              style={{
                fontFamily: "'Great Vibes', cursive",
                backgroundImage:
                  'linear-gradient(180deg, #fffbe0 0%, #ffe985 22%, #ffc933 48%, #fff3a0 62%, #e8a93c 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                // text-shadow instead of `filter: drop-shadow()` — the
                // latter needs to composite a shadow against a background-
                // clip:text gradient fill, which Android's WebView (the
                // engine behind the installed TWA app) doesn't render
                // reliably: confirmed live, it showed as muddy/dark instead
                // of the intended bright gold gradient. text-shadow paints
                // independently of the (transparent) text color, so it
                // isn't subject to the same compositing failure, and reads
                // the same visually for a plain drop shadow like this.
                textShadow: '0 3px 5px rgba(40, 25, 5, 0.55), 0 1px 2px rgba(40, 25, 5, 0.4)',
              }}
            >
              My Garden
            </h1>

            <svg
              viewBox="0 0 24 24"
              className="absolute -right-2 bottom-1 h-5 w-5 rotate-[20deg] sm:-right-3 sm:bottom-2 sm:h-7 sm:w-7"
            >
              <defs>
                <linearGradient id="leafGoldBottomRight" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fffbe0" />
                  <stop offset="45%" stopColor="#ffd966" />
                  <stop offset="100%" stopColor="#e0a530" />
                </linearGradient>
              </defs>
              <path
                d="M12 2C12 2 3 7 3 14.5C3 19.2 7 22 12 22C17 22 21 19.2 21 14.5C21 7 12 2 12 2Z"
                fill="url(#leafGoldBottomRight)"
              />
              <path d="M12 4.5V20" stroke="rgba(160, 115, 20, 0.45)" strokeWidth="1" />
            </svg>
          </div>
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
              {t('gardenCanvas.dismiss')}
            </button>
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
          {sections.length > 0 || addingSection ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveSectionId(null)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                  !activeSectionId
                    ? 'border-emerald-500 bg-emerald-100 text-emerald-800'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                }`}
              >
                {t('gardenCanvas.wholeYard')}
              </button>
              {sections.map((section) =>
                confirmingDeleteSectionId === section.id ? (
                  <span
                    key={section.id}
                    className="flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs"
                  >
                    <span className="text-red-700">
                      {t('gardenCanvas.deleteSectionConfirm', { name: section.name })}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteSection?.(section.id);
                        if (activeSectionId === section.id) setActiveSectionId(null);
                        setConfirmingDeleteSectionId(null);
                      }}
                      className="rounded-full bg-red-600 px-2 py-0.5 font-semibold text-white hover:bg-red-700"
                    >
                      {t('gardenCanvas.delete')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteSectionId(null)}
                      className="rounded-full border border-gray-300 bg-white px-2 py-0.5 font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      {t('gardenCanvas.cancel')}
                    </button>
                  </span>
                ) : (
                  <span
                    key={section.id}
                    className={`flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-1 text-xs font-semibold transition ${
                      activeSectionId === section.id
                        ? 'border-emerald-500 bg-emerald-100 text-emerald-800'
                        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    <button type="button" onClick={() => setActiveSectionId(section.id)}>
                      {section.name}
                    </button>
                    {onDeleteSection && (
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteSectionId(section.id)}
                        aria-label={t('gardenCanvas.deleteSectionAria', { name: section.name })}
                        className="rounded-full p-0.5 text-current opacity-50 hover:bg-black/10 hover:opacity-100"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </span>
                ),
              )}
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
                {addingSection ? t('gardenCanvas.drawingNewSection') : t('gardenCanvas.addSection')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingSection(true)}
              className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-500 hover:border-gray-400"
            >
              <Plus size={11} /> {t('gardenCanvas.zoomIntoYard')}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCareBadges((s) => !s)}
            title={
              showCareBadges
                ? t('gardenCanvas.hideCareIconsTitle')
                : t('gardenCanvas.showCareIconsTitle')
            }
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
              showCareBadges
                ? 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                : 'border-amber-400 bg-amber-100 text-amber-800'
            }`}
          >
            {showCareBadges ? <EyeOff size={11} /> : <Eye size={11} />}
            {showCareBadges ? t('gardenCanvas.hideCareIcons') : t('gardenCanvas.showCareIcons')}
          </button>
        </div>

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
              alt={t('gardenCanvas.yardAlt')}
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
          </div>

          {/* Markers deliberately live OUTSIDE contentRef's zoom transform,
              in their own unscaled sibling layer positioned via plain percent
              math (toViewportPercent) instead of riding along inside the
              transformed wrapper. They used to sit inside it (position
              zoomed "for free") with a counter-scale to cancel out the
              resulting size blow-up — nested CSS transforms like that turned
              out to render inconsistently enough across real mobile browsers
              that markers came out scattered on one (Samsung Internet) and
              invisible on another (Chrome/Android), even though desktop was
              always fine. Plain left/top percent has no such cross-browser
              risk. */}
          <div className="pointer-events-none absolute inset-0">
          {(plants ?? []).map((plant) => {
            const isDragging = draggingId === plant.id;
            const rawPos = isDragging && dragPos ? dragPos : visualPositions.get(plant.id) ?? plant.location;
            const pos = toViewportPercent(rawPos, activeBox);
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
                className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 ${isDragging ? 'z-20' : 'z-10'}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <div className="relative [--marker-r:10px] sm:[--marker-r:22px]">
                  <button
                    type="button"
                    aria-label={t('gardenCanvas.markerAria', { name: plantDisplayName(t, plant) })}
                    className={`flex h-5 w-5 touch-none select-none items-center justify-center rounded-full transition-transform sm:h-11 sm:w-11 ${
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
                        alt={plantDisplayName(t, plant)}
                        draggable={false}
                        className={`h-full w-full object-contain drop-shadow-md ${
                          isDragging ? 'drop-shadow-xl' : ''
                        }`}
                      />
                    ) : (
                      <span className={`text-sm drop-shadow-md sm:text-3xl ${isDragging ? 'drop-shadow-xl' : ''}`}>
                        🌱
                      </span>
                    )}
                  </button>

                  {showCareBadges &&
                    badgeSlots.map((slot, i) => {
                      const angle = BADGE_ANGLE_START + i * ((2 * Math.PI) / badgeSlots.length);
                      // Fixed precision, not raw floats — a value like
                      // cos(90°) stringifies to exponential notation
                      // (6.12e-17), which calc() doesn't reliably parse.
                      const dx = Math.cos(angle).toFixed(4);
                      const dy = Math.sin(angle).toFixed(4);
                      return (
                        <div
                          key={slot.kind === 'item' ? slot.item.id : 'overflow'}
                          className="pointer-events-none absolute left-1/2 top-1/2"
                          style={{
                            transform: `translate(-50%, -50%) translate(calc(var(--marker-r) * ${dx}), calc(var(--marker-r) * ${dy}))`,
                          }}
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
            <h3 className="mb-2 text-sm font-bold text-gray-900">{t('gardenCanvas.nameSection')}</h3>
            <input
              autoFocus
              type="text"
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveSectionName()}
              placeholder={t('gardenCanvas.sectionNamePlaceholder')}
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
                {t('gardenCanvas.cancel')}
              </button>
              <button
                type="button"
                onClick={saveSectionName}
                disabled={!sectionName.trim() || savingSection}
                className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
              >
                {savingSection ? t('gardenCanvas.saving') : t('gardenCanvas.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
