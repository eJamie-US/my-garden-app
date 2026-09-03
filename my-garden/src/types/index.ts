// src/types/index.ts

export interface Plant {
  id: string;
  userId: string;
  name: string;
  commonName?: string;
  species?: string;
  location: Point;
  photoUrl?: string;
  /** Cut-out PNG used as the map marker sprite. */
  spriteUrl?: string;
  plantedDate: string; // ISO 8601
  lastWatered?: string;
  notes?: string;
  wateringSchedule?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  sunRequirement?: 'full-sun' | 'partial-shade' | 'full-shade';
  /** Sheltered from rain (an eave, a patio roof) — so care generation
   *  doesn't credit it with rainfall it never gets. Implied by `indoor`.
   *  Manual fallback only — once yard obstacles are mapped, whether this
   *  plant is actually covered is computed instead (utils/rainShelter.ts). */
  rainCovered?: boolean;
  /** Lives indoors — weather (rain, heat, frost, sun-path/shade) doesn't
   *  apply at all; care generation runs on baselines only. */
  indoor?: boolean;
  /** 'hanging' sits right at a structure's roofline (a hanging basket under
   *  an eave or carport) — wind can blow rain onto it through any open
   *  side, not just the nearest one. Undefined/'ground' means planted or
   *  potted below the roofline, only exposed through a *nearby* open side.
   *  See utils/rainShelter.ts. */
  mount?: 'ground' | 'hanging';
  /** Hydrated by careItemsService.getForPlant(); not stored on the plants row. */
  careItems?: CareItem[];
  createdAt: string;
  updatedAt: string;
}

/* ---------- Yard obstacles (sun/shade exposure estimate) ---------- */

export type YardObstacleType = 'building' | 'covered-porch' | 'gazebo' | 'shade-sail' | 'tree' | 'fence';

/** One side of a rectangular obstacle's footprint, in photo space (before
 *  the yard's compass orientation is applied) — 'top' is the obstacle's
 *  own north-in-the-photo edge, and so on around. See utils/rainShelter.ts. */
export type ObstacleEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * Qualitative, not metric — the yard photo has no known real-world scale
 * (no ruler in frame), so sunExposure.ts reasons in "how far, as a percent
 * of the yard, before this stops mattering" rather than true shadow-length
 * geometry. 'low' ~ a fence (~1-1.5m), 'medium' ~ a single-story roof or
 * porch (~3m), 'tall' ~ a tree or two-story building (~6m+).
 */
export type ObstacleHeightTier = 'low' | 'medium' | 'tall';

export interface Point {
  x: number;
  y: number;
}

/**
 * How much of the sky an obstacle blocks, seen from a plant, beyond just
 * "there's something over there" (a bare point). Coordinates are in the
 * same percent-of-yard-photo units as `location` — same no-real-world-scale
 * caveat as heightTier. Undefined `shape` on a YardObstacle means "just a
 * point" (the original, pre-shape behavior): a fixed guess at how wide a
 * slice of sky it covers, rather than a measured one.
 */
export type ObstacleShape =
  | { kind: 'circle'; radius: number }
  | { kind: 'line'; to: Point }
  | { kind: 'rect'; to: Point }
  | { kind: 'triangle'; b: Point; c: Point };

export interface YardObstacle {
  id: string;
  userId: string;
  type: YardObstacleType;
  label?: string;
  /** Same percent-of-yard-photo coordinates as Plant.location. Anchor
   *  point for `shape` — circle center, line/rect start corner, triangle
   *  vertex `a`. */
  location: Point;
  /** Undefined = a plain point obstacle (legacy/quick-placed). */
  shape?: ObstacleShape;
  heightTier: ObstacleHeightTier;
  /** Which sides of a roofed, rect-shaped obstacle (building/covered-porch/
   *  gazebo) have no wall — wind can blow rain in through these. Undefined
   *  or empty means fully enclosed (a house). Meaningless for other shapes
   *  or types (a tree or fence has no roof to shelter under in the first
   *  place). A gazebo is just the case where all four are open. */
  openEdges?: ObstacleEdge[];
  createdAt: string;
  updatedAt: string;
}

