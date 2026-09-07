// src/services/diagnosis/plantDiagnosis.ts
// "What's wrong with this plant" from a photo — sun damage, over/under-
// watering, pests, needs a trim, needs fertilizer. Asks a vision-capable
// LLM and validates the shape; unlike seedPlan.ts there's no sensible local
// fallback for "what does this specific photo show", so an unusable answer
// is reported as an error/status instead of degrading to a guess. The
// actual Mistral call (and its API key) lives server-side in
// supabase/functions/ai-plant-diagnosis — this only sends the photo and
// parses whatever text comes back.

import type { DiagnosisCategory, DiagnosisFinding, PlantDiagnosisResult } from '../../types';
import { fileToBase64, resizeImage } from '../../utils/imageUtils';
import { supabase } from '../../lib/supabase';

const CATEGORIES: DiagnosisCategory[] = [
  'sun-damage', 'not-enough-sun', 'overwatering', 'underwatering', 'pest', 'disease',
  'needs-trim', 'needs-fertilizer', 'needs-repotting', 'temperature-stress', 'low-humidity', 'other',
];
const CONFIDENCES = ['low', 'medium', 'high'];

/* ---------- parsing ---------- */
// The schema prompt itself lives in supabase/functions/ai-plant-diagnosis —
// it has to run server-side next to the API key. parseDiagnosis below still
// expects exactly the shape that prompt asks for.

export function parseDiagnosis(raw: string): PlantDiagnosisResult | null {
  // Models sometimes wrap JSON in prose or a fence; take the outermost object.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  if (parsed.plantVisible === false) {
    return {
      status: 'no-plant-detected',
      findings: [],
      message: "Couldn't see a plant clearly in that photo — try a closer, well-lit shot.",
    };
  }

  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings: DiagnosisFinding[] = rawFindings
    .filter(
      (f: any) =>
        f && typeof f.label === 'string' && f.label.trim() &&
        typeof f.observation === 'string' && f.observation.trim() &&
        typeof f.remedy === 'string' && f.remedy.trim(),
    )
    .map((f: any) => ({
      category: CATEGORIES.includes(f.category) ? f.category : 'other',
      label: f.label.trim(),
      confidence: CONFIDENCES.includes(f.confidence) ? f.confidence : 'medium',
      observation: f.observation.trim(),
      remedy: f.remedy.trim(),
    }));

  const overallHealth = ['healthy', 'stressed', 'unhealthy'].includes(parsed.overallHealth)
    ? parsed.overallHealth
    : findings.length
      ? 'stressed'
      : 'healthy';

  return { status: 'ok', findings, overallHealth };
}

/* ---------- AI ---------- */

export const plantDiagnosisService = {
  /** Never throws for an unusable answer — reports it as an error status
   *  instead. A cancelled request (AbortSignal fired) still rethrows, so a
   *  caller racing/superseding requests can tell the difference from "AI
   *  declined to answer". */
  /** `knownIssues` are plain labels (e.g. "spider mites, partially treated")
   *  from Plant.knownIssues — passed as context so the model specifically
   *  checks for lingering signs of something already suspected, instead of
   *  judging the photo fresh with no history. */
  async diagnose(photo: Blob, knownIssues?: string[], signal?: AbortSignal): Promise<PlantDiagnosisResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        status: 'offline',
        findings: [],
        message: "You're offline — try diagnosing again once you reconnect.",
      };
    }

    try {
      const shrunk = await resizeImage(photo, 1024, 1024, 0.85);
      const imageBase64 = await fileToBase64(shrunk);

      const { data, error } = await supabase.functions.invoke<{ text?: string; error?: string }>(
        'ai-plant-diagnosis',
        { body: { imageBase64, mimeType: 'image/jpeg', knownIssues }, signal },
      );

      if (error) {
        const funcStatus = (error as any)?.context?.status as number | undefined;
        if (funcStatus === 401) {
          return { status: 'error', findings: [], message: 'Please sign in again.' };
        }
        if (funcStatus === 501) {
          return {
            status: 'unconfigured',
            findings: [],
            message: 'Plant diagnosis isn’t set up yet.',
          };
        }
        if (funcStatus === 402) {
          return {
            status: 'unconfigured',
            findings: [],
            message: 'Plant diagnosis is a premium feature — upgrade for an AI health check.',
          };
        }
        console.error('plant-diagnosis function unreachable', error);
        return {
          status: 'error',
          findings: [],
          message: "Couldn't reach plant diagnosis right now.",
        };
      }

      if (!data?.text) {
        return { status: 'error', findings: [], message: 'Diagnosis failed.' };
      }
      return parseDiagnosis(data.text) ?? { status: 'error', findings: [], message: 'Diagnosis failed.' };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.error('Plant diagnosis failed', err);
      return {
        status: 'error',
        findings: [],
        message: err instanceof Error ? err.message : 'Diagnosis failed.',
      };
    }
  },
};
