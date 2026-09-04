// src/components/YardsSettings.tsx
// Manage every yard on the account — switch which one is active, rename,
// replace its photo, edit its location, delete it, or add a new one. Each
// yard is a fully independent garden: its own photo, location/weather,
// plants and obstacles. (A "section" — a zoomed view *within* one yard —
// is a different, lighter thing; see utils/sectionView.ts and the chip
// row on the yard canvas/obstacle editor.)

import { useRef, useState } from 'react';
import { Check, Loader2, MapPin, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { yardsService } from '../services/supabase/yards';
import { GardenLocationSettings } from './GardenLocationSettings';
import type { Yard } from '../types';

interface YardsSettingsProps {
  userId: string;
  yards: Yard[];
  activeYardId: string | null;
  onSaved: (yards: Yard[]) => void;
  onSwitch: (yardId: string) => void;
  onClose: () => void;
}

export function YardsSettings({ userId, yards, activeYardId, onSaved, onSwitch, onClose }: YardsSettingsProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [editingLocationYard, setEditingLocationYard] = useState<Yard | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [addingName, setAddingName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const startRename = (yard: Yard) => {
    setRenamingId(yard.id);
    setNameDraft(yard.name);
  };

  const saveRename = async (yard: Yard) => {
    const name = nameDraft.trim();
    setRenamingId(null);
    if (!name || name === yard.name) return;
    setBusyId(yard.id);
    setError('');
    try {
      const updated = await yardsService.update(yard.id, { name });
      onSaved(yards.map((y) => (y.id === yard.id ? updated : y)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename that yard');
    } finally {
      setBusyId(null);
    }
  };

  const replacePhoto = async (yard: Yard, file: File | undefined) => {
    if (!file) return;
    setBusyId(yard.id);
    setError('');
    try {
      const imageUrl = await yardsService.uploadPhoto(userId, yard.id, file);
      const updated = await yardsService.update(yard.id, { imageUrl });
      onSaved(yards.map((y) => (y.id === yard.id ? updated : y)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that photo');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (yard: Yard) => {
    setBusyId(yard.id);
    setError('');
    try {
      await yardsService.remove(yard.id);
      const remaining = yards.filter((y) => y.id !== yard.id);
      onSaved(remaining);
      if (yard.id === activeYardId && remaining[0]) onSwitch(remaining[0].id);
      setConfirmingDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that yard');
    } finally {
      setBusyId(null);
    }
  };

  const addYard = async () => {
    const name = addingName.trim() || 'New Garden';
    setAdding(true);
    setError('');
    try {
      const created = await yardsService.create(userId, { name });
      onSaved([...yards, created]);
      setAddingName('');
      onSwitch(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that yard');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">Your yards</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close yards"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-600">
            Gardening in more than one place? Each yard has its own photo, location/weather,
            plants and obstacles. Switch between them any time.
          </p>

          {error && (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
              {error}
            </div>
          )}

          <ul className="space-y-2">
            {yards.map((yard) => {
              const isActive = yard.id === activeYardId;
              const isBusy = busyId === yard.id;
              return (
                <li
                  key={yard.id}
                  className={`overflow-hidden rounded-lg border ${
                    isActive ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3 p-2.5">
                    <img
                      src={yard.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-md border border-gray-200 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      {renamingId === yard.id ? (
                        <input
                          autoFocus
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={() => saveRename(yard)}
                          onKeyDown={(e) => e.key === 'Enter' && saveRename(yard)}
                          className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-sm font-semibold"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRename(yard)}
                          className="flex items-center gap-1 truncate text-sm font-semibold text-gray-900 hover:text-emerald-700"
                        >
                          {yard.name}
                          <Pencil size={11} className="shrink-0 text-gray-400" />
                        </button>
                      )}
                      <p className="flex items-center gap-1 truncate text-xs text-gray-500">
                        <MapPin size={10} className="shrink-0" />
                        {yard.label || 'No location set'}
                      </p>
                    </div>
                    {isActive ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">
                        <Check size={12} /> Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSwitch(yard.id)}
                        className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Switch to
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50 px-2.5 py-2">
                    <input
                      ref={(el) => { fileInputs.current[yard.id] = el; }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => replacePhoto(yard, e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputs.current[yard.id]?.click()}
                      disabled={isBusy}
                      className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      Replace photo
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingLocationYard(yard)}
                      className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <MapPin size={11} /> Location
                    </button>
                    <div className="ml-auto">
                      {confirmingDeleteId === yard.id ? (
                        <span className="flex items-center gap-1.5 text-xs">
                          <span className="text-gray-600">Delete — and everything in it?</span>
                          <button
                            type="button"
                            onClick={() => remove(yard)}
                            disabled={isBusy}
                            className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700 disabled:bg-gray-400"
                          >
                            {isBusy ? <Loader2 size={11} className="animate-spin" /> : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            className="rounded-md border border-gray-300 px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        yards.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(yard.id)}
                            aria-label={`Delete ${yard.name}`}
                            className="p-1 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 size={13} />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex gap-2 rounded-lg border border-dashed border-gray-300 p-2.5">
            <input
              type="text"
              value={addingName}
              onChange={(e) => setAddingName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addYard()}
              placeholder="e.g. Community plot, Mom's yard"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={addYard}
              disabled={adding}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-400"
            >
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Add
            </button>
          </div>
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

      {editingLocationYard && (
        <GardenLocationSettings
          yard={editingLocationYard}
          onSaved={(updated) => onSaved(yards.map((y) => (y.id === updated.id ? updated : y)))}
          onClose={() => setEditingLocationYard(null)}
        />
      )}
    </div>
  );
}
