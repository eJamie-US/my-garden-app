// src/components/PlantCareModal.tsx
// Pops up when a marker on the yard view is clicked: shows that plant's photo
// history (with upload), its care items, and now full editing of that care
// plan — title, kind, frequency, next due date, and ingredients, plus adding
// or removing items — via the shared care items store, so Due Today and the
// yard's due-badges pick up every change immediately. Repositioning the
// plant itself happens by dragging its marker on the canvas, not from here.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Check, Home, Loader2, Move, Pencil, Plus, Sun, Trash2, Umbrella, X } from 'lucide-react';
import type { CareItem, DraftCareItem, Plant, WeatherData, Yard, YardObstacle } from '../types';
import { useCareItems } from '../hooks/useCareItems';
import { useToast } from '../hooks/useToast';
import { usePlants } from '../hooks/usePlants';
import { careItemsService } from '../services/supabase/careItems';
import { plantPhotosService } from '../services/supabase/plantPhotos';
import { generateCareItems, describeFrequency } from '../services/care/generateCareItems';
import { KIND_ICONS, daysUntil, dueLabel, dueBadgeClass, ingredientSummary, plantDisplayName } from '../utils/careDisplay';
import { estimateSeasonalExposure, summarizeExposure, type Season } from '../utils/sunExposure';
import { computeRainShelter, describeRainShelter } from '../utils/rainShelter';
import { obstacleTypeLabel } from '../utils/obstacleTypes';
import { evaluatePlacement, type SeasonalClimateBySeason } from '../utils/bestPlacement';
import { CareItemsEditor } from './CareItemsEditor';
import { BestPlacementPrompt } from './BestPlacementPrompt';
import { PlantDiagnosisPanel } from './PlantDiagnosisPanel';
import { PlantTipsPanel } from './PlantTipsPanel';
import { PhotoTimeline } from './PhotoTimeline';
import { PlantCareHistory } from './PlantCareHistory';
import { CompleteWithDateMenu } from './CompleteWithDateMenu';
import { PlantPhotoCapture, type PhotoCaptureValue } from './PlantPhotoCapture';

function sunLabel(t: TFunction, req: NonNullable<Plant['sunRequirement']>): string {
  const key = { 'full-sun': 'sunFull', 'partial-shade': 'sunPartial', 'full-shade': 'sunShade' }[req];
  return t(`plantCareModal.${key}`);
}

function seasonLabel(t: TFunction, season: Season): string {
  const key = { spring: 'seasonSpring', summer: 'seasonSummer', fall: 'seasonFall', winter: 'seasonWinter' }[season];
  return t(`plantCareModal.${key}`);
}

function byDueDate(a: CareItem, b: CareItem) {
  const da = daysUntil(a.nextDueDate);
  const db = daysUntil(b.nextDueDate);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db;
}

interface PlantCareModalProps {
  plant: Plant;
  /** Needed to attribute uploaded photos and satisfy their RLS policy. */
  userId: string;
  /** Powers "regenerate from weather" while editing the care plan. */
  weather?: WeatherData | null;
  /** Powers the sun/shade exposure estimate — omitted (or no garden set) hides that section. */
  garden?: Yard | null;
  obstacles?: YardObstacle[];
  /** Real seasonal rain-wind direction/wind-speed climatology, where known
   *  — powers the year-round rain/wind half of the best-placement
   *  suggestion below. */
  seasonalClimate?: SeasonalClimateBySeason | null;
  onClose: () => void;
  /** Fired after a new photo is saved, so the caller can refetch plants and
   *  pick up the new marker icon / current photo. */
  onPhotoUploaded?: () => void;
  /** Removes the plant (and, via DB cascade, its care items and photos).
   *  Rethrows on failure so the confirm button can show what went wrong
   *  instead of closing as if it had worked. */
  onDeletePlant?: (plantId: string, userId: string) => Promise<void>;
  /** Opens the full edit form (name, species, sun/rain exposure, watering
   *  schedule, notes) — everything about the plant except its care items,
   *  which stay editable right here. */
  onEditDetails?: (plant: Plant) => void;
  /** Relocates the plant — powers "Use this spot" on the best-placement
   *  suggestion below. Omitted hides that suggestion entirely, since
   *  there'd be no way to act on it. */
  onMovePlant?: (plantId: string, x: number, y: number) => Promise<void>;
}

