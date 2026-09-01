// src/components/GardenLocationSettings.tsx
// Search a place name (Open-Meteo geocoding, no API key) or use the browser's
// location, then save the coordinates against the user.

import { useState } from 'react';
import { Loader2, MapPin, Crosshair, Search, X } from 'lucide-react';
import {
  userSettingsService,
  type GardenLocation,
} from '../services/supabase/userSettings';

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
const ORIENTATION_OPTIONS: { label: string; deg: number }[] = [
  { label: 'North (up in the photo)', deg: 0 },
  { label: 'Northeast', deg: 45 },
  { label: 'East', deg: 90 },
  { label: 'Southeast', deg: 135 },
  { label: 'South', deg: 180 },
  { label: 'Southwest', deg: 225 },
  { label: 'West', deg: 270 },
  { label: 'Northwest', deg: 315 },
];

interface GardenLocationSettingsProps {
  userId: string;
  current: GardenLocation | null;
  onSaved: (garden: GardenLocation) => void;
  onClose: () => void;
}

function describe(m: Match) {
  return [m.name, m.admin1, m.country].filter(Boolean).join(', ');
}

export const GardenLocationSettings = ({
  userId,
  current,
  onSaved,
  onClose,
}: GardenLocationSettingsProps) => {
  const [query, setQuery] = useState(current?.label ?? '');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [picked, setPicked] = useState<Omit<GardenLocation, 'orientationDeg'> | null>(current);
  const [orientationDeg, setOrientationDeg] = useState(current?.orientationDeg ?? 0);
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
        `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(name)}`,
      );
      const data = await res.json();
      const results: Match[] = data?.results ?? [];
      setMatches(results);
      if (!results.length) setError(`No place found for “${name}”.`);
    } catch {
      setError("Couldn't reach the place lookup. Check your connection.");
    } finally {
      setBusy(null);
    }
  };

  const useMyLocation = () => {
    setError('');
    if (!navigator.geolocation) {
      setError('This browser has no location support. Search for a place instead.');
      return;
    }
    setBusy('locate');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPicked({
          label: 'My current location',
          latitude: Number(pos.coords.latitude.toFixed(4)),
          longitude: Number(pos.coords.longitude.toFixed(4)),
        });
        setMatches(null);
        setBusy(null);
      },
      () => {
        setBusy(null);
        setError(
          'The browser refused location access. Search for a nearby town instead — close enough for weather.',
        );
      },
      { timeout: 10_000, maximumAge: 30 * 60 * 1000 },
    );
  };

  const save = async () => {
    if (!picked) return;
    setError('');
    setBusy('save');
    try {
      const saved = await userSettingsService.saveGardenLocation(userId, { ...picked, orientationDeg });
      if (saved.garden) onSaved(saved.garden);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the location.');
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="text-lg font-bold">Where is your garden?</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close location settings"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-600">
            Used for rainfall, heat and frost in your care plan. A nearby town is
            close enough.
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
              placeholder="Town, city or postcode"
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
              Find
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
            Use my current location
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
                Selected
              </p>
              <p className="text-sm font-semibold text-emerald-900">
                {picked.label ?? 'Chosen spot'}
              </p>
              <p className="text-xs text-emerald-700">
                {picked.latitude.toFixed(4)}, {picked.longitude.toFixed(4)}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="yard-orientation" className="mb-1 block text-sm font-medium text-gray-700">
              Which way is up in your yard photo?
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
              Used for the sun/shade exposure estimate — it's the only way to know which
              direction the sun crosses your yard photo. Doesn't need to be exact.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!picked || busy !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:bg-gray-400"
          >
            {busy === 'save' && <Loader2 size={14} className="animate-spin" />}
            Save location
          </button>
        </div>
      </div>
    </div>
  );
};
