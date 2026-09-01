// src/components/SunMapOverlay.tsx
// A year-round sun/shade readout laid over the yard photo — for picking a
// spot a plant can stay in through every season instead of checking one
// point at a time. Same heuristic as the per-plant "Sun check"
// (utils/sunExposure.ts), just sampled across a grid.

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { computeSunMap, type SunMapCell } from '../utils/sunExposure';
import type { GardenLocation } from '../services/supabase/userSettings';
import type { YardObstacle } from '../types';

const CLASSIFICATION_STYLE: Record<SunMapCell['classification'], { color: string; label: string }> = {
  'full-sun': { color: 'rgba(251, 191, 36, 0.55)', label: 'Sunny year-round' },
  'partial-shade': { color: 'rgba(74, 222, 128, 0.45)', label: 'Mixed through the year' },
  'full-shade': { color: 'rgba(71, 85, 105, 0.5)', label: 'Shaded year-round' },
};

const COLS = 20;
const ROWS = 14;

interface SunMapOverlayProps {
  yardImageUrl: string;
  obstacles: YardObstacle[];
  garden: GardenLocation | null;
  onClose: () => void;
}

export function SunMapOverlay({ yardImageUrl, obstacles, garden, onClose }: SunMapOverlayProps) {
  const cells = useMemo(() => {
    if (!garden) return [];
    return computeSunMap(obstacles, garden.latitude, garden.longitude, garden.orientationDeg, COLS, ROWS);
  }, [obstacles, garden]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">Sun map</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close sun map"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {!garden ? (
            <p className="text-sm text-gray-600">
              Set your garden location first — the estimate needs it to work out where the sun sits
              through the year.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                A season-by-season estimate of every spot in the yard, so you can plant somewhere
                that won't need to move come summer or winter. Same heuristic as each plant's own
                "Sun check" — a starting point, not a guarantee.
              </p>

              <div className="relative w-full overflow-hidden rounded-lg border border-gray-200">
                <img src={yardImageUrl} alt="Your yard" className="block h-auto w-full select-none" draggable={false} />
                <div className="pointer-events-none absolute inset-0">
                  {cells.map((cell, i) => (
                    <div
                      key={i}
                      className="absolute"
                      style={{
                        left: `${cell.x - 100 / COLS / 2}%`,
                        top: `${cell.y - 100 / ROWS / 2}%`,
                        width: `${100 / COLS}%`,
                        height: `${100 / ROWS}%`,
                        backgroundColor: CLASSIFICATION_STYLE[cell.classification].color,
                      }}
                    />
                  ))}
                </div>
              </div>

              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {(Object.keys(CLASSIFICATION_STYLE) as SunMapCell['classification'][]).map((key) => (
                  <li key={key} className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-sm border border-black/10"
                      style={{ backgroundColor: CLASSIFICATION_STYLE[key].color }}
                    />
                    {CLASSIFICATION_STYLE[key].label}
                  </li>
                ))}
              </ul>

              {obstacles.length === 0 && (
                <p className="text-xs text-gray-500">
                  No yard obstacles marked yet — this assumes open sky everywhere. Mark the house,
                  trees, fences and the like for a more useful map.
                </p>
              )}
            </>
          )}
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
    </div>
  );
}
