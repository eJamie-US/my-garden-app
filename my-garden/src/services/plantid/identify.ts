// src/services/plantid/identify.ts
// Pl@ntNet v2 identification. https://my.plantnet.org/  (v2/identify/{project})
// The actual Pl@ntNet call (and its API key) lives server-side in
// supabase/functions/plant-id — this builds the same multipart upload it
// always did and hands it to that function instead of Pl@ntNet directly.
// PROJECT isn't a secret (just which taxonomic index to query), so it's
// still fine to configure client-side.

import type { PlantIdCandidate, PlantIdResult } from '../../types';
import { resizeImage } from '../../utils/imageUtils';
import { supabase } from '../../lib/supabase';

const PROJECT = import.meta.env.VITE_PLANTNET_PROJECT || 'all';

/** Below this the caller should make the user confirm rather than auto-accept. */
export const LOW_CONFIDENCE_THRESHOLD = 0.45;
/** Below this we treat the answer as no answer at all. */
export const NO_MATCH_THRESHOLD = 0.08;

export type PlantOrgan = 'leaf' | 'flower' | 'fruit' | 'bark' | 'habit' | 'auto';

export interface IdentifyOptions {
  /** One organ per image, same order. Defaults to 'auto' for each. */
  organs?: PlantOrgan[];
  signal?: AbortSignal;
  /** Pl@ntNet accepts up to 5 images per request. */
  maxImages?: number;
}

function mapCandidate(raw: any): PlantIdCandidate {
  const species = raw?.species ?? {};
  return {
    scientificName:
      species.scientificNameWithoutAuthor || species.scientificName || 'Unknown',
    commonNames: Array.isArray(species.commonNames) ? species.commonNames : [],
    family: species.family?.scientificNameWithoutAuthor,
    genus: species.genus?.scientificNameWithoutAuthor,
    score: typeof raw?.score === 'number' ? raw.score : 0,
    imageUrl: raw?.images?.[0]?.url?.s || raw?.images?.[0]?.url?.m,
  };
}

export const plantIdService = {
  async identify(
    images: Blob[],
    { organs, signal, maxImages = 5 }: IdentifyOptions = {},
  ): Promise<PlantIdResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        status: 'offline',
        candidates: [],
        message: "You're offline. The photo is saved — identify it when you reconnect.",
      };
    }
    if (!images.length) {
      return { status: 'error', candidates: [], message: 'No photo to identify.' };
    }

    const picked = images.slice(0, maxImages);
    const form = new FormData();
    form.append('project', PROJECT);
    for (let i = 0; i < picked.length; i++) {
      // Full-resolution phone photos are rejected for size; downscale first.
      const shrunk = await resizeImage(picked[i], 1024, 1024, 0.85);
      form.append('images', shrunk, `plant-${i}.jpg`);
      form.append('organs', organs?.[i] ?? 'auto');
    }

    try {
      const { data, error } = await supabase.functions.invoke<{
        status: number;
        body: any;
      }>('plant-id', { body: form, signal });

      if (error) {
        // The function itself failed to run (auth, missing secret, network) —
        // distinct from Pl@ntNet answering with an error status, which comes
        // back as a normal `data` envelope instead (handled below).
        const funcStatus = error?.context?.status as number | undefined;
        if (funcStatus === 401) {
          return { status: 'error', candidates: [], message: 'Please sign in again.' };
        }
        if (funcStatus === 501) {
          return {
            status: 'unconfigured',
            candidates: [],
            message: 'Plant identification isn’t set up yet — enter the species by hand.',
          };
        }
        return {
          status: 'offline',
          candidates: [],
          message: "Couldn't reach the identification service.",
        };
      }

      const status = data?.status ?? 0;
      const body = data?.body;

      if (status === 401 || status === 403) {
        return {
          status: 'unconfigured',
          candidates: [],
          message: 'Pl@ntNet rejected the API key.',
        };
      }
      if (status === 404) {
        // Pl@ntNet answers 404 when nothing in the image matches its index.
        return {
          status: 'no-match',
          candidates: [],
          message:
            "Couldn't recognise a plant in that photo. Try a close-up of a single leaf or flower.",
        };
      }
      if (status === 413 || status === 415) {
        return {
          status: 'rejected',
          candidates: [],
          message: "That image wasn't accepted. Try a smaller JPEG or PNG.",
        };
      }
      if (status === 429) {
        return {
          status: 'error',
          candidates: [],
          message: 'Daily identification limit reached. Try again tomorrow.',
        };
      }
      if (status < 200 || status >= 300) {
        return {
          status: 'error',
          candidates: [],
          message: 'Identification failed.',
        };
      }

      const candidates: PlantIdCandidate[] = (body?.results ?? [])
        .map(mapCandidate)
        .filter((c: PlantIdCandidate) => c.score >= NO_MATCH_THRESHOLD)
        .slice(0, 5);

      if (!candidates.length) {
        return {
          status: 'no-match',
          candidates: [],
          message:
            "Couldn't recognise a plant in that photo. Try a close-up of a single leaf or flower.",
        };
      }

      const best = candidates[0];
      return {
        status: best.score >= LOW_CONFIDENCE_THRESHOLD ? 'ok' : 'low-confidence',
        candidates,
        best,
        message:
          best.score >= LOW_CONFIDENCE_THRESHOLD
            ? undefined
            : 'Not a confident match — please confirm or pick another option.',
      };
    } catch (err) {
      if (signal?.aborted) throw err;
      return {
        status: 'error',
        candidates: [],
        message: err instanceof Error ? err.message : 'Identification failed.',
      };
    }
  },
};
