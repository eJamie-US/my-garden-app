// src/components/RainStatus.tsx
// A compact "is it actually raining on my plants" bar, next to Due Today.
// Only shows up once yard obstacles are mapped (nothing to reason from
// otherwise) and while it's actually raining right now — that's the one
// moment this is actionable ("go move the hanging basket"), rather than a
// permanent fixture nagging about wind direction on a dry day.

import { useMemo, useState } from 'react';
import { CloudRain, Umbrella, X } from 'lucide-react';
import type { Plant, WeatherData, Yard, YardObstacle } from '../types';
import { computeRainShelter, describeRainShelter } from '../utils/rainShelter';
import { OBSTACLE_TYPE_LABEL } from './YardObstaclesSettings';

interface RainStatusProps {
  plants: Plant[];
  obstacles: YardObstacle[];
  garden: Yard | null;
  weather?: WeatherData | null;
  onOpenPlant?: (plantId: string) => void;
}

export function RainStatus({ plants, obstacles, garden, weather, onOpenPlant }: RainStatusProps) {
  const [open, setOpen] = useState(false);

  const raining = Boolean(weather?.precipitation && weather.precipitation > 0);

  const statuses = useMemo(() => {
    if (!garden || !raining) return [];
    return plants
      .filter((p) => !p.indoor)
      .map((plant) => ({
        plant,
        shelter: computeRainShelter(plant, obstacles, garden.orientationDeg, weather?.windDirection),
      }));
  }, [plants, obstacles, garden, raining, weather?.windDirection]);

  // Nothing to say when it's dry, there's no garden location, or no
  // obstacles are mapped yet — the checkbox-free estimate needs them.
  if (!raining || !garden || obstacles.length === 0 || statuses.length === 0) return null;

  const exposed = statuses.filter((s) => !s.shelter.sheltered);
  const sheltered = statuses.filter((s) => s.shelter.sheltered);

  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-4 pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left shadow-sm ${
            exposed.length
              ? 'border-sky-200 bg-sky-50 hover:border-sky-300'
              : 'border-emerald-100 bg-white hover:border-emerald-200'
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CloudRain size={16} className="shrink-0 text-sky-600" />
            <span className="shrink-0 text-sm font-bold text-sky-900">Raining now</span>
            {exposed.length > 0 ? (
              <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-xs font-bold text-sky-800">
                {exposed.length} getting wet
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">
                <Umbrella size={11} /> all covered
              </span>
            )}
          </span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b p-4">
              <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <CloudRain size={18} className="text-sky-600" /> Raining now
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 text-gray-500 hover:text-gray-700"
                aria-label="Close rain status"
              >
                <X size={20} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {exposed.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Getting wet
                  </p>
                  <ul className="space-y-1.5">
                    {exposed.map(({ plant, shelter }) => (
                      <li
                        key={plant.id}
                        className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2.5"
                      >
                        <CloudRain size={15} className="mt-0.5 shrink-0 text-sky-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-gray-900">{plant.name}</span>
                          <span className="block text-xs text-gray-600">
                            {describeRainShelter(
                              shelter,
                              shelter.obstacle ? OBSTACLE_TYPE_LABEL[shelter.obstacle.type] : '',
                            )}
                          </span>
                        </span>
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
              )}

              {sheltered.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Staying dry
                  </p>
                  <ul className="space-y-1.5">
                    {sheltered.map(({ plant, shelter }) => (
                      <li
                        key={plant.id}
                        className="flex items-start gap-2 rounded-lg border border-gray-200 p-2.5"
                      >
                        <Umbrella size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-gray-900">{plant.name}</span>
                          <span className="block text-xs text-gray-600">
                            {describeRainShelter(
                              shelter,
                              shelter.obstacle ? OBSTACLE_TYPE_LABEL[shelter.obstacle.type] : '',
                            )}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
