// src/components/SunMapOverlay.tsx
// A year-round sun/shade readout laid over the yard photo — for picking a
// spot a plant can stay in through every season instead of checking one
// point at a time. Same heuristic as the per-plant "Sun check"
// (utils/sunExposure.ts), just sampled across a grid.

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { computeCurrentSunMap, computeMonthSunMap, computeSunMap, type SunMapCell } from '../utils/sunExposure';
import type { Yard, YardObstacle } from '../types';

const CLASSIFICATION_STYLE: Record<SunMapCell['classification'], { color: string; label: string }> = {
  'full-sun': { color: 'rgba(251, 191, 36, 0.55)', label: 'Sunny year-round' },
  'partial-shade': { color: 'rgba(74, 222, 128, 0.45)', label: 'Mixed through the year' },
  'full-shade': { color: 'rgba(71, 85, 105, 0.5)', label: 'Shaded year-round' },
};

const MONTH_CLASSIFICATION_LABEL: Record<SunMapCell['classification'], string> = {
  'full-sun': '6+ hours of sun',
  'partial-shade': '3–6 hours of sun',
  'full-shade': 'Under 3 hours of sun',
};

const CURRENT_STYLE = {
  sunny: { color: 'rgba(251, 191, 36, 0.55)', label: 'Sunny right now' },
  shaded: { color: 'rgba(71, 85, 105, 0.5)', label: 'Shaded right now' },
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const COLS = 20;
const ROWS = 14;

type Mode = 'year-round' | 'month' | 'now';

interface SunMapOverlayProps {
  yardImageUrl: string;
  obstacles: YardObstacle[];
  garden: Yard | null;
  onClose: () => void;
}

export function SunMapOverlay({ yardImageUrl, obstacles, garden, onClose }: SunMapOverlayProps) {
  const [mode, setMode] = useState<Mode>('year-round');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const located = garden && garden.latitude != null && garden.longitude != null ? garden : null;

  const cells = useMemo(() => {
    if (!located) return [];
    return computeSunMap(obstacles, located.latitude!, located.longitude!, located.orientationDeg, COLS, ROWS);
  }, [obstacles, located]);

  const monthCells = useMemo(() => {
    if (!located || mode !== 'month') return [];
    return computeMonthSunMap(obstacles, located.latitude!, located.longitude!, month, located.orientationDeg, COLS, ROWS);
  }, [obstacles, located, mode, month]);

  const current = useMemo(() => {
    if (!located || mode !== 'now') return null;
    return computeCurrentSunMap(obstacles, located.latitude!, located.longitude!, located.orientationDeg, COLS, ROWS);
  }, [obstacles, located, mode]);

  const now = useMemo(
    () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    [current],
  );

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
          {!located ? (
            <p className="text-sm text-gray-600">
              Set your garden location first — the estimate needs it to work out where the sun sits
              through the year.
            </p>
          ) : (
            <>
              <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => setMode('year-round')}
                  className={`flex-1 rounded-md py-1.5 font-semibold transition-colors ${
                    mode === 'year-round' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Year-round
                </button>
                <button
                  type="button"
                  onClick={() => setMode('month')}
                  className={`flex-1 rounded-md py-1.5 font-semibold transition-colors ${
                    mode === 'month' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  By month
                </button>
                <button
                  type="button"
                  onClick={() => setMode('now')}
                  className={`flex-1 rounded-md py-1.5 font-semibold transition-colors ${
                    mode === 'now' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Right now
                </button>
              </div>

              {mode === 'month' && (
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {MONTH_NAMES.map((name, i) => (
                    <option key={name} value={i + 1}>{name}</option>
                  ))}
                </select>
              )}

              <p className="text-sm text-gray-600">
                {mode === 'year-round'
                  ? 'A season-by-season estimate of every spot in the yard, so you can plant somewhere that won\'t need to move come summer or winter.'
                  : mode === 'month'
                    ? `A mid-${MONTH_NAMES[month - 1]} snapshot of every spot in the yard, at that month's sun angle.`
                    : `Where the sun can reach as of ${now}.`}{' '}
                Same heuristic as each plant's own "Sun check" — a starting point, not a guarantee.
              </p>

              {mode === 'now' && current && !current.daytime && (
                <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                  It's nighttime right now — the sun's below the horizon everywhere in the yard.
                </p>
              )}

              <div className="relative w-full overflow-hidden rounded-lg border border-gray-200">
                <img src={yardImageUrl} alt="Your yard" className="block h-auto w-full select-none" draggable={false} />
                <div className="pointer-events-none absolute inset-0">
                  {mode === 'year-round' &&
                    cells.map((cell, i) => (
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
                  {mode === 'month' &&
                    monthCells.map((cell, i) => (
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
                  {mode === 'now' &&
                    current?.daytime &&
                    current.cells.map((cell, i) => (
                      <div
                        key={i}
                        className="absolute"
                        style={{
                          left: `${cell.x - 100 / COLS / 2}%`,
                          top: `${cell.y - 100 / ROWS / 2}%`,
                          width: `${100 / COLS}%`,
                          height: `${100 / ROWS}%`,
                          backgroundColor: cell.sunny ? CURRENT_STYLE.sunny.color : CURRENT_STYLE.shaded.color,
                        }}
                      />
                    ))}
                </div>
              </div>

              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {mode === 'now'
                  ? (Object.keys(CURRENT_STYLE) as (keyof typeof CURRENT_STYLE)[]).map((key) => (
                      <li key={key} className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-3 rounded-sm border border-black/10"
                          style={{ backgroundColor: CURRENT_STYLE[key].color }}
                        />
                        {CURRENT_STYLE[key].label}
                      </li>
                    ))
                  : (Object.keys(CLASSIFICATION_STYLE) as SunMapCell['classification'][]).map((key) => (
                      <li key={key} className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-3 rounded-sm border border-black/10"
                          style={{ backgroundColor: CLASSIFICATION_STYLE[key].color }}
                        />
                        {mode === 'month' ? MONTH_CLASSIFICATION_LABEL[key] : CLASSIFICATION_STYLE[key].label}
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
