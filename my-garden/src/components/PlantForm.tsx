// src/components/PlantForm.tsx
// Photo capture and the care editor are folded into one submit flow:
//   photo -> identify -> cut-out sprite -> prefilled fields -> editable care plan
//   -> create plant -> upload photo + sprite -> insert care items
//
// The plant row itself is created/updated via plantsService directly (below),
// then synced into local state with upsertPlantLocal — NOT via the store's
// own addPlant/updatePlant, which would write to Supabase a second time.

import { useEffect, useMemo, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, Loader2, Sprout } from 'lucide-react';
import { usePlants } from '../hooks/usePlants';
import { useAuth } from '../hooks/useAuth';
import { PlantPhotoCapture, type PhotoCaptureValue } from './PlantPhotoCapture';
import { CareItemsEditor } from './CareItemsEditor';
import { BestPlacementPrompt } from './BestPlacementPrompt';
import { plantsService } from '../services/supabase/plants';
import { plantPhotosService } from '../services/supabase/plantPhotos';
import { careItemsService } from '../services/supabase/careItems';
import { generateCareItems } from '../services/care/generateCareItems';
import { seedPlanService, type SeedPlan } from '../services/seeds/seedPlan';
import { computeRainShelter, describeRainShelter } from '../utils/rainShelter';
import { evaluatePlacement } from '../utils/bestPlacement';
import type { Season } from '../utils/sunExposure';
import { OBSTACLE_TYPE_LABEL } from './YardObstaclesSettings';
import type { CareItem, DraftCareItem, Plant, WeatherData, Yard, YardObstacle } from '../types';

const SOW_METHOD_LABEL: Record<SeedPlan['method'], string> = {
  'direct-sow': 'Sow directly outdoors',
  'start-indoors': 'Start indoors, then transplant',
  either: 'Direct-sow or start indoors',
};

interface PlantFormProps {
  location: { x: number; y: number };
  /** Passed down from the weather panel so care generation can use it. */
  weather?: WeatherData | null;
  /** Powers the automatic rain-shelter check in place of asking — omitted
   *  or empty falls back to the manual "sheltered from rain" checkbox. */
  obstacles?: YardObstacle[];
  garden?: Yard | null;
  /** Real prevailing rain-wind direction per season, where known — powers
   *  the year-round rain half of the best-placement suggestion below. */
  seasonalRainWind?: Partial<Record<Season, number | null>> | null;
  /** When the flow started from the canvas camera button, open on the photo step. */
  startWithPhoto?: boolean;
  /** Present = edit an existing plant instead of creating one. */
  plant?: Plant | null;
  /** Existing care items, so edits patch rather than duplicate. */
  existingCareItems?: CareItem[];
  onSuccess?: () => void;
}

