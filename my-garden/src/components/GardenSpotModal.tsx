// src/components/GardenSpotModal.tsx
// Shown when you click the yard near one or more existing plants: pick which
// one you meant, or plant something new in the same spot.

import type { Plant } from '../types';
import { X, Plus } from 'lucide-react';

interface GardenSpotModalProps {
  /** Existing plant(s) already at (or very near) the clicked spot. */
  plants: Plant[];
  onSelectPlant: (plant: Plant) => void;
  onAddNew: () => void;
  onClose: () => void;
}

export function GardenSpotModal({ plants, onSelectPlant, onAddNew, onClose }: GardenSpotModalProps) {
  const single = plants.length === 1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold text-gray-900">
            {single ? 'Already something here' : `${plants.length} plants here`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-gray-500">
            {single
              ? "Open it, or plant something else in the same spot."
              : 'Pick one to open, or plant something else in the same spot.'}
          </p>

          <ul className="space-y-1.5">
            {plants.map((plant) => {
              const iconSrc = plant.spriteUrl || plant.photoUrl;
              return (
                <li key={plant.id}>
                  <button
                    type="button"
                    onClick={() => onSelectPlant(plant)}
                    className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-2.5 text-left transition hover:border-emerald-400 hover:bg-emerald-50"
                  >
                    {iconSrc ? (
                      <img
                        src={iconSrc}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full object-contain bg-gray-50"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xl">
                        🌱
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">
                        {plant.name}
                      </span>
                      {(plant.commonName || plant.species) && (
                        <span className="block truncate text-xs text-gray-500">
                          {[plant.commonName, plant.species].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={onAddNew}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-gray-300 py-2.5 text-sm font-semibold text-gray-600 hover:border-emerald-400 hover:text-emerald-700"
          >
            <Plus size={15} /> Add another plant here
          </button>
        </div>
      </div>
    </div>
  );
}
