// src/components/GardenLocationSettings.tsx
// Search a place name (Open-Meteo geocoding, no API key) or use the browser's
// location, then save the coordinates against one specific yard.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Loader2, MapPin, Crosshair, Search, X } from 'lucide-react';
import { yardsService } from '../services/supabase/yards';
import type { Yard } from '../types';

interface Match {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

/** 8-way compass picker for "which way is up in the yard photo" — plenty
 *  of precision for the sun/shade estimate, which already reasons in
 *  rough terms. */
function orientationOptions(t: TFunction): { label: string; deg: number }[] {
  return [
    { label: t('gardenLocation.orientationNorth'), deg: 0 },
    { label: t('gardenLocation.orientationNortheast'), deg: 45 },
    { label: t('gardenLocation.orientationEast'), deg: 90 },
    { label: t('gardenLocation.orientationSoutheast'), deg: 135 },
    { label: t('gardenLocation.orientationSouth'), deg: 180 },
    { label: t('gardenLocation.orientationSouthwest'), deg: 225 },
    { label: t('gardenLocation.orientationWest'), deg: 270 },
    { label: t('gardenLocation.orientationNorthwest'), deg: 315 },
  ];
}

interface GardenLocationSettingsProps {
  yard: Yard;
  onSaved: (yard: Yard) => void;
  onClose: () => void;
}

function describe(m: Match) {
  return [m.name, m.admin1, m.country].filter(Boolean).join(', ');
}

export const GardenLocationSettings = ({
  yard,
  onSaved,
  onClose,
}: GardenLocationSettingsProps) => {
  const { t, i18n } = useTranslation();
  const ORIENTATION_OPTIONS = orientationOptions(t);
  const [query, setQuery] = useState(yard.label ?? '');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [picked, setPicked] = useState<{ label?: string; latitude: number; longitude: number } | null>(
    yard.latitude != null && yard.longitude != null
      ? { label: yard.label, latitude: yard.latitude, longitude: yard.longitude }
      : null,
  );
  const [orientationDeg, setOrientationDeg] = useState(yard.orientationDeg ?? 0);
  const [busy, setBusy] = useState<'search' | 'locate' | 'save' | null>(null);
  const [error, setError] = useState('');

  const search = async () => {
    const name = query.trim();
    if (!name) return;
    setError('');
    setBusy('search');
    setMatches(null);
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?count=6&language=${encodeURIComponent(i18n.language)}&format=json&name=${encodeURIComponent(name)}`,
      );
      const data = await res.json();
      const results: Match[] = data?.results ?? [];
      setMatches(results);
      if (!results.length) setError(t('gardenLocation.noPlaceFound', { name }));
    } catch {
      setError(t('gardenLocation.lookupUnreachable'));
    } finally {
      setBusy(null);
    }
  };

  const useMyLocation = () => {
    setError('');
    if (!navigator.geolocation) {
      setError(t('gardenLocation.noLocationSupport'));
      return;
    }
    setBusy('locate');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPicked({
          label: t('gardenLocation.currentLocationLabel'),
          latitude: Number(pos.coords.latitude.toFixed(4)),
          longitude: Number(pos.coords.longitude.toFixed(4)),
        });
        setMatches(null);
        setBusy(null);
      },
      () => {
        setBusy(null);
        setError(t('gardenLocation.locationDenied'));
      },
      { timeout: 10_000, maximumAge: 30 * 60 * 1000 },
    );
  };

  const save = async () => {
    if (!picked) return;
    setError('');
    setBusy('save');
    try {
      const saved = await yardsService.update(yard.id, {
        label: picked.label,
        latitude: picked.latitude,
        longitude: picked.longitude,
        orientationDeg,
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gardenLocation.saveError'));
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">{t('gardenLocation.title', { yardName: yard.name })}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label={t('gardenLocation.close')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-600">
            {t('gardenLocation.description')}
          </p>

          {error && (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  search();
                }
              }}
              placeholder={t('gardenLocation.searchPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
            />
            <button
              type="button"
              onClick={search}
              disabled={busy !== null}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-green-500 px-3 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:bg-gray-400"
            >
              {busy === 'search' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )}
              {t('gardenLocation.find')}
            </button>
          </div>

          <button
            type="button"
            onClick={useMyLocation}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
          >
            {busy === 'locate' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Crosshair size={14} />
            )}
            {t('gardenLocation.useMyLocation')}
          </button>

          {matches && matches.length > 0 && (
            <ul className="divide-y rounded-lg border border-gray-200">
              {matches.map((m) => (
                <li key={`${m.latitude},${m.longitude}`}>
                  <button
                    type="button"
                    onClick={() =>
                      setPicked({
                        label: describe(m),
                        latitude: m.latitude,
                        longitude: m.longitude,
                      })
                    }
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-emerald-50"
                  >
                    <MapPin size={14} className="shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 truncate">{describe(m)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {picked && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                {t('gardenLocation.selected')}
              </p>
              <p className="text-sm font-semibold text-emerald-900">
                {picked.label ?? t('gardenLocation.chosenSpot')}
              </p>
              <p className="text-xs text-emerald-700">
                {picked.latitude.toFixed(4)}, {picked.longitude.toFixed(4)}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="yard-orientation" className="mb-1 block text-sm font-medium text-gray-700">
              {t('gardenLocation.orientationLabel')}
            </label>
            <select
              id="yard-orientation"
              value={orientationDeg}
              onChange={(e) => setOrientationDeg(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
            >
              {ORIENTATION_OPTIONS.map((o) => (
                <option key={o.deg} value={o.deg}>{o.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              {t('gardenLocation.orientationHint')}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!picked || busy !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:bg-gray-400"
          >
            {busy === 'save' && <Loader2 size={14} className="animate-spin" />}
            {t('gardenLocation.saveLocation')}
          </button>
        </div>
      </div>
    </div>
  );
};
