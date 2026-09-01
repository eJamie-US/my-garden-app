// src/components/PhotoTimeline.tsx
// A plant's photos oldest-first: scrub the strip, or compare first vs selected.

import { useCallback, useEffect, useState } from 'react';
import { Camera, Columns2, Loader2, Trash2 } from 'lucide-react';
import type { PlantPhoto } from '../types';
import { plantPhotosService } from '../services/supabase/plantPhotos';

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const fullDateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** For a date input's value, which wants YYYY-MM-DD in local time. */
const dateInputValue = (iso: string) => {
  const d = new Date(iso);
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
};

interface PhotoTimelineProps {
  plantId: string;
  plantName: string;
  /** Opens the capture sheet; the parent owns the upload. */
  onAddPhoto?: () => void;
  /** Bump to force a refetch after the parent uploads one. */
  refreshKey?: number;
}

export function PhotoTimeline({
  plantId, plantName, onAddPhoto, refreshKey = 0,
}: PhotoTimelineProps) {
  const [photos, setPhotos] = useState<PlantPhoto[]>([]);
  const [selected, setSelected] = useState(0);
  const [compare, setCompare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingDate, setSavingDate] = useState(false);
  const [error, setError] = useState('');

  /** Pass a photo id to land back on it after a reload (e.g. its date moved it). */
  const load = useCallback(async (keepId?: string) => {
    setLoading(true);
    try {
      const list = await plantPhotosService.getForPlant(plantId);
      setPhotos(list);
      const keepIndex = keepId ? list.findIndex((p) => p.id === keepId) : -1;
      setSelected(keepIndex >= 0 ? keepIndex : Math.max(0, list.length - 1)); // else land on the newest
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load photos');
    } finally {
      setLoading(false);
    }
  }, [plantId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const remove = async (photo: PlantPhoto) => {
    const previous = photos;
    setPhotos((current) => current.filter((p) => p.id !== photo.id));
    setSelected((i) => Math.max(0, Math.min(i, previous.length - 2)));
    try {
      await plantPhotosService.deletePhoto(photo);
    } catch (err) {
      setPhotos(previous);
      setError(err instanceof Error ? err.message : 'Could not delete that photo');
    }
  };

  const setNote = async (photo: PlantPhoto, note: string) => {
    if (note === (photo.note ?? '')) return;
    setPhotos((current) => current.map((p) => (p.id === photo.id ? { ...p, note } : p)));
    try {
      await plantPhotosService.updatePhoto(photo.id, { note });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that note');
    }
  };

  /** Editing the date can reorder the timeline, so this reloads rather than patching in place. */
  const setDate = async (photo: PlantPhoto, dateValue: string) => {
    if (!dateValue) return;
    if (dateValue === dateInputValue(photo.takenAt)) return;

    // Keep the original time-of-day; only the calendar date changes.
    const original = new Date(photo.takenAt);
    const [year, month, day] = dateValue.split('-').map(Number);
    const next = new Date(original);
    next.setFullYear(year, month - 1, day);

    setSavingDate(true);
    setError('');
    try {
      await plantPhotosService.updatePhoto(photo.id, { takenAt: next.toISOString() });
      await load(photo.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that date');
    } finally {
      setSavingDate(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-3 text-xs text-gray-500">
        <Loader2 size={13} className="animate-spin" /> Loading photos…
      </p>
    );
  }

  if (!photos.length) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-300 p-4 text-center">
        <p className="text-xs text-gray-500">
          No photos of {plantName} yet. Add one now and it becomes the start of its progression.
        </p>
        {onAddPhoto && (
          <button
            type="button"
            onClick={onAddPhoto}
            className="mx-auto mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Camera size={13} /> Add the first photo
          </button>
        )}
      </div>
    );
  }

  const current = photos[Math.min(selected, photos.length - 1)];
  const first = photos[0];
  const span = plantPhotosService.spanInDays(photos);
  const showCompare = compare && photos.length > 1 && current.id !== first.id;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {photos.length} photo{photos.length === 1 ? '' : 's'}
          {span > 0 && ` · tracked ${span} days`}
        </p>
        <div className="flex items-center gap-2">
          {photos.length > 1 && (
            <button
              type="button"
              onClick={() => setCompare((c) => !c)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
                compare ? 'bg-emerald-600 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Columns2 size={12} /> Compare
            </button>
          )}
          {onAddPhoto && (
            <button
              type="button"
              onClick={onAddPhoto}
              className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <Camera size={12} /> Add
            </button>
          )}
        </div>
      </div>

      {showCompare ? (
        <div className="grid grid-cols-2 gap-2">
          {[first, current].map((photo, index) => (
            <figure key={photo.id} className="m-0">
              <img
                src={photo.photoUrl}
                alt={`${plantName} on ${fullDateLabel(photo.takenAt)}`}
                className="h-40 w-full rounded-lg object-cover"
              />
              <figcaption className="mt-1 text-center text-[11px] text-gray-500">
                {index === 0 ? 'First' : 'Selected'} · {dateLabel(photo.takenAt)}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <figure className="m-0">
          <img
            src={current.photoUrl}
            alt={`${plantName} on ${fullDateLabel(current.takenAt)}`}
            className="h-52 w-full rounded-lg object-cover"
          />
          <figcaption className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-700">
              {fullDateLabel(current.takenAt)}
              {current.identifiedSpecies && (
                <span className="ml-1.5 font-normal italic text-gray-500">
                  {current.identifiedSpecies}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => remove(current)}
              aria-label="Delete this photo"
              className="p-1 text-gray-400 hover:text-red-600"
            >
              <Trash2 size={13} />
            </button>
          </figcaption>
        </figure>
      )}

      <input
        type="text"
        defaultValue={current.note ?? ''}
        key={`note-${current.id}`}
        onBlur={(e) => setNote(current, e.target.value)}
        placeholder="Note for this photo — first bud, repotted, leaf spot…"
        className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 placeholder-gray-400"
      />

      <div className="flex items-center gap-2">
        <label htmlFor={`taken-at-${current.id}`} className="text-xs text-gray-500">
          Taken
        </label>
        <input
          id={`taken-at-${current.id}`}
          type="date"
          defaultValue={dateInputValue(current.takenAt)}
          key={`date-${current.id}`}
          disabled={savingDate}
          onBlur={(e) => setDate(current, e.target.value)}
          aria-label="Date this photo was taken"
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 disabled:opacity-60"
        />
        {savingDate && <Loader2 size={12} className="animate-spin text-gray-400" />}
        <span className="text-[11px] text-gray-400">Backdate an old photo to place it correctly</span>
      </div>

      {photos.length > 1 && (
        <>
          <input
            type="range"
            min={0}
            max={photos.length - 1}
            value={Math.min(selected, photos.length - 1)}
            onChange={(e) => setSelected(Number(e.target.value))}
            aria-label="Scrub the photo timeline"
            className="w-full accent-emerald-600"
          />
          <ul className="flex gap-1.5 overflow-x-auto pb-1">
            {photos.map((photo, index) => (
              <li key={photo.id} className="flex-none">
                <button
                  type="button"
                  onClick={() => setSelected(index)}
                  className={`block overflow-hidden rounded-md border-2 ${
                    index === Math.min(selected, photos.length - 1)
                      ? 'border-emerald-500'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <img
                    src={photo.spriteUrl || photo.photoUrl}
                    alt=""
                    className="h-12 w-12 object-cover"
                  />
                  <span className="block bg-white px-1 py-0.5 text-[9px] text-gray-500">
                    {dateLabel(photo.takenAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
