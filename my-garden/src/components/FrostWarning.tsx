// src/components/FrostWarning.tsx
// A compact "frost is coming" bar, next to Due Today / Rain Status — reuses
// nextFrost() (services/weather/forecast.ts), which already feeds care-item
// generation but had no visible surface of its own. Outdoor plants only;
// frost doesn't distinguish by shelter the way rain does (this app doesn't
// model radiative heat retention near structures), so there's no exposed/
// sheltered split here the way RainStatus has.

import { useState } from 'react';
import { Snowflake, X } from 'lucide-react';
import type { Plant, WeatherData } from '../types';
import { nextFrost } from '../services/weather/forecast';

interface FrostWarningProps {
  plants: Plant[];
  weather?: WeatherData | null;
  onOpenPlant?: (plantId: string) => void;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function FrostWarning({ plants, weather, onOpenPlant }: FrostWarningProps) {
  const [open, setOpen] = useState(false);

  const outdoorPlants = plants.filter((p) => !p.indoor);
  const frostDay = weather ? nextFrost(weather) : undefined;

  // Nothing to say without a garden location (no forecast) or with no
  // outdoor plants to warn about in the first place.
  if (!frostDay || outdoorPlants.length === 0) return null;

  const days = daysUntil(frostDay.date);
  const dayLabel = days <= 0 ? 'tonight' : days === 1 ? 'tomorrow night' : `in ${days} days`;

  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-4 pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left shadow-sm hover:border-sky-300"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Snowflake size={16} className="shrink-0 text-sky-600" />
            <span className="shrink-0 text-sm font-bold text-sky-900">Frost warning</span>
            <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-xs font-bold text-sky-800">
              {dayLabel}
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-sky-700">
            {outdoorPlants.length} outdoor
          </span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b p-4">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <Snowflake size={18} className="text-sky-600" /> Frost warning
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 text-gray-500 hover:text-gray-700"
                aria-label="Close frost warning"
              >
                <X size={20} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-sm text-gray-700">
                A low of {Math.round(frostDay.tempMin)}°C is expected {dayLabel} — bring in anything
                tender, or cover it.
              </p>
              <ul className="space-y-1.5">
                {outdoorPlants.map((plant) => (
                  <li
                    key={plant.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-2.5"
                  >
                    <span className="text-sm font-semibold text-gray-900">{plant.name}</span>
                    {onOpenPlant && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenPlant(plant.id);
                          setOpen(false);
                        }}
                        className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Open
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
