// src/types/index.ts

export interface Plant {
  id: string;
  userId: string;
  name: string;
  commonName?: string;
  species?: string;
  location: { x: number; y: number };
  photoUrl?: string;
  /** Cut-out PNG used as the map marker sprite. */
  spriteUrl?: string;
  plantedDate: string; // ISO 8601
  lastWatered?: string;
  notes?: string;
  wateringSchedule?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  sunRequirement?: 'full-sun' | 'partial-shade' | 'full-shade';
  /** Sheltered from rain (an eave, a patio roof, grown indoors/greenhouse) —
   *  so care generation doesn't credit it with rainfall it never gets. */
  rainCovered?: boolean;
  /** Hydrated by careItemsService.getForPlant(); not stored on the plants row. */
  careItems?: CareItem[];
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