export function PlantCareModal({
  plant,
  userId,
  weather,
  garden,
  obstacles = [],
  seasonalClimate,
  onClose,
  onPhotoUploaded,
  onDeletePlant,
  onEditDetails,
  onMovePlant,
}: PlantCareModalProps) {
  const { t } = useTranslation();
  const displayName = plantDisplayName(t, plant);
  const allCareItems = useCareItems((s) => s.items);
  const careLoading = useCareItems((s) => s.loading);
  const completeItem = useCareItems((s) => s.completeItem);
  const undoLastCompletion = useCareItems((s) => s.undoLastCompletion);
  const fetchCareItemsForUser = useCareItems((s) => s.fetchForUser);
  const showToast = useToast((s) => s.show);

  const items = useMemo(
    () => allCareItems.filter((i) => i.plantId === plant.id).sort(byDueDate),
    [allCareItems, plant.id],
  );

  // Indoor plants and anyone without a garden location set (no lat/lon to
  // compute a real sun path from) skip this entirely — no estimate is
  // better than a wrong one.
  const exposure = useMemo(() => {
    if (plant.indoor || !garden || garden.latitude == null || garden.longitude == null) return null;
    const bySeason = estimateSeasonalExposure(
      plant.location,
      obstacles,
      garden.latitude,
      garden.longitude,
      garden.orientationDeg,
    );
    return { bySeason, summary: summarizeExposure(plant.sunRequirement, bySeason) };
  }, [plant.indoor, plant.location, plant.sunRequirement, garden, obstacles]);

  // Once obstacles are mapped, whether this plant is actually rained on
  // right now is computed instead of trusting a static checkbox — falls
  // back to plant.rainCovered when there's no obstacle data to reason from.
  const shelter = useMemo(() => {
    if (plant.indoor || obstacles.length === 0) return null;
    return computeRainShelter(plant, obstacles, garden?.orientationDeg ?? 0, weather?.windDirection);
  }, [plant, obstacles, garden, weather?.windDirection]);
  const effectiveRainCovered = shelter ? shelter.sheltered : plant.rainCovered;

  // Is there somewhere in this yard that suits this plant's sun needs
  // better than where it already is? Same scoring as the Add-Plant flow,
  // just checked against its current spot instead of a freshly-tapped one.
  const placementEvaluation = useMemo(() => {
    if (plant.indoor || !garden) return null;
    return evaluatePlacement(
      plant.location,
      { sunRequirement: plant.sunRequirement, rainPreference: plant.rainPreference, windTolerance: plant.windTolerance },
      obstacles,
      garden,
      seasonalClimate,
      weather,
    );
  }, [
    plant.indoor, plant.location, plant.sunRequirement, plant.rainPreference, plant.windTolerance,
    obstacles, garden, seasonalClimate, weather,
  ]);

  const [placementDismissed, setPlacementDismissed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState('');

  const useSuggestedSpot = async (spot: { x: number; y: number }) => {
    if (!onMovePlant) return;
    setMoving(true);
    setMoveError('');
    try {
      await onMovePlant(plant.id, spot.x, spot.y);
      onClose();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : t('plantCareModal.couldNotMove'));
      setMoving(false);
    }
  };

  // Ongoing problems noted by hand (e.g. "spider mites, partially treated")
  // that a single photo might not show clearly enough on its own — passed
  // as context into the health check below. Plant.knownIssues itself
  // updates reactively once saved: App.tsx keeps this modal's `plant` prop
  // in sync with the shared plants store.
  const { updatePlant } = usePlants();
  const [newIssueText, setNewIssueText] = useState('');
  const [savingIssue, setSavingIssue] = useState(false);
  const [issueError, setIssueError] = useState('');

  // Set right after a newly-noted issue saves, so the health check below
  // runs immediately against the plant's existing photo instead of sitting
  // as an inert label until someone thinks to check it separately.
  const [autoCheckPhoto, setAutoCheckPhoto] = useState<Blob | undefined>(undefined);

  const addKnownIssue = async () => {
    const label = newIssueText.trim();
    if (!label) return;
    setSavingIssue(true);
    setIssueError('');
    try {
      const next = [
        ...(plant.knownIssues ?? []),
        { id: `issue-${Date.now().toString(36)}`, label, notedAt: new Date().toISOString() },
      ];
      await updatePlant(plant.id, { knownIssues: next });
      setNewIssueText('');
      if (plant.photoUrl) {
        try {
          const res = await fetch(plant.photoUrl);
          setAutoCheckPhoto(await res.blob());
        } catch {
          // No existing photo reachable — the label itself still saved fine,
          // just leave the health check in its normal self-serve state.
        }
      }
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : t('plantCareModal.couldNotSave'));
    } finally {
      setSavingIssue(false);
    }
  };

  const removeKnownIssue = async (id: string) => {
    setIssueError('');
    try {
      await updatePlant(plant.id, { knownIssues: (plant.knownIssues ?? []).filter((i) => i.id !== id) });
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : t('plantCareModal.couldNotRemove'));
    }
  };

  const [completing, setCompleting] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState('');

  const [editing, setEditing] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftCareItem[]>([]);
  const [savingCare, setSavingCare] = useState(false);
  const [saveCareError, setSaveCareError] = useState('');

  const [showCapture, setShowCapture] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const [photoError, setPhotoError] = useState('');

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [careHistoryRefreshKey, setCareHistoryRefreshKey] = useState(0);

  const complete = async (item: CareItem, when?: Date) => {
    setCompleting(item.id);
    setCompleteError('');
    try {
      await completeItem(item, when);
      setCareHistoryRefreshKey((k) => k + 1);
      showToast({
        message: t('dueToday.completedToast', { title: item.title }),
        actionLabel: t('common.undo'),
        onAction: () => {
          undoLastCompletion(item.id)
            .then(() => setCareHistoryRefreshKey((k) => k + 1))
            .catch((err) => setCompleteError(err instanceof Error ? err.message : t('plantCareModal.couldNotSave')));
        },
      });
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : t('plantCareModal.couldNotSave'));
    } finally {
      setCompleting(null);
    }
  };

  const handleUndoFromHistory = async (careItemId: string) => {
    await undoLastCompletion(careItemId);
    setCareHistoryRefreshKey((k) => k + 1);
  };

  const startEditing = () => {
    setSaveCareError('');
    setDraftItems(items.map((i) => ({ ...i })));
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraftItems([]);
    setSaveCareError('');
  };

  const regenerateDraft = () => {
    const generated = generateCareItems(
      {
        name: plant.name,
        commonName: plant.commonName,
        species: plant.species,
        sunRequirement: plant.sunRequirement,
        rainCovered: effectiveRainCovered,
        indoor: plant.indoor,
      },
      plant.indoor ? undefined : weather,
    );
    const userItems = draftItems.filter((i) => i.source === 'user');
    setDraftItems([...generated.items, ...userItems]);
  };

  const saveCareChanges = async () => {
    setSavingCare(true);
    setSaveCareError('');
    try {
      // Generated items are simplest to replace wholesale — mirrors how the
      // initial add-plant flow handles an edit.
      const generated = draftItems.filter((i) => i.source === 'generated');
      await careItemsService.replaceGenerated(plant.id, userId, generated);

      // User items: ones that already have a plantId are persisted edits;
      // ones that don't are brand new.
      const userItems = draftItems.filter((i) => i.source === 'user');
      for (const item of userItems.filter((i): i is CareItem => 'plantId' in i)) {
        await careItemsService.updateCareItem(item.id, item as Partial<CareItem>);
      }
      const newUserItems = userItems.filter((i) => !('plantId' in i));
      if (newUserItems.length) await careItemsService.createMany(plant.id, userId, newUserItems);

      // Anything that was in the original persisted list but got removed
      // from the draft was deleted by the user.
      const draftIds = new Set(draftItems.map((i) => i.id));
      const deleted = items.filter((i) => i.source === 'user' && !draftIds.has(i.id));
      for (const item of deleted) await careItemsService.deleteCareItem(item.id);

      await fetchCareItemsForUser(userId);
      setEditing(false);
      setDraftItems([]);
    } catch (err) {
      setSaveCareError(err instanceof Error ? err.message : t('plantCareModal.couldNotSaveCarePlan'));
    } finally {
      setSavingCare(false);
    }
  };

  const handlePhotoCaptured = async (value: PhotoCaptureValue) => {
    setShowCapture(false);
    setUploadingPhoto(true);
    setPhotoError('');
    try {
      await plantPhotosService.addPhoto(userId, plant.id, {
        photo: value.photo,
        sprite: value.spriteIsCutout ? value.sprite : null,
        identifiedSpecies: value.chosen?.scientificName,
        identifiedScore: value.chosen?.score,
        takenAt: value.takenAt?.toISOString(),
      });
      // Not a failed upload — the photo saved fine — but the marker will
      // show the plain photo instead of a cut-out silhouette, and without
      // this the person has no way to know why (see PlantPhotoCapture's
      // cutoutWarning comment: that in-flow warning never gets a chance to
      // render, so this is the only place it's actually seen).
      if (!value.spriteIsCutout && value.spriteWarning) setPhotoError(value.spriteWarning);
      setPhotoRefreshKey((k) => k + 1);
      onPhotoUploaded?.();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : t('plantCareModal.couldNotSavePhoto'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDelete = async () => {
    if (!onDeletePlant) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDeletePlant(plant.id, plant.userId);
      onClose();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('plantCareModal.couldNotDeletePlant'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 items-center gap-3">
            {plant.photoUrl ? (
              <img
                src={plant.photoUrl}
                alt={displayName}
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xl">
                🌱
              </span>
            )}
            <div className="min-w-0">
              {!plant.name.trim() && onEditDetails ? (
                <button
                  type="button"
                  onClick={() => onEditDetails(plant)}
                  className="flex items-center gap-1 truncate text-lg font-bold text-emerald-700 hover:text-emerald-800 hover:underline"
                >
                  <Pencil size={14} className="shrink-0" /> {t('plantCareModal.addAName')}
                </button>
              ) : (
                <h3 className="truncate text-lg font-bold text-gray-900">{displayName}</h3>
              )}
              {(plant.commonName || plant.species) && (
                <p className="truncate text-xs text-gray-500">
                  {[plant.commonName, plant.species].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="flex items-center gap-1 text-[11px] text-gray-400">
                {plant.indoor ? (
                  <>
                    <Home size={11} className="shrink-0" /> {t('plantCareModal.indoor')}
                  </>
                ) : (
                  <>
                    <Sun size={11} className="shrink-0" />
                    {sunLabel(t, plant.sunRequirement ?? 'partial-shade')}
                    {effectiveRainCovered && (
                      <span
                        className="flex items-center gap-1"
                        title={
                          shelter
                            ? describeRainShelter(
                                t,
                                shelter,
                                shelter.obstacle ? obstacleTypeLabel(t, shelter.obstacle.type) : '',
                              )
                            : undefined
                        }
                      >
                        <span aria-hidden>·</span>
                        <Umbrella size={11} className="shrink-0" />
                        {t('plantCareModal.covered')}
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {onEditDetails && (
              <button
                type="button"
                onClick={() => onEditDetails(plant)}
                className="text-gray-400 hover:text-emerald-600"
                aria-label={t('plantCareModal.editPlantDetails')}
                title={t('plantCareModal.editPlantDetails')}
              >
                <Pencil size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
              aria-label={t('plantCareModal.closeCareItems')}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {showCapture ? (
            <PlantPhotoCapture
              onComplete={handlePhotoCaptured}
              onCancel={() => setShowCapture(false)}
            />
          ) : (
            <>
              <h4 className="mb-2 text-sm font-semibold text-gray-800">{t('plantCareModal.photos')}</h4>

              {uploadingPhoto && (
                <p className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 size={13} className="animate-spin" /> {t('plantCareModal.savingPhoto')}
                </p>
              )}

              {photoError && (
                <div className="mb-3 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-800">
                  {photoError}
                </div>
              )}

              <PhotoTimeline
                plantId={plant.id}
                plantName={displayName}
                currentPhotoUrl={plant.photoUrl}
                onAddPhoto={() => setShowCapture(true)}
                onPlantUpdated={onPhotoUploaded}
                refreshKey={photoRefreshKey}
              />

              <div className="my-4 border-t border-gray-100" />
              <h4 className="mb-2 text-sm font-semibold text-gray-800">{t('plantCareModal.history')}</h4>
              <PlantCareHistory
                plantId={plant.id}
                refreshKey={careHistoryRefreshKey}
                onUndo={handleUndoFromHistory}
              />

              {exposure && (
                <>
                  <div className="my-4 border-t border-gray-100" />
                  <h4 className="mb-2 text-sm font-semibold text-gray-800">{t('plantCareModal.sunCheck')}</h4>
                  <div className="flex gap-1.5">
                    {exposure.bySeason.map((s) => (
                      <span
                        key={s.season}
                        className={`flex-1 rounded-md px-1.5 py-1 text-center text-[10px] font-semibold ${
                          s.sunny ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {seasonLabel(t, s.season)}
                        <span className="mt-0.5 block">{s.sunny ? t('plantCareModal.sun') : t('plantCareModal.shade')}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-600">{exposure.summary}</p>
                  {obstacles.length === 0 && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      {t('plantCareModal.noObstaclesMarked')}
                    </p>
                  )}

                  {onMovePlant && placementEvaluation?.hasBetter && !placementDismissed && garden && (
                    <div className="mt-2">
                      {moveError && (
                        <p className="mb-1.5 text-xs text-red-600">{moveError}</p>
                      )}
                      <fieldset disabled={moving} className="disabled:opacity-60">
                        <BestPlacementPrompt
                          yardImageUrl={garden.imageUrl}
                          evaluation={placementEvaluation}
                          onUseSpot={useSuggestedSpot}
                          onDismiss={() => setPlacementDismissed(true)}
                        />
                      </fieldset>
                    </div>
                  )}
                </>
              )}

              <div className="my-4 border-t border-gray-100" />
              <h4 className="mb-2 text-sm font-semibold text-gray-800">{t('plantCareModal.healthCheck')}</h4>

              {issueError && <p className="mb-1.5 text-xs text-red-600">{issueError}</p>}

              {plant.knownIssues && plant.knownIssues.length > 0 && (
                <ul className="mb-1.5 space-y-1">
                  {plant.knownIssues.map((issue) => (
                    <li
                      key={issue.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800"
                    >
                      <span className="min-w-0 flex-1 truncate">{issue.label}</span>
                      <button
                        type="button"
                        onClick={() => removeKnownIssue(issue.id)}
                        className="shrink-0 text-amber-500 hover:text-amber-700"
                        aria-label={t('plantCareModal.removeKnownIssue', { label: issue.label })}
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addKnownIssue();
                }}
                className="mb-2 flex gap-1.5"
              >
                <input
                  type="text"
                  value={newIssueText}
                  onChange={(e) => setNewIssueText(e.target.value)}
                  placeholder={t('plantCareModal.knownIssuePlaceholder')}
                  disabled={savingIssue}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-transparent focus:ring-2 focus:ring-green-500 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={savingIssue || !newIssueText.trim()}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-gray-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300"
                >
                  {savingIssue ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  {t('plantCareModal.add')}
                </button>
              </form>

              <PlantDiagnosisPanel
                photo={autoCheckPhoto}
                knownIssues={plant.knownIssues?.map((i) => i.label)}
                allowManualPhoto
              />

              <div className="my-4 border-t border-gray-100" />
              <h4 className="mb-2 text-sm font-semibold text-gray-800">{t('plantCareModal.plantTips')}</h4>
              <PlantTipsPanel plantName={plant.species || plant.name} />

              <div className="my-4 border-t border-gray-100" />

              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-800">{t('plantCareModal.carePlan')}</h4>
                {!editing && (
                  <button
                    type="button"
                    onClick={startEditing}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    <Pencil size={12} /> {t('plantCareModal.edit')}
                  </button>
                )}
              </div>

              {editing ? (
                <div className="space-y-2">
                  {saveCareError && (
                    <div className="rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-800">
                      {saveCareError}
                    </div>
                  )}

                  <CareItemsEditor
                    items={draftItems}
                    onChange={setDraftItems}
                    weatherUsed={Boolean(weather)}
                    onRegenerate={regenerateDraft}
                  />

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={savingCare}
                      className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {t('plantCareModal.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={saveCareChanges}
                      disabled={savingCare}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
                    >
                      {savingCare && <Loader2 size={14} className="animate-spin" />}
                      {t('plantCareModal.saveCarePlan')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {completeError && (
                    <div className="mb-3 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-800">
                      {completeError}
                    </div>
                  )}

                  {careLoading && !items.length ? (
                    <p className="flex items-center gap-2 py-4 text-xs text-gray-500">
                      <Loader2 size={13} className="animate-spin" /> {t('plantCareModal.loadingCareItems')}
                    </p>
                  ) : items.length ? (
                    <ul className="space-y-2">
                      {items.map((item) => {
                        const days = daysUntil(item.nextDueDate);
                        const summary = ingredientSummary(item);
                        return (
                          <li
                            key={item.id}
                            className="flex items-start gap-3 rounded-lg border border-gray-200 p-2.5"
                          >
                            <span className="mt-0.5 shrink-0 text-lg">{KIND_ICONS[item.kind]}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-gray-900">
                                {item.title}
                              </span>
                              {summary && (
                                <span className="block truncate text-xs text-gray-500">{summary}</span>
                              )}
                              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${dueBadgeClass(days)}`}
                                >
                                  {dueLabel(t, days)}
                                </span>
                                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                                  {describeFrequency(item.frequency)}
                                </span>
                              </span>
                            </span>
                            <CompleteWithDateMenu
                              disabled={completing === item.id}
                              onComplete={(when) => complete(item, when)}
                              wrapperClassName="shrink-0 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 has-[:disabled]:bg-gray-400"
                              mainButtonClassName="flex items-center gap-1 rounded-l-md px-2.5 py-1 text-xs font-semibold"
                            >
                              {completing === item.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Check size={12} />
                              )}
                              {t('plantCareModal.done')}
                            </CompleteWithDateMenu>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="py-4 text-xs text-gray-500">
                      {t('plantCareModal.noCareItemsYet')}{' '}
                      <button type="button" onClick={startEditing} className="font-semibold text-emerald-700 underline">
                        {t('plantCareModal.addOne')}
                      </button>
                      .
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Move size={12} />
            {t('plantCareModal.dragTip', { name: displayName })}
          </div>

          {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}

          {onDeletePlant &&
            (confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2">
                <span className="min-w-0 flex-1 text-xs font-semibold text-red-800">
                  {t('plantCareModal.deleteConfirm', { name: displayName })}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {t('plantCareModal.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:bg-gray-400"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {t('plantCareModal.delete')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-red-600"
              >
                <Trash2 size={12} /> {t('plantCareModal.deletePlant')}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
