// src/components/PlantPhotoCapture.tsx
// Camera or file input on any device, then Pl@ntNet identification, then an
// optional cut-out for the yard marker. Every failure path stays recoverable:
// the user can always continue by hand with the photo they took.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, ImagePlus, RefreshCw, X, Check, AlertTriangle } from 'lucide-react';
import type { PlantIdCandidate, PlantIdResult } from '../types';
import { plantIdService, LOW_CONFIDENCE_THRESHOLD } from '../services/plantid/identify';
import {
  removeBackground,
  preload as preloadBackgroundRemoval,
} from '../services/vision/backgroundRemoval';
import { fileToDataUrl, resizeImage } from '../utils/imageUtils';
import { readExifDate } from '../utils/exifDate';

export interface PhotoCaptureValue {
  /** Downscaled JPEG of what the user shot. */
  photo: Blob;
  photoPreviewUrl: string;
  /** Cut-out PNG when it worked; falls back to the photo. */
  sprite: Blob;
  spritePreviewUrl: string;
  spriteIsCutout: boolean;
  /** Why the cut-out didn't happen — undefined when spriteIsCutout is true.
   *  Set on every failure path (timeout, unsupported browser, network/CDN
   *  error) so a caller can tell the person why they got the full photo
   *  instead of a silhouette, rather than leaving them to guess. */
  spriteWarning?: string;
  identification?: PlantIdResult;
  chosen?: PlantIdCandidate;
  /** When the photo was actually taken, from its EXIF data — undefined
   *  when there's none (a live-camera capture has no EXIF at all; a chosen
   *  file might not either), in which case the caller should fall back to
   *  "now" rather than leaving the photo undated. */
  takenAt?: Date;
}

interface PlantPhotoCaptureProps {
  onComplete: (value: PhotoCaptureValue) => void;
  onCancel?: () => void;
  /** Skips straight to the form; the caller keeps the photo. */
  onSkipIdentification?: (photo: Blob, previewUrl: string) => void;
}

type Stage = 'capture' | 'live-camera' | 'identifying' | 'review' | 'cutout';

