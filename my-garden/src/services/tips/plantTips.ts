// src/services/tips/plantTips.ts
// General per-species care knowledge for a plant already in the garden —
// propagation method/season, pruning season, ideal temperature range.
// Keyed on the plant's name/species (no photo needed). The actual Mistral
// call, JSON parsing, and per-species cache all live server-side in
// supabase/functions/plant-tips — this only sends the name and maps
// whatever comes back onto a typed result.

import type { PlantTipsResult } from '../../types';
import { supabase } from '../../lib/supabase';

export const plantTipsService = {
  /** Never throws for an unusable answer — reports it as an error status
   *  instead, same convention as plantDiagnosisService.diagnose. A
   *  cancelled request (AbortSignal fired) still rethrows. */
  async getTips(plantName: string, signal?: AbortSignal): Promise<PlantTipsResult> {
    const name = plantName.trim();
    if (!name) return { status: 'error', message: 'No plant name to look up.' };

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { status: 'offline', message: "You're offline — try again once you reconnect." };
    }

    try {
      const { data, error } = await supabase.functions.invoke<{
        tips?: PlantTipsResult['tips'];
        error?: string;
      }>('plant-tips', { body: { plantName: name }, signal });

      if (error) {
        const funcStatus = (error as { context?: { status?: number } })?.context?.status;
        if (funcStatus === 401) return { status: 'error', message: 'Please sign in again.' };
        if (funcStatus === 501) {
          return { status: 'unconfigured', message: 'Plant tips aren’t set up yet.' };
        }
        if (funcStatus === 402) {
          return {
            status: 'unconfigured',
            message: 'Plant tips are a premium feature — upgrade to see propagation and care tips.',
          };
        }
        if (funcStatus === 422) {
          return { status: 'not-a-plant', message: `Couldn't recognize "${name}" as a plant.` };
        }
        console.error('plant-tips function unreachable', error);
        return { status: 'error', message: "Couldn't reach plant tips right now." };
      }

      if (!data?.tips) return { status: 'error', message: 'Plant tips failed.' };
      return { status: 'ok', tips: data.tips };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.error('Plant tips failed', err);
      return { status: 'error', message: err instanceof Error ? err.message : 'Plant tips failed.' };
    }
  },
};