/* ---------- Photo timeline ---------- */

export interface PlantPhoto {
  id: string;
  plantId: string;
  userId: string;
  photoUrl: string;
  spriteUrl?: string;
  /** When the photo was TAKEN — backdating puts old shots in the right place. */
  takenAt: string;
  note?: string;
  identifiedSpecies?: string;
  /** 0..1, as reported for this photo. */
  identifiedScore?: number;
  createdAt: string;
}

/* ---------- Care items ---------- */

export const CARE_UNITS = [
  'tsp', 'tbsp', 'cup', 'fl oz', 'ml', 'l',
  'g', 'kg', 'oz', 'lb', 'gal',
  'handful', 'scoop', 'part', 'pellet', 'spray',
] as const;
export type CareUnit = (typeof CARE_UNITS)[number];

export interface CareIngredient {
  id: string;
  name: string;
  /** Kept as a string so "1/2" and "0.5" both round-trip losslessly. */
  amount: string;
  unit: CareUnit | '';
}

export type CareFrequencyUnit = 'day' | 'week' | 'month' | 'year';

export interface CareFrequency {
  every: number;
  unit: CareFrequencyUnit;
}

export type CareItemKind =
  | 'water' | 'feed' | 'prune' | 'mulch' | 'protect' | 'inspect' | 'other';

export interface CareItem {
  id: string;
  plantId: string;
  userId: string;
  title: string;
  kind: CareItemKind;
  frequency: CareFrequency;
  ingredients: CareIngredient[];
  instructions?: string;
  nextDueDate?: string;
  lastCompletedAt?: string;
  /** 'generated' items are replaced when care is regenerated; 'user' items never are. */
  source: 'generated' | 'user';
  createdAt: string;
  updatedAt: string;
}

/** A care item that has not been persisted yet (new plant flow). */
export type DraftCareItem = Omit<
  CareItem,
  'id' | 'plantId' | 'userId' | 'createdAt' | 'updatedAt'
> & { id: string };

/* ---------- Weather ---------- */

export interface DailyWeather {
  date: string; // YYYY-MM-DD
  tempMax: number;
  tempMin: number;
  precipitation: number; // mm
  weatherCode: number;
  condition: string;
  icon: string;
}

export interface WeatherData {
  temperature: number;
  condition: string;
  icon: string;
  humidity?: number;
  windSpeed?: number;
  /** Degrees, meteorological convention — the direction wind is blowing
   *  FROM (0 = north, 90 = east, ...), matching Open-Meteo's convention.
   *  Powers the wind-driven-rain shelter estimate (utils/rainShelter.ts). */
  windDirection?: number;
  precipitation?: number;
  timestamp: string;
  /** Trailing 14 days, oldest first. */
  past: DailyWeather[];
  /** Today + next 9 days. */
  upcoming: DailyWeather[];
}

/* ---------- Plant identification ---------- */

export interface PlantIdCandidate {
  scientificName: string;
  commonNames: string[];
  family?: string;
  genus?: string;
  /** 0..1 */
  score: number;
  imageUrl?: string;
}

export type PlantIdStatus =
  | 'ok'
  | 'low-confidence'
  | 'no-match'
  | 'rejected'
  | 'unconfigured'
  | 'offline'
  | 'error';

export interface PlantIdResult {
  status: PlantIdStatus;
  candidates: PlantIdCandidate[];
  best?: PlantIdCandidate;
  message?: string;
}

/** Legacy Ollama shape — kept so old imports keep compiling. */
export interface VisionResult {
  identified: boolean;
  plantName?: string;
  commonName?: string;
  confidence?: number;
  description?: string;
  careNotes?: string;
}

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

export interface PlantEditorState {
  selectedPlantId: string | null;
  isEditing: boolean;
  formData: Partial<Plant>;
}
