// src/components/PlantCareModal.tsx
// Pops up when a marker on the yard view is clicked: shows that plant's photo
// history (with upload), its care items, and now full editing of that care
// plan — title, kind, frequency, next due date, and ingredients, plus adding
// or removing items — via the shared care items store, so Due Today and the
// yard's due-badges pick up every change immediately. Repositioning the
// plant itself happens by dragging its marker on the canvas, not from here.

import { useMemo, useState } from 'react';
import { Check, Loader2, Move, Pencil, Trash2, X } from 'lucide-react';
import type { CareItem, DraftCareItem, Plant, WeatherData } from '../types';
import { useCareItems } from '../hooks/useCareItems';
import { careItemsService } from '../services/supabase/careItems';
import { plantPhotosService } from '../services/supabase/plantPhotos';
import { generateCareItems, describeFrequency } from '../services/care/generateCareItems';
import { KIND_ICONS, daysUntil, dueLabel, dueBadgeClass, ingredientSummary } from '../utils/careDisplay';
import { CareItemsEditor } from './CareItemsEditor';
import { PhotoTimeline } from './PhotoTimeline';
import { PlantPhotoCapture, type PhotoCaptureValue } from './PlantPhotoCapture';

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
  onClose: () => void;
  /** Fired after a new photo is saved, so the caller can refetch plants and
   *  pick up the new marker icon / current photo. */
  onPhotoUploaded?: () => void;
  /** Removes the plant (and, via DB cascade, its care items and photos).
   *  Rethrows on failure so the confirm button can show what went wrong
   *  instead of closing as if it had worked. */
  onDeletePlant?: (plantId: string, userId: string) => Promise<void>;
}

export function PlantCareModal({
  plant,
  userId,
  weather,
  onClose,
  onPhotoUploaded,
  onDeletePlant,
}: PlantCareModalProps) {
  const allCareItems = useCareItems((s) => s.items);
  const careLoading = useCareItems((s) => s.loading);
  const completeItem = useCareItems((s) => s.completeItem);
  const fetchCareItemsForUser = useCareItems((s) => s.fetchForUser);

  const items = useMemo(
    () => allCareItems.filter((i) => i.plantId === plant.id).sort(byDueDate),
    [allCareItems, plant.id],
  );

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

  const complete = async (item: CareItem) => {
    setCompleting(item.id);
    setCompleteError('');
    try {
      await completeItem(item);
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setCompleting(null);
    }
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
      },
      weather,
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
      setSaveCareError(err instanceof Error ? err.message : 'Could not save your care plan');
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
      });
      setPhotoRefreshKey((k) => k + 1);
      onPhotoUploaded?.();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not save that photo');
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
      setDeleteError(err instanceof Error ? err.message : 'Could not delete that plant');
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
                alt={plant.name}
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xl">
                🌱
              </span>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-gray-900">{plant.name}</h3>
              {(plant.commonName || plant.species) && (
                <p className="truncate text-xs text-gray-500">
                  {[plant.commonName, plant.species].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-500 hover:text-gray-700"
            aria-label="Close care items"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {showCapture ? (
            <PlantPhotoCapture
              onComplete={handlePhotoCaptured}
              onCancel={() => setShowCapture(false)}
            />
          ) : (
            <>
              <h4 className="mb-2 text-sm font-semibold text-gray-800">Photos</h4>

              {uploadingPhoto && (
                <p className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 size={13} className="animate-spin" /> Saving photo…
                </p>
              )}

              {photoError && (
                <div className="mb-3 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-800">
                  {photoError}
                </div>
              )}

              <PhotoTimeline
                plantId={plant.id}
                plantName={plant.name}
                onAddPhoto={() => setShowCapture(true)}
                refreshKey={photoRefreshKey}
              />

              <div className="my-4 border-t border-gray-100" />

              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-800">Care plan</h4>
                {!editing && (
                  <button
                    type="button"
                    onClick={startEditing}
                    className="flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    <Pencil size={12} /> Edit
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
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveCareChanges}
                      disabled={savingCare}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
                    >
                      {savingCare && <Loader2 size={14} className="animate-spin" />}
                      Save care plan
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
                      <Loader2 size={13} className="animate-spin" /> Loading care items…
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
                                  {dueLabel(days)}
                                </span>
                                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                                  {describeFrequency(item.frequency)}
                                </span>
                              </span>
                            </span>
                            <button
                              type="button"
                              disabled={completing === item.id}
                              onClick={() => complete(item)}
                              className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
                            >
                              {completing === item.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Check size={12} />
                              )}
                              Done
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="py-4 text-xs text-gray-500">
                      No care items for this plant yet.{' '}
                      <button type="button" onClick={startEditing} className="font-semibold text-emerald-700 underline">
                        Add one
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
            Tip: drag its marker on the yard to move {plant.name} — even out of a
            crowded spot with other plants.
          </div>

          {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}

          {onDeletePlant &&
            (confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2">
                <span className="min-w-0 flex-1 text-xs font-semibold text-red-800">
                  Delete {plant.name}? This removes its photos and care plan too — can't be undone.
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:bg-gray-400"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-red-600"
              >
                <Trash2 size={12} /> Delete plant
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
