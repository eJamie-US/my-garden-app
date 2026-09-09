// src/components/PlantTipsPanel.tsx
// General care knowledge for this plant's species — propagation method and
// season, pruning season, ideal temperature range. Runs automatically
// whenever the name/species it's given changes; server-cached per species
// (see supabase/functions/plant-tips), so re-opening the same species'
// care modal anywhere is instant after the first lookup for it.

import { useEffect, useState } from 'react';
import { Info, Loader2, Scissors, Sprout, Thermometer } from 'lucide-react';
import { plantTipsService } from '../services/tips/plantTips';
import type { PlantTipsResult } from '../types';

interface PlantTipsPanelProps {
  /** Species if known, else the plant's own name — whatever's the best
   *  identifier available to look this species up by. */
  plantName: string;
}

export function PlantTipsPanel({ plantName }: PlantTipsPanelProps) {
  const [result, setResult] = useState<PlantTipsResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const name = plantName.trim();
    if (!name) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    plantTipsService
      .getTips(name, controller.signal)
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [plantName]);

  if (!plantName.trim()) return null;

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 size={13} className="animate-spin" /> Looking up plant tips…
      </p>
    );
  }

  if (!result || result.status !== 'ok' || !result.tips) {
    return result?.message ? (
      <p className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-600">
        {result.message}
      </p>
    ) : null;
  }

  const { tips } = result;

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-2.5">
      <div className="flex gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Sprout size={14} />
        </span>
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-semibold text-gray-900">Propagation</span>
          <p className="mt-0.5 text-gray-600">{tips.propagationMethod}</p>
          <p className="text-emerald-700">Best time: {tips.propagationSeason}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Scissors size={14} />
        </span>
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-semibold text-gray-900">Pruning</span>
          <p className="mt-0.5 text-gray-600">{tips.pruningSeason}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
          <Thermometer size={14} />
        </span>
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-semibold text-gray-900">Ideal temperature</span>
          <p className="mt-0.5 text-gray-600">{tips.idealTempRange}</p>
        </div>
      </div>
      {tips.notes && (
        <div className="flex gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <Info size={14} />
          </span>
          <p className="min-w-0 flex-1 text-xs text-gray-600">{tips.notes}</p>
        </div>
      )}
    </div>
  );
}
