// src/components/PlantPhotoCapture.tsx
// Camera or file input on any device, then Pl@ntNet identification, then an
// optional cut-out for the yard marker. Every failure path stays recoverable:
// the user can always continue by hand with the photo they took.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, RefreshCw, X, Check, AlertTriangle } from 'lucide-react';
import type { PlantIdCandidate, PlantIdResult } from '../types';
import { plantIdService, LOW_CONFIDENCE_THRESHOLD } from '../services/plantid/identify';
import {
  removeBackground,
  preload as preloadBackgroundRemoval,
} from '../services/vision/backgroundRemoval';
import { fileToDataUrl, resizeImage } from '../utils/imageUtils';

export interface PhotoCaptureValue {
  /** Downscaled JPEG of what the user shot. */
  photo: Blob;
  photoPreviewUrl: string;
  /** Cut-out PNG when it worked; falls back to the photo. */
  sprite: Blob;
  spritePreviewUrl: string;
  spriteIsCutout: boolean;
  identification?: PlantIdResult;
  chosen?: PlantIdCandidate;
}

interface PlantPhotoCaptureProps {
  onComplete: (value: PhotoCaptureValue) => void;
  onCancel?: () => void;
  /** Skips straight to the form; the caller keeps the photo. */
  onSkipIdentification?: (photo: Blob, previewUrl: string) => void;
}

type Stage = 'capture' | 'identifying' | 'review' | 'cutout';

