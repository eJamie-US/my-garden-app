// src/hooks/useSeasonalTasks.ts
// Fetches plant-tips' seasonalTasks for every distinct species in the
// active yard and matches them against the current month — the data
// behind DueToday's "This month" tab. Split out from the component so the
// fetch/match logic stays testable independent of any particular UI.

import { useEffect, useMemo, useState } from 'react';
import type { Plant, SeasonalTask, Yard } from '../types';
import type { Plan } from '../services/supabase/billing';
import { plantTipsService } from '../services/tips/plantTips';
import { matchSeasonalTasks, type SeasonalTaskEntry } from '../utils/seasonalTasks';

// plant-tips shares one Mistral key rate-limited to 1 request/second
// (see supabase/functions/_shared/mistralThrottle.ts) across every user of
// the app, not just this one. Firing every distinct species at once — a
// yard with a few dozen species is a real, not hypothetical, case — would
// dump a burst that size onto the shared queue in one instant; batching
// keeps the number of requests in flight at any moment small and constant
// regardless of how many species a yard has, so no individual lookup ends
// up waiting anywhere near the throttle's own give-up cutoff. Sized against
// the throttle's own 4s-per-slot spacing (mistralThrottle.ts, driven by
// Mistral's 20k-tokens/minute ceiling, not just its request rate) so a
// full batch's worst-case wait (3 × 4s = 12s) stays under that cutoff.
const SPECIES_BATCH_SIZE = 3;

export function useSeasonalTasks(plants: Plant[], garden: Yard | null, plan: Plan) {
  const [tipsBySpecies, setTipsBySpecies] = useState<Map<string, SeasonalTask[]>>(new Map());

  // Every plant that shares a species key only costs one fetch — the
  // server-side cache means repeat species across other users' yards
  // don't even cost that.
  const speciesKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const p of plants) {
      const key = (p.species || p.name).trim();
      if (key) keys.add(key);
    }
    return [...keys];
  }, [plants]);

  useEffect(() => {
    if (plan === 'free' || speciesKeys.length === 0) {
      setTipsBySpecies(new Map());
      return;
    }
    let cancelled = false;

    (async () => {
      const next = new Map<string, SeasonalTask[]>();
      for (let i = 0; i < speciesKeys.length; i += SPECIES_BATCH_SIZE) {
        if (cancelled) return;
        const batchKeys = speciesKeys.slice(i, i + SPECIES_BATCH_SIZE);
        const batchResults = await Promise.allSettled(batchKeys.map((key) => plantTipsService.getTips(key)));
        if (cancelled) return;
        batchResults.forEach((result, j) => {
          if (result.status === 'fulfilled' && result.value.status === 'ok' && result.value.tips) {
            next.set(batchKeys[j], result.value.tips.seasonalTasks);
          }
        });
        // Applied incrementally rather than only at the very end, so a
        // yard with many species starts showing results as each batch
        // lands instead of one long wait for the whole thing.
        setTipsBySpecies(new Map(next));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [speciesKeys, plan]);

  const entries = useMemo(() => {
    if (plan === 'free') return [];
    return matchSeasonalTasks(plants, tipsBySpecies, garden?.latitude);
  }, [plants, tipsBySpecies, garden?.latitude, plan]);

  const byPlant = useMemo(() => {
    const map = new Map<string, SeasonalTaskEntry[]>();
    for (const e of entries) {
      const list = map.get(e.plantId) ?? [];
      list.push(e);
      map.set(e.plantId, list);
    }
    return [...map.entries()];
  }, [entries]);

  return { entries, byPlant };
}
