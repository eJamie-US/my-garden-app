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
    Promise.allSettled(speciesKeys.map((key) => plantTipsService.getTips(key))).then((results) => {
      if (cancelled) return;
      const next = new Map<string, SeasonalTask[]>();
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value.status === 'ok' && result.value.tips) {
          next.set(speciesKeys[i], result.value.tips.seasonalTasks);
        }
      });
      setTipsBySpecies(next);
    });
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