export function PlantPhotoCapture({
  onComplete,
  onCancel,
  onSkipIdentification,
}: PlantPhotoCaptureProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrls = useRef<string[]>([]);

  const [stage, setStage] = useState<Stage>('capture');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [takenAt, setTakenAt] = useState<Date | undefined>(undefined);
  const [result, setResult] = useState<PlantIdResult | null>(null);
  const [chosenIndex, setChosenIndex] = useState(0);
  const [cutoutProgress, setCutoutProgress] = useState({ fraction: 0, label: '' });
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState('');

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    preloadBackgroundRemoval();
    return () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      stopStream();
    };
  }, [stopStream]);

  // Attach the live stream once the <video> element for this stage exists.
  // Safari in particular won't actually start rendering frames from a
  // programmatically-set srcObject on the strength of the `autoPlay`
  // attribute alone — it needs an explicit play() call.
  useEffect(() => {
    if (stage === 'live-camera' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [stage]);

  const track = useCallback((url: string) => {
    objectUrls.current.push(url);
    return url;
  }, []);

  const processImage = async (blob: Blob) => {
    setError('');

    try {
      // Read EXIF from the original file — resizeImage below re-encodes via
      // canvas, which strips all metadata, so this only works done first.
      setTakenAt((await readExifDate(blob)) ?? undefined);
      const shrunk = await resizeImage(blob, 1280, 1280, 0.88);
      setPhoto(shrunk);
      setPhotoUrl(track(URL.createObjectURL(shrunk)));
      setStage('identifying');

      const identification = await plantIdService.identify([shrunk]);
      setResult(identification);
      setChosenIndex(0);
      setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plantPhotoCapture.couldNotReadPhoto'));
      setStage('capture');
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('plantPhotoCapture.notAnImage'));
      return;
    }
    void processImage(file);
  };

  /** Opens a live in-page camera preview — works the same on desktop and
   *  mobile, unlike handing off to the OS (which on desktop just silently
   *  falls back to a plain file picker that's easy to miss). */
  const openCamera = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      // getUserMedia needs a secure context (HTTPS, or localhost) — on a
      // plain-HTTP origin (e.g. testing over LAN by IP) it doesn't exist at
      // all. Falls back to a *camera-hinted* file input rather than the
      // plain gallery one below, so the phone still opens its camera app
      // directly instead of a generic "choose an app" picker that can land
      // on whatever's set as the default (Google Photos, in one report).
      cameraFileInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      streamRef.current = stream;
      setPermissionDenied(false);
      setStage('live-camera');
    } catch {
      setPermissionDenied(true);
    }
  };

  const cancelLiveCamera = () => {
    stopStream();
    setStage('capture');
  };

  const snapPhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        stopStream();
        if (blob) void processImage(blob);
        else {
          setError(t('plantPhotoCapture.couldNotCapturePhoto'));
          setStage('capture');
        }
      },
      'image/jpeg',
      0.9,
    );
  };

  const buildSprite = async () => {
    if (!photo) return;
    setStage('cutout');
    setCutoutProgress({ fraction: 0.02, label: t('plantPhotoCapture.starting') });

    const outcome = await removeBackground(photo, {
      onProgress: (fraction, label) => setCutoutProgress({ fraction, label }),
    });

    const spriteUrl = track(URL.createObjectURL(outcome.blob));
    // onComplete fires synchronously and the caller (PlantForm/
    // PlantCareModal) responds by unmounting this component in the same
    // tick — any local state set for a failure here would never get a
    // chance to paint. spriteWarning carries the reason forward instead,
    // so whichever screen comes next can show it.
    onComplete({
      photo,
      photoPreviewUrl: photoUrl,
      sprite: outcome.blob,
      spritePreviewUrl: spriteUrl,
      spriteIsCutout: outcome.ok,
      spriteWarning: outcome.ok ? undefined : outcome.message,
      identification: result ?? undefined,
      chosen: result?.candidates[chosenIndex],
      takenAt,
    });
  };

  const retake = () => {
    setPhoto(null);
    setPhotoUrl('');
    setTakenAt(undefined);
    setResult(null);
    setStage('capture');
  };

  /* ---------- capture ---------- */

  if (stage === 'capture') {
    return (
      <div className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {/* Separate from the plain gallery input above — `capture` is what
            actually gets a phone to open its camera app directly instead of
            a generic "choose an app" picker, for the (live-camera-API-less)
            fallback path only. Never add it to the gallery input; that one's
            the deliberate "pick an existing photo" choice. */}
        <input
          ref={cameraFileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
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
              <AlertTriangle size={15} /> {t('plantPhotoCapture.cameraBlocked')}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              {t('plantPhotoCapture.cameraBlockedDetail')}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={openCamera}
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:bg-emerald-100"
          >
            <Camera size={22} /> {t('plantPhotoCapture.takePhoto')}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-3 text-sm font-semibold text-gray-700 transition hover:border-gray-500 hover:bg-gray-100"
          >
            <ImagePlus size={22} /> {t('plantPhotoCapture.chooseFile')}
          </button>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full text-xs text-gray-500 underline hover:text-gray-700"
          >
            {t('plantPhotoCapture.skipPhoto')}
          </button>
        )}
      </div>
    );
  }

  /* ---------- live camera ---------- */

  if (stage === 'live-camera') {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="block w-full" />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={cancelLiveCamera}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t('plantPhotoCapture.cancel')}
          </button>
          <button
            type="button"
            onClick={snapPhoto}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <Camera size={16} /> {t('plantPhotoCapture.capture')}
          </button>
        </div>
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
            alt={t('plantPhotoCapture.capturedPlantAlt')}
            className="h-44 w-full rounded-lg object-cover"
          />
        )}
        <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-3">
          <RefreshCw size={18} className="animate-spin text-emerald-700" />
          <p className="text-sm font-medium text-emerald-900">{t('plantPhotoCapture.identifyingPlant')}</p>
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
            alt={t('plantPhotoCapture.capturedPlantAlt')}
            className="h-44 w-full rounded-lg object-cover"
          />
        )}
        <div className="rounded-lg bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            {cutoutProgress.label || t('plantPhotoCapture.cuttingOutBackground')}…
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-emerald-200">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${Math.round(cutoutProgress.fraction * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-emerald-800">
            {t('plantPhotoCapture.runsOnDevice')}
          </p>
        </div>
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
          alt={t('plantPhotoCapture.capturedPlantAlt')}
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
            {status === 'low-confidence' && t('plantPhotoCapture.statusLowConfidence')}
            {status === 'no-match' && t('plantPhotoCapture.statusNoMatch')}
            {status === 'rejected' && t('plantPhotoCapture.statusRejected')}
            {status === 'unconfigured' && t('plantPhotoCapture.statusUnconfigured')}
            {status === 'offline' && t('plantPhotoCapture.statusOffline')}
            {status === 'error' && t('plantPhotoCapture.statusError')}
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
          <RefreshCw size={14} /> {t('plantPhotoCapture.retake')}
        </button>
        <button
          type="button"
          onClick={buildSprite}
          className="flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          {candidates.length ? t('plantPhotoCapture.useThisPlant') : t('plantPhotoCapture.continueByHand')}
        </button>
      </div>

      {onSkipIdentification && photo && (
        <button
          type="button"
          onClick={() => onSkipIdentification(photo, photoUrl)}
          className="flex w-full items-center justify-center gap-1 text-xs text-gray-500 underline hover:text-gray-700"
        >
          <X size={12} /> {t('plantPhotoCapture.keepPhotoSkipCutout')}
        </button>
      )}
    </div>
  );
}
