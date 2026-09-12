// src/services/tips/plantTips.ts
// General per-species care knowledge for a plant already in the garden —
// propagation method/season, pruning season, ideal temperature range.
// Keyed on the plant's name/species (no photo needed). The actual Mistral
// call, JSON parsing, and per-species cache all live server-side in
// supabase/functions/plant-tips — this only sends the name and maps
// whatever comes back onto a typed result.

import type { PlantTipsResult } from '../../types';
import { supabase } from '../../lib/supabase';
import i18n from '../../i18n';

export const plantTipsService = {
  /** Never throws for an unusable answer — reports it as an error status
   *  instead, same convention as plantDiagnosisService.diagnose. A
   *  cancelled request (AbortSignal fired) still rethrows. */
  async getTips(plantName: string, signal?: AbortSignal): Promise<PlantTipsResult> {
    const name = plantName.trim();
    if (!name) return { status: 'error', message: i18n.t('plantTipsService.noPlantName') };

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { status: 'offline', message: i18n.t('plantTipsService.offline') };
    }

    try {
      const { data, error } = await supabase.functions.invoke<{
        tips?: PlantTipsResult['tips'];
        error?: string;
      }>('plant-tips', { body: { plantName: name, locale: i18n.language }, signal });

      if (error) {
        const funcStatus = (error as { context?: { status?: number } })?.context?.status;
        if (funcStatus === 401) return { status: 'error', message: i18n.t('plantTipsService.signInAgain') };
        if (funcStatus === 501) {
          return { status: 'unconfigured', message: i18n.t('plantTipsService.notSetUpYet') };
        }
        if (funcStatus === 402) {
          return {
            status: 'unconfigured',
            message: i18n.t('plantTipsService.premiumFeature'),
          };
        }
        if (funcStatus === 422) {
          return { status: 'not-a-plant', message: i18n.t('plantTipsService.notAPlant', { name }) };
        }
        console.error('plant-tips function unreachable', error);
        return { status: 'error', message: i18n.t('plantTipsService.couldNotReach') };
      }

      if (!data?.tips) return { status: 'error', message: i18n.t('plantTipsService.failed') };
      return { status: 'ok', tips: data.tips };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.error('Plant tips failed', err);
      return { status: 'error', message: err instanceof Error ? err.message : i18n.t('plantTipsService.failed') };
    }
  },
};
