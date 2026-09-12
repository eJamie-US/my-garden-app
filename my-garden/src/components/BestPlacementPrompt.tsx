// src/components/BestPlacementPrompt.tsx
// Shown inline in the Add Plant form whenever evaluatePlacement finds a
// spot in the yard that suits the plant's sun needs better than the one
// just picked — a small photo with the current spot and the best
// alternative(s) marked, so the choice is "does this look right" rather
// than reading numbers.

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { X } from 'lucide-react';
import type { PlacementEvaluation, SunClassification } from '../utils/bestPlacement';

function classificationLabel(t: TFunction, classification: SunClassification): string {
  return t(`bestPlacement.${classification === 'full-sun' ? 'fullSun' : classification === 'partial-shade' ? 'partialShade' : 'fullShade'}`);
}

function spotDescription(t: TFunction, classification: SunClassification, rainySeasons: number): string {
  const sun = classificationLabel(t, classification);
  if (rainySeasons === 4) return t('bestPlacement.spotRainedYearRound', { sun });
  if (rainySeasons === 0) return t('bestPlacement.spotDryYearRound', { sun });
  return t('bestPlacement.spotRainedSeasons', { sun, count: rainySeasons });
}

interface BestPlacementPromptProps {
  yardImageUrl: string;
  sunRequirement: 'full-sun' | 'partial-shade' | 'full-shade';
  evaluation: PlacementEvaluation;
  onUseSpot: (location: { x: number; y: number }) => void;
  onDismiss: () => void;
}

export const BestPlacementPrompt = ({
  yardImageUrl,
  sunRequirement,
  evaluation,
  onUseSpot,
  onDismiss,
}: BestPlacementPromptProps) => {
  const { t } = useTranslation();
  const { current, alternatives } = evaluation;

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-amber-900">
          {t('bestPlacement.suggestion', { sunNeeds: classificationLabel(t, sunRequirement) })}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('bestPlacement.keepSpotDismiss')}
          className="shrink-0 text-amber-500 hover:text-amber-700"
        >
          <X size={14} />
        </button>
      </div>

      <div className="relative w-full overflow-hidden rounded-md border border-amber-200 bg-gray-100">
        <img src={yardImageUrl} alt={t('bestPlacement.yourSpot')} className="block h-auto w-full" />

        <div
          className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[10px] font-bold text-gray-500 shadow ring-2 ring-gray-400"
          style={{ left: `${current.x}%`, top: `${current.y}%` }}
          title={t('bestPlacement.yourSpot')}
        >
          •
        </div>

        {alternatives.map((spot, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onUseSpot(spot)}
            className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow ring-2 ring-white hover:bg-emerald-700"
            style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
            title={t('bestPlacement.useSpotTitle', { number: i + 1 })}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-amber-800">
        {t('bestPlacement.yourSpotSummary', {
          description: spotDescription(t, current.classification, current.rainySeasons),
        })}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {alternatives.map((spot, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onUseSpot(spot)}
            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
          >
            {t('bestPlacement.useSpotButton', {
              number: i + 1,
              description: spotDescription(t, spot.classification, spot.rainySeasons),
            })}
          </button>
        ))}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
        >
          {t('bestPlacement.keepSpot')}
        </button>
      </div>
    </div>
  );
};
