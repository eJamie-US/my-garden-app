// src/utils/seasonalTasks.ts
// Pure matching logic for SeasonalTasks.tsx, split out so the hemisphere
// math and "does this task apply this month" check can be unit-tested
// without a browser or a live plant-tips call.

import type { Plant, SeasonalTask } from '../types';

export interface SeasonalTaskEntry {
  plantId: string;
  plantName: string;
  task: string;
  note: string;
}

/** Northern-Hemisphere-referenced months (from the model) shifted to match
 *  this yard's actual hemisphere — the simplest reliable adjustment
 *  without asking the model itself to reason about it. `month` and the
 *  return value are both 1-12. */
export function shiftMonth(month: number, southern: boolean): number {
  if (!southern) return month;
  return ((month - 1 + 6) % 12) + 1;
}

/** Every plant/task pairing that applies this month, across the whole
 *  yard. `tipsBySpecies` is keyed by `plant.species || plant.name`
 *  (trimmed) — the same fallback the per-plant tips panel already uses. */
export function matchSeasonalTasks(
  plants: Plant[],
  tipsBySpecies: Map<string, SeasonalTask[]>,
  latitude: number | undefined,
  now: Date = new Date(),
): SeasonalTaskEntry[] {
  const southern = (latitude ?? 0) < 0;
  const currentMonth = now.getMonth() + 1;
  const entries: SeasonalTaskEntry[] = [];
  for (const p of plants) {
    const key = (p.species || p.name).trim();
    const tasks = tipsBySpecies.get(key);
    if (!tasks) continue;
    for (const t of tasks) {
      if (t.months.some((m) => shiftMonth(m, southern) === currentMonth)) {
        entries.push({ plantId: p.id, plantName: p.name, task: t.task, note: t.note });
      }
    }
  }
  return entries;
}
