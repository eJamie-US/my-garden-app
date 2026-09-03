// src/services/vision/backgroundRemoval.ts
// Client-side cut-out via @imgly/background-removal (WASM, runs in-browser).
// Called AFTER identification, only to build the yard marker sprite — never on
// the critical path: every failure falls back to the original photo.

import { resizeImage, trimTransparent } from '../../utils/imageUtils';

export interface BackgroundRemovalResult {
  ok: boolean;
  /** Cut-out PNG on success; the untouched input on failure. */
  blob: Blob;
  /** Present when ok === false. */
  reason?: 'timeout' | 'unsupported' | 'failed';
  message?: string;
}

export interface RemoveOptions {
  /** 0..1, coarse — the model reports progress in stages. */
  onProgress?: (fraction: number, label: string) => void;
  /** WASM download + inference can be slow on mobile. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

let modulePromise: Promise<any> | null = null;

/** Lazy — keeps the ~5MB WASM bundle out of the initial page load. */
function loadModule() {
  if (!modulePromise) {
    modulePromise = import('@imgly/background-removal').catch((err) => {
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}

export function isSupported(): boolean {
  return (
    typeof WebAssembly === 'object' &&
    typeof createImageBitmap === 'function' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

/** Call on an idle moment (e.g. when the capture sheet opens) to warm the cache. */
export function preload(): void {
  if (isSupported()) void loadModule().catch(() => {});
}

export async function removeBackground(
  input: Blob,
  { onProgress, timeoutMs = 45_000, signal }: RemoveOptions = {},
): Promise<BackgroundRemovalResult> {
  if (!isSupported()) {
    return {
      ok: false,
      blob: input,
      reason: 'unsupported',
      message: "This browser can't cut out the background. Using the full photo.",
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const work = (async () => {
      onProgress?.(0.05, 'Loading model');
      const mod = await loadModule();
      const removeFn = mod.removeBackground ?? mod.default;
      if (typeof removeFn !== 'function') throw new Error('Bad module shape');

      // Smaller input = dramatically faster inference; 512px is plenty for a marker.
      const small = await resizeImage(input, 512, 512, 0.9);
      onProgress?.(0.2, 'Finding the plant');

      const cut: Blob = await removeFn(small, {
        output: { format: 'image/png', quality: 0.9 },
        progress: (key: string, current: number, total: number) => {
          const fraction = total ? current / total : 0;
          onProgress?.(0.2 + fraction * 0.7, key.startsWith('fetch') ? 'Loading model' : 'Cutting out');
        },
      });

      onProgress?.(0.95, 'Trimming');
      const trimmed = await trimTransparent(cut).catch(() => cut);
      onProgress?.(1, 'Done');
      return trimmed;
    })();

    const raced = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('__timeout')), timeoutMs);
        signal?.addEventListener('abort', () => reject(new Error('__abort')), { once: true });
      }),
    ]);

    return { ok: true, blob: raced };
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === '__abort') throw err;
    if (message === '__timeout') {
      console.error('Background removal timed out after', timeoutMs, 'ms');
      return {
        ok: false,
        blob: input,
        reason: 'timeout',
        message: 'Cut-out took too long. Using the full photo for the marker.',
      };
    }
    // The model/WASM is fetched at runtime from a third-party CDN
    // (staticimgly.com) — logging the real cause here is the only way to
    // tell a network/CDN problem apart from an actual library bug later.
    console.error('Background removal failed:', err);
    return {
      ok: false,
      blob: input,
      reason: 'failed',
      message: "Couldn't cut out the background. Using the full photo.",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
