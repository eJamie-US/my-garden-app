// src/components/PlantDiagnosisPanel.tsx
// "What's wrong with this plant" — snap a photo, get an AI health check
// across every common ailment (sun damage, over/under-watering, pests,
// disease, nutrient deficiency, needs a trim/repot, temperature stress,
// low humidity), with every remedy screened for pet/wildlife safety
// server-side (see supabase/functions/ai-plant-diagnosis). A best guess
// from a photo, not a certified diagnosis — same "estimate, not ground
// truth" framing as the rest of the app's AI-assisted features.

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Bug, Box, Camera, Droplets, Loader2, Scissors, Sun, FlaskConical,
  CircleAlert, Stethoscope, Thermometer, Wind, X,
} from 'lucide-react';
import { plantDiagnosisService } from '../services/diagnosis/plantDiagnosis';
import type { DiagnosisCategory, PlantDiagnosisResult } from '../types';

const CATEGORY_ICON: Record<DiagnosisCategory, typeof Sun> = {
  'sun-damage': Sun,
  'not-enough-sun': Sun,
  overwatering: Droplets,
  underwatering: Droplets,
  pest: Bug,
  disease: Stethoscope,
  'needs-trim': Scissors,
  'needs-fertilizer': FlaskConical,
  'needs-repotting': Box,
  'temperature-stress': Thermometer,
  'low-humidity': Wind,
  other: CircleAlert,
};

const CATEGORY_COLOR: Record<DiagnosisCategory, string> = {
  'sun-damage': 'text-amber-600 bg-amber-50',
  'not-enough-sun': 'text-amber-600 bg-amber-50',
  overwatering: 'text-blue-600 bg-blue-50',
  underwatering: 'text-orange-600 bg-orange-50',
  pest: 'text-red-600 bg-red-50',
  disease: 'text-rose-600 bg-rose-50',
  'needs-trim': 'text-emerald-600 bg-emerald-50',
  'needs-fertilizer': 'text-purple-600 bg-purple-50',
  'needs-repotting': 'text-yellow-700 bg-yellow-50',
  'temperature-stress': 'text-sky-600 bg-sky-50',
  'low-humidity': 'text-cyan-600 bg-cyan-50',
  other: 'text-gray-600 bg-gray-50',
};

function healthLabel(t: TFunction, health: NonNullable<PlantDiagnosisResult['overallHealth']>): { label: string; className: string } {
  const map: Record<NonNullable<PlantDiagnosisResult['overallHealth']>, { key: string; className: string }> = {
    healthy: { key: 'diagnosis.healthy', className: 'bg-emerald-100 text-emerald-800' },
    stressed: { key: 'diagnosis.stressed', className: 'bg-amber-100 text-amber-800' },
    unhealthy: { key: 'diagnosis.unhealthy', className: 'bg-red-100 text-red-800' },
  };
  return { label: t(map[health].key), className: map[health].className };
}

interface PlantDiagnosisPanelProps {
  /** When provided, diagnosis runs automatically against this photo. Used
   *  right after Add Plant's own photo capture (so a new plant gets checked
   *  without a second upload) and when a known issue is newly noted on an
   *  existing plant (checked against its stored photo). Omit entirely for
   *  the standalone "diagnose an existing plant" use, which shows its own
   *  picker with nothing to auto-run. */
  photo?: Blob;
  /** Plant.knownIssues labels — passed as context so the model specifically
   *  checks for lingering signs of something already suspected/partially
   *  treated, instead of judging the photo fresh with no history. */
  knownIssues?: string[];
  /** Keep the manual upload button visible even while auto-running against
   *  `photo` — the known-issues auto-check reuses the plant's existing
   *  stored photo, which might not clearly show the newly-noted problem, so
   *  a fresh photo should still be one tap away. The Add Plant flow doesn't
   *  set this: that photo is already fresh, a second upload would be
   *  redundant. */
  allowManualPhoto?: boolean;
}

export function PlantDiagnosisPanel({ photo, knownIssues, allowManualPhoto }: PlantDiagnosisPanelProps = {}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlantDiagnosisResult | null>(null);

  const runDiagnosis = async (file: Blob) => {
    setLoading(true);
    setResult(null);
    try {
      setResult(await plantDiagnosisService.diagnose(file, knownIssues));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (photo) void runDiagnosis(photo);
    // Re-run only when the photo itself changes (a fresh capture/retake) —
    // runDiagnosis is recreated every render and shouldn't retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file next time
    if (file) await runDiagnosis(file);
  };

  return (
    <div className="space-y-2">
      {photo == null || allowManualPhoto ? (
        <>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50 py-2.5 text-sm font-semibold text-emerald-800 hover:border-emerald-500 hover:bg-emerald-100 disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            {loading
              ? t('diagnosis.checkingPhoto')
              : photo != null
                ? t('diagnosis.checkDifferentPhoto')
                : t('diagnosis.diagnoseFromPhoto')}
          </button>
        </>
      ) : (
        loading && (
          <p className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 size={13} className="animate-spin" /> {t('diagnosis.checkingForIssues')}
          </p>
        )
      )}

      {result && result.status === 'ok' && (
        <div className="space-y-2 rounded-lg border border-gray-200 p-2.5">
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${healthLabel(t, result.overallHealth ?? 'healthy').className}`}
            >
              {healthLabel(t, result.overallHealth ?? 'healthy').label}
            </span>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-gray-400 hover:text-gray-600"
              aria-label={t('diagnosis.dismiss')}
            >
              <X size={14} />
            </button>
          </div>

          {result.findings.length === 0 ? (
            <p className="text-xs text-gray-600">{t('diagnosis.noIssues')}</p>
          ) : (
            <ul className="space-y-2">
              {result.findings.map((f, i) => {
                const Icon = CATEGORY_ICON[f.category];
                return (
                  <li key={i} className="flex gap-2 rounded-md border border-gray-100 p-2">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${CATEGORY_COLOR[f.category]}`}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-gray-900">{f.label}</span>
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                          {t('diagnosis.confidence', { level: f.confidence })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-gray-600">{f.observation}</p>
                      <p className="mt-1 text-emerald-700">{f.remedy}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[10px] text-gray-400">
            {t('diagnosis.disclaimer')}
          </p>
        </div>
      )}

      {result && result.status !== 'ok' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
          {result.message}
        </div>
      )}
    </div>
  );
}