export const PlantForm = ({
  location,
  weather,
  obstacles = [],
  garden = null,
  seasonalRainWind,
  startWithPhoto = false,
  plant = null,
  existingCareItems,
  onSuccess,
}: PlantFormProps) => {
  const isEdit = Boolean(plant);
  const { user } = useAuth();
  const { upsertPlantLocal } = usePlants();

  // Where the plant will actually be saved — starts at the spot tapped on
  // the canvas, but can move if the best-placement suggestion below is
  // accepted. Editing an existing plant never relocates it from here.
  const [effectiveLocation, setEffectiveLocation] = useState(location);
  const [placementDismissed, setPlacementDismissed] = useState(false);

  const [showCapture, setShowCapture] = useState(startWithPhoto);
  const [capture, setCapture] = useState<PhotoCaptureValue | null>(null);
  const [careItems, setCareItems] = useState<DraftCareItem[]>(
    () => (existingCareItems ?? plant?.careItems ?? []).map((i) => ({ ...i })),
  );
  const [careMeta, setCareMeta] = useState<{ rationale: string[]; weatherUsed: boolean }>({
    rationale: [],
    weatherUsed: Boolean(weather),
  });

  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState('');

  const [showSeedPlan, setShowSeedPlan] = useState(false);
  const [seedPlan, setSeedPlan] = useState<SeedPlan | null>(null);
  const [loadingSeedPlan, setLoadingSeedPlan] = useState(false);
  const [seedPlanError, setSeedPlanError] = useState('');

  const [formData, setFormData] = useState({
    name: plant?.name ?? '',
    commonName: plant?.commonName ?? '',
    species: plant?.species ?? '',
    wateringSchedule: plant?.wateringSchedule ?? ('weekly' as 'daily' | 'weekly' | 'biweekly' | 'monthly'),
    sunRequirement: plant?.sunRequirement ?? ('partial-shade' as 'full-sun' | 'partial-shade' | 'full-shade'),
    rainCovered: plant?.rainCovered ?? false,
    mount: plant?.mount ?? ('ground' as 'ground' | 'hanging'),
    indoor: plant?.indoor ?? false,
    plantedDate: (plant?.plantedDate ?? new Date().toISOString()).split('T')[0],
    notes: plant?.notes ?? '',
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /** Maps the generated watering item back onto the plant's own schedule field. */
  const scheduleFromCare = (items: DraftCareItem[]) => {
    const water = items.find((i) => i.kind === 'water');
    if (!water) return formData.wateringSchedule;
    const { every, unit } = water.frequency;
    const days = unit === 'day' ? every : unit === 'week' ? every * 7 : every * 30;
    if (days <= 1) return 'daily' as const;
    if (days <= 7) return 'weekly' as const;
    if (days <= 14) return 'biweekly' as const;
    return 'monthly' as const;
  };

  /** Once yard obstacles are mapped, whether this plant is actually
   *  sheltered is computed from its position, mount, and the current wind
   *  instead of relying on the manual checkbox. No obstacles yet (nothing
   *  to reason from) falls back to whatever was checked by hand. */
  const effectiveRainCovered = (
    indoor: boolean,
    mount: 'ground' | 'hanging',
    manualRainCovered: boolean,
  ): boolean => {
    if (indoor) return true;
    if (obstacles.length === 0) return manualRainCovered;
    return computeRainShelter(
      { location: effectiveLocation, mount },
      obstacles,
      garden?.orientationDeg ?? 0,
      weather?.windDirection,
    ).sheltered;
  };

  const regenerateCare = (
    next: Partial<typeof formData> = {},
    keepUserItems = true,
  ) => {
    const merged = { ...formData, ...next };
    const generated = generateCareItems(
      {
        name: merged.name,
        commonName: merged.commonName,
        species: merged.species,
        sunRequirement: merged.sunRequirement,
        rainCovered: effectiveRainCovered(merged.indoor, merged.mount, merged.rainCovered),
        indoor: merged.indoor,
      },
      // Indoor plants skip weather entirely — no rain, heat, or frost to
      // adjust for, so care generation falls back to species baselines.
      merged.indoor ? undefined : weather,
    );
    const userItems = keepUserItems ? careItems.filter((i) => i.source === 'user') : [];
    const items = [...generated.items, ...userItems];
    setCareItems(items);
    setCareMeta({ rationale: generated.rationale, weatherUsed: generated.weatherUsed });
    setFormData((prev) => ({
      ...prev,
      ...next,
      wateringSchedule: scheduleFromCare(items),
    }));
  };

  /** Live "is this spot actually covered right now" readout for the form —
   *  null when there's no obstacle data to compute it from, in which case
   *  the manual checkbox below is the only source of truth. */
  const shelterResult = useMemo(() => {
    if (formData.indoor || obstacles.length === 0) return null;
    return computeRainShelter(
      { location: effectiveLocation, mount: formData.mount },
      obstacles,
      garden?.orientationDeg ?? 0,
      weather?.windDirection,
    );
  }, [formData.indoor, formData.mount, obstacles, garden, effectiveLocation, weather?.windDirection]);

  /** Is there somewhere in this yard that suits the chosen sun requirement
   *  better than the spot just tapped? Add-flow only — moving an existing
   *  plant around is a deliberate edit, not something to second-guess. */
  const placementEvaluation = useMemo(() => {
    if (isEdit || !garden) return null;
    return evaluatePlacement(effectiveLocation, formData.sunRequirement, obstacles, garden, seasonalRainWind, weather);
  }, [isEdit, garden, effectiveLocation, formData.sunRequirement, obstacles, seasonalRainWind, weather]);

  // A different sun requirement can change what counts as "better" —
  // give the suggestion another chance to show rather than staying
  // dismissed for a choice the person hasn't seen evaluated yet.
  useEffect(() => {
    setPlacementDismissed(false);
  }, [formData.sunRequirement]);

  const showPlacementPrompt = !isEdit && !placementDismissed && Boolean(placementEvaluation?.hasBetter);

  /** Seeds have nothing to photograph yet — a sowing plan from just the name,
   *  replacing the generic generated care items with seed/seedling-stage
   *  ones (user-written items are kept, same as regenerateCare). */
  const getSeedPlan = async () => {
    if (!formData.name.trim()) return;
    setLoadingSeedPlan(true);
    setSeedPlanError('');
    try {
      const plan = await seedPlanService.getSeedPlan(formData.name);
      setSeedPlan(plan);
      const userItems = careItems.filter((i) => i.source === 'user');
      const items = [...plan.careItems, ...userItems];
      setCareItems(items);
      setCareMeta({ rationale: [], weatherUsed: false });
      setFormData((prev) => ({
        ...prev,
        species: prev.species || plan.species || '',
        wateringSchedule: scheduleFromCare(items),
      }));
    } catch (err) {
      setSeedPlanError(err instanceof Error ? err.message : 'Could not get a sowing plan');
    } finally {
      setLoadingSeedPlan(false);
    }
  };

  const handleCaptureComplete = (value: PhotoCaptureValue) => {
    setCapture(value);
    setShowCapture(false);

    const chosen = value.chosen;
    const next = chosen
      ? {
          // On an edit, the user's own name for the plant wins.
          name: isEdit ? formData.name : formData.name || chosen.commonNames[0] || chosen.scientificName,
          commonName: chosen.commonNames[0] ?? '',
          species: chosen.scientificName,
        }
      : {};

    regenerateCare(next, isEdit);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!user?.id) throw new Error('User not authenticated');
      if (!formData.name.trim()) throw new Error('Plant name is required');
      if (!isEdit && !garden) throw new Error('No active yard to add this plant to');

      setProgressLabel(isEdit ? 'Saving changes…' : 'Saving plant…');
      const created = isEdit && plant
        ? await plantsService.updatePlant(plant.id, { ...formData })
        : await plantsService.createPlant({
            ...formData,
            userId: user.id,
            yardId: garden!.id,
            location: effectiveLocation,
          });

      // Photos need the plant id in their storage path, so they follow the insert.
      // Every capture is a timeline entry; addPhoto also sets it as current.
      if (capture) {
        try {
          setProgressLabel('Uploading photo…');
          await plantPhotosService.addPhoto(user.id, created.id, {
            photo: capture.photo,
            sprite: capture.spriteIsCutout ? capture.sprite : null,
            identifiedSpecies: capture.chosen?.scientificName,
            identifiedScore: capture.chosen?.score,
          });
        } catch (uploadErr) {
          // A failed upload must not lose the plant the user just added.
          console.error('Photo upload failed', uploadErr);
        }
      }

      if (careItems.length) {
        setProgressLabel('Saving care plan…');
        // replaceGenerated swaps the suggested items and leaves hand-written ones alone.
        if (isEdit) {
          await careItemsService.replaceGenerated(created.id, user.id, careItems.filter((i) => i.source === 'generated'));
          for (const item of careItems.filter((i) => i.source === 'user' && 'plantId' in i)) {
            await careItemsService.updateCareItem(item.id, item as Partial<CareItem>);
          }
          const newUserItems = careItems.filter((i) => i.source === 'user' && !('plantId' in i));
          if (newUserItems.length) await careItemsService.createMany(created.id, user.id, newUserItems);
        } else {
          await careItemsService.createMany(created.id, user.id, careItems);
        }
      }

      // The row was already created/updated above — just sync local state,
      // don't write it to Supabase again.
      upsertPlantLocal(created);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : isEdit ? 'Failed to save changes' : 'Failed to add plant');
    } finally {
      setLoading(false);
      setProgressLabel('');
    }
  };

  if (showCapture) {
    return (
      <PlantPhotoCapture
        onComplete={handleCaptureComplete}
        onCancel={() => setShowCapture(false)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="rounded border border-red-400 bg-red-100 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {showPlacementPrompt && placementEvaluation && garden && (
        <BestPlacementPrompt
          yardImageUrl={garden.imageUrl}
          sunRequirement={formData.sunRequirement}
          evaluation={placementEvaluation}
          onUseSpot={(spot) => {
            setEffectiveLocation({ x: spot.x, y: spot.y });
            setPlacementDismissed(true);
          }}
          onDismiss={() => setPlacementDismissed(true)}
        />
      )}

      {capture ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
          <img
            src={capture.spritePreviewUrl}
            alt="Plant marker"
            className="h-14 w-14 rounded object-contain"
            style={{
              background:
                'repeating-conic-gradient(#f3f4f6 0% 25%, #ffffff 0% 50%) 50%/10px 10px',
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-emerald-900">
              {capture.spriteIsCutout ? 'Marker cut out' : 'Using the full photo'}
            </p>
            {capture.chosen && (
              <p className="truncate text-xs italic text-emerald-700">
                {capture.chosen.scientificName} ·{' '}
                {Math.round(capture.chosen.score * 100)}%
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowCapture(true)}
            className="shrink-0 text-xs font-semibold text-emerald-700 underline"
          >
            Redo
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCapture(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50 py-2.5 text-sm font-semibold text-emerald-800 hover:border-emerald-500 hover:bg-emerald-100"
        >
          <Camera size={16} /> {isEdit ? 'Re-identify with a new photo' : 'Identify with a photo'}
        </button>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Plant Name *
        </label>
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleInputChange}
          placeholder="e.g., Tomato Plant"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
          required
        />
      </div>

      {!isEdit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50">
          <button
            type="button"
            onClick={() => setShowSeedPlan((s) => !s)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-amber-800"
          >
            <span className="flex items-center gap-1.5">
              <Sprout size={14} /> Starting from seed instead? Get a sowing plan
            </span>
            {showSeedPlan ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showSeedPlan && (
            <div className="space-y-2 border-t border-amber-200 px-3 py-2.5">
              <button
                type="button"
                onClick={getSeedPlan}
                disabled={!formData.name.trim() || loadingSeedPlan}
                className="flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:bg-gray-400"
              >
                {loadingSeedPlan && <Loader2 size={12} className="animate-spin" />}
                Get sowing plan for "{formData.name.trim() || '…'}"
              </button>

              {seedPlanError && <p className="text-xs text-red-600">{seedPlanError}</p>}

              {seedPlan && (
                <div className="space-y-1.5 rounded-md border border-amber-300 bg-white p-2.5 text-xs text-gray-700">
                  {seedPlan.source === 'fallback' && (
                    <p className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-500">
                      General planting guide — upgrade to Premium for an AI-tailored plan.
                    </p>
                  )}
                  <p className="font-semibold text-gray-900">{SOW_METHOD_LABEL[seedPlan.method]}</p>
                  <p>
                    Sow ~{seedPlan.sowDepthMm}mm deep, {seedPlan.spacingCm}cm apart · germinates in{' '}
                    {seedPlan.germinationDays[0]}–{seedPlan.germinationDays[1]} days
                  </p>
                  {seedPlan.startIndoorsWeeksBeforeLastFrost != null && (
                    <p>Start indoors {seedPlan.startIndoorsWeeksBeforeLastFrost} weeks before your last frost.</p>
                  )}
                  {seedPlan.daysToHarvestOrBloom != null && (
                    <p>~{seedPlan.daysToHarvestOrBloom} days to harvest/bloom from sowing.</p>
                  )}
                  {seedPlan.soilTempC && (
                    <p>Soil temperature {seedPlan.soilTempC[0]}–{seedPlan.soilTempC[1]}°C.</p>
                  )}
                  <ol className="list-decimal space-y-0.5 pl-4">
                    {seedPlan.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  {seedPlan.notes && <p className="italic text-gray-500">{seedPlan.notes}</p>}
                  <p className="text-[11px] text-emerald-700">
                    Its seed-stage care items were added to the care plan below.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Species</label>
        <input
          type="text"
          name="species"
          value={formData.species}
          onChange={handleInputChange}
          onBlur={(e) => e.target.value && regenerateCare({ species: e.target.value })}
          placeholder="e.g., Solanum lycopersicum"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Watering Schedule
        </label>
        <select
          name="wateringSchedule"
          value={formData.wateringSchedule}
          onChange={handleInputChange}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Bi-Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Sunlight</label>
        <select
          name="sunRequirement"
          value={formData.sunRequirement}
          onChange={(e) => {
            handleInputChange(e);
            regenerateCare({
              sunRequirement: e.target.value as typeof formData.sunRequirement,
            });
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
        >
          <option value="full-sun">Full sun</option>
          <option value="partial-shade">Partial shade</option>
          <option value="full-shade">Full shade</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={formData.indoor}
          onChange={(e) => {
            const indoor = e.target.checked;
            // Indoors implies covered — no rain reaches it either way.
            setFormData((prev) => ({ ...prev, indoor, rainCovered: indoor || prev.rainCovered }));
            regenerateCare({ indoor, rainCovered: indoor || formData.rainCovered });
          }}
          className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
        />
        Indoor plant (weather doesn't apply)
      </label>

      {!formData.indoor && obstacles.length > 0 && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          <div className="flex gap-1.5">
            {(['ground', 'hanging'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setFormData((prev) => ({ ...prev, mount: m }));
                  regenerateCare({ mount: m });
                }}
                className={`flex-1 rounded-md py-1 text-xs font-semibold transition ${
                  formData.mount === m
                    ? 'bg-emerald-600 text-white'
                    : 'border border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                }`}
              >
                {m === 'ground' ? 'Planted / potted' : 'Hanging'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600">
            {shelterResult
              ? describeRainShelter(
                  shelterResult,
                  shelterResult.obstacle
                    ? OBSTACLE_TYPE_LABEL[shelterResult.obstacle.type]
                    : '',
                )
              : 'No rain-shelter estimate yet.'}
            {' '}Detected automatically from your yard obstacles — no need to check a box.
          </p>
        </div>
      )}

      {!formData.indoor && obstacles.length === 0 && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={formData.rainCovered}
            onChange={(e) => {
              setFormData((prev) => ({ ...prev, rainCovered: e.target.checked }));
              regenerateCare({ rainCovered: e.target.checked });
            }}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
          />
          Sheltered from rain (eave, patio roof)
        </label>
      )}

      {careItems.length > 0 ? (
        <CareItemsEditor
          items={careItems}
          onChange={setCareItems}
          rationale={careMeta.rationale}
          weatherUsed={careMeta.weatherUsed}
          onRegenerate={() => regenerateCare()}
        />
      ) : (
        <button
          type="button"
          onClick={() => regenerateCare()}
          className="w-full rounded-lg border border-gray-300 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          Suggest a care plan
        </button>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-600 disabled:bg-gray-400"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {loading
          ? progressLabel || 'Saving…'
          : isEdit
            ? `Save ${formData.name || 'changes'}`
            : 'Add Plant'}
      </button>
    </form>
  );
};