export function PlantPhotoCapture({
  onComplete,
  onCancel,
  onSkipIdentification,
}: PlantPhotoCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  const [stage, setStage] = useState<Stage>('capture');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [result, setResult] = useState<PlantIdResult | null>(null);
  const [chosenIndex, setChosenIndex] = useState(0);
  const [cutoutProgress, setCutoutProgress] = useState({ fraction: 0, label: '' });
  const [cutoutWarning, setCutoutWarning] = useState<string>('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    preloadBackgroundRemoval();
    return () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const track = useCallback((url: string) => {
    objectUrls.current.push(url);
    return url;
  }, []);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setCutoutWarning('');

    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }

    try {
      const shrunk = await resizeImage(file, 1280, 1280, 0.88);
      setPhoto(shrunk);
      setPhotoUrl(track(URL.createObjectURL(shrunk)));
      setStage('identifying');

      const identification = await plantIdService.identify([shrunk]);
      setResult(identification);
      setChosenIndex(0);
      setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo.');
      setStage('capture');
    }
  };

  /**
   * File inputs don't report permission denial, so we probe getUserMedia first
   * and fall back to the gallery picker when the camera is refused.
   */
  const openCamera = async () => {
    setError('');
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop());
        setPermissionDenied(false);
      } catch {
        setPermissionDenied(true);
        return;
      }
    }
    cameraInputRef.current?.click();
  };

  const buildSprite = async () => {
    if (!photo) return;
    setStage('cutout');
    setCutoutProgress({ fraction: 0.02, label: 'Starting' });

    const outcome = await removeBackground(photo, {
      onProgress: (fraction, label) => setCutoutProgress({ fraction, label }),
    });

    if (!outcome.ok) setCutoutWarning(outcome.message ?? '');

    const spriteUrl = track(URL.createObjectURL(outcome.blob));
    onComplete({
      photo,
      photoPreviewUrl: photoUrl,
      sprite: outcome.blob,
      spritePreviewUrl: spriteUrl,
      spriteIsCutout: outcome.ok,
      identification: result ?? undefined,
      chosen: result?.candidates[chosenIndex],
    });
  };

  const retake = () => {
    setPhoto(null);
    setPhotoUrl('');
    setResult(null);
    setCutoutWarning('');
    setStage('capture');
  };

  /* ---------- capture ---------- */

  if (stage === 'capture') {
    return (
      <div className="space-y-3">
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {error && (
          <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {permissionDenied && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <AlertTriangle size={15} /> Camera blocked
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Your browser refused camera access. Allow it in the address-bar
              settings, or choose an existing photo instead.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={openCamera}
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:bg-emerald-100"
          >
            <Camera size={22} /> Take a photo
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-3 text-sm font-semibold text-gray-700 transition hover:border-gray-500 hover:bg-gray-100"
          >
            <ImagePlus size={22} /> Choose a file
          </button>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full text-xs text-gray-500 underline hover:text-gray-700"
          >
            Skip the photo
          </button>
        )}
      </div>
    );
  }

  /* ---------- identifying ---------- */

  if (stage === 'identifying') {
    return (
      <div className="space-y-3">
        {photoUrl && (
          <img
            src={photoUrl}
            alt="Captured plant"
            className="h-44 w-full rounded-lg object-cover"
          />
        )}
        <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-3">
          <RefreshCw size={18} className="animate-spin text-emerald-700" />
          <p className="text-sm font-medium text-emerald-900">Identifying your plant…</p>
        </div>
      </div>
    );
  }

  /* ---------- cutout ---------- */

  if (stage === 'cutout') {
    return (
      <div className="space-y-3">
        {photoUrl && (
          <img
            src={photoUrl}
            alt="Captured plant"
            className="h-44 w-full rounded-lg object-cover"
          />
        )}
        <div className="rounded-lg bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            {cutoutProgress.label || 'Cutting out the background'}…
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-emerald-200">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${Math.round(cutoutProgress.fraction * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-emerald-800">
            This runs on your device, so the first one can take a moment.
          </p>
        </div>
        {cutoutWarning && (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            {cutoutWarning}
          </p>
        )}
      </div>
    );
  }

  /* ---------- review ---------- */

  const status = result?.status ?? 'error';
  const candidates = result?.candidates ?? [];
  const recoverable = status !== 'ok';

  return (
    <div className="space-y-3">
      {photoUrl && (
        <img
          src={photoUrl}
          alt="Captured plant"
          className="h-44 w-full rounded-lg object-cover"
        />
      )}

      {recoverable && result?.message && (
        <div
          className={`rounded-lg border p-3 ${
            status === 'low-confidence'
              ? 'border-amber-300 bg-amber-50'
              : 'border-gray-300 bg-gray-50'
          }`}
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <AlertTriangle size={15} />
            {status === 'low-confidence' && 'Not sure about this one'}
            {status === 'no-match' && 'No match found'}
            {status === 'rejected' && 'Photo not accepted'}
            {status === 'unconfigured' && 'Identification unavailable'}
            {status === 'offline' && "You're offline"}
            {status === 'error' && 'Identification failed'}
          </p>
          <p className="mt-1 text-xs text-gray-700">{result.message}</p>
        </div>
      )}

      {candidates.length > 0 && (
        <ul className="space-y-1.5">
          {candidates.map((candidate, index) => {
            const selected = index === chosenIndex;
            return (
              <li key={candidate.scientificName}>
                <button
                  type="button"
                  onClick={() => setChosenIndex(index)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left transition ${
                    selected
                      ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {candidate.imageUrl ? (
                    <img
                      src={candidate.imageUrl}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded bg-gray-100 text-lg">
                      🌿
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">
                      {candidate.commonNames[0] ?? candidate.scientificName}
                    </span>
                    <span className="block truncate text-xs italic text-gray-500">
                      {candidate.scientificName}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                      candidate.score >= LOW_CONFIDENCE_THRESHOLD
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {Math.round(candidate.score * 100)}%
                  </span>
                  {selected && <Check size={16} className="shrink-0 text-emerald-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={retake}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={14} /> Retake
        </button>
        <button
          type="button"
          onClick={buildSprite}
          className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          {candidates.length ? 'Use this plant' : 'Continue by hand'}
        </button>
      </div>

      {onSkipIdentification && photo && (
        <button
          type="button"
          onClick={() => onSkipIdentification(photo, photoUrl)}
          className="flex w-full items-center justify-center gap-1 text-xs text-gray-500 underline hover:text-gray-700"
        >
          <X size={12} /> Keep the photo, skip the cut-out
        </button>
      )}
    </div>
  );
}
