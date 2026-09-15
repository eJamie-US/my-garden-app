// src/services/weather/climateWind.ts
// Per-season climate history from Open-Meteo's archive (same provider as
// current conditions in forecast.ts), not a forecast stretched to cover the
// whole year and not a guess:
//   - the prevailing wind direction on rainy days, which is what makes
//     "year-round" rain-shelter reasoning in bestPlacement.ts honest — a
//     roof only actually matters if wind-driven rain from that direction is
//     something this location sees.
//   - average wind speed across ALL days (not just rainy ones), which lets
//     bestPlacement.ts score general wind exposure for wind-fragile plants.
// Both come from the same daily archive call — no extra request, no extra
// caching logic, just one more field read out of the same response.

import axios from 'axios';
import type { Season } from '../../utils/sunExposure';

const ARCHIVE_API =
  import.meta.env.VITE_OPEN_METEO_ARCHIVE_API_URL || 'https://archive-api.open-meteo.com/v1';

const YEARS_OF_HISTORY = 3;
// The archive lags behind "today" by several days — back off further than
// that so the request never asks for a date it doesn't have yet.
const ARCHIVE_LAG_DAYS = 10;
// A day only counts toward the average above this much precipitation — a
// trace of drizzle blowing in from a one-off direction shouldn't skew a
// whole season's prevailing direction.
const RAIN_DAY_THRESHOLD_MM = 1;

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // climatology barely shifts month to month
const CACHE_PREFIX = 'garden:seasonal-rain-wind:';

const SEASON_BY_MONTH: Record<number, Season> = {
  12: 'winter', 1: 'winter', 2: 'winter',
  3: 'spring', 4: 'spring', 5: 'spring',
  6: 'summer', 7: 'summer', 8: 'summer',
  9: 'fall', 10: 'fall', 11: 'fall',
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Circular mean of a set of compass bearings — a plain average breaks near
 *  due north (350° and 10° should average to 0°, not 180°). */
function circularMean(anglesDeg: number[]): number | null {
  if (anglesDeg.length === 0) return null;
  const sumSin = anglesDeg.reduce((s, a) => s + Math.sin((a * Math.PI) / 180), 0);
  const sumCos = anglesDeg.reduce((s, a) => s + Math.cos((a * Math.PI) / 180), 0);
  if (sumSin === 0 && sumCos === 0) return null;
  return ((Math.atan2(sumSin, sumCos) * 180) / Math.PI + 360) % 360;
}

function cacheKey(lat: number, lon: number): string {
  return `${CACHE_PREFIX}${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export interface SeasonalClimate {
  /** Circular-mean wind direction on rainy days only — null where there's
   *  no climatology to reason from (see the module header). */
  rainWindDirection: number | null;
  /** Mean wind speed (km/h) across every day in the season, rainy or not —
   *  null under the same no-data conditions as rainWindDirection. */
  avgWindSpeedKmh: number | null;
}

function readCache(lat: number, lon: number): Record<Season, SeasonalClimate> | null {
  try {
    const raw = localStorage.getItem(cacheKey(lat, lon));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: number; data: Record<Season, SeasonalClimate> };
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(lat: number, lon: number, data: Record<Season, SeasonalClimate>): void {
  try {
    localStorage.setItem(cacheKey(lat, lon), JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch {
    // Storage full or unavailable (private browsing) — caching is purely an
    // optimization, so just skip it rather than fail the caller.
  }
}

interface ArchiveDaily {
  time?: string[];
  precipitation_sum?: number[];
  wind_direction_10m_dominant?: number[];
  wind_speed_10m_mean?: number[];
}

/**
 * Per-season climate history at this location — rainy-day wind direction
 * (for rain-shelter reasoning) and average wind speed (for general wind
 * exposure) — from one multi-year daily archive pull, cached locally for
 * `CACHE_TTL_MS` since climatology doesn't meaningfully change day to day.
 * A season with no rainy days in the sample (or a request failure) comes
 * back with both fields null; callers should fall back to a direction/
 * speed-agnostic check rather than guessing.
 */
export async function getSeasonalClimate(
  latitude: number,
  longitude: number,
): Promise<Record<Season, SeasonalClimate>> {
  const cached = readCache(latitude, longitude);
  if (cached) return cached;

  const end = new Date();
  end.setDate(end.getDate() - ARCHIVE_LAG_DAYS);
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - YEARS_OF_HISTORY);

  const { data } = await axios.get(`${ARCHIVE_API}/archive`, {
    params: {
      latitude,
      longitude,
      start_date: isoDate(start),
      end_date: isoDate(end),
      daily: 'precipitation_sum,wind_direction_10m_dominant,wind_speed_10m_mean',
      timezone: 'auto',
    },
    timeout: 20_000,
  });

  const daily: ArchiveDaily = data?.daily ?? {};
  const dates = daily.time ?? [];

  const bySeasonRainyDirections: Record<Season, number[]> = {
    spring: [], summer: [], fall: [], winter: [],
  };
  const bySeasonWindSpeeds: Record<Season, number[]> = {
    spring: [], summer: [], fall: [], winter: [],
  };

  dates.forEach((date, i) => {
    const season = SEASON_BY_MONTH[Number(date.slice(5, 7))];
    if (!season) return;

    const speed = daily.wind_speed_10m_mean?.[i];
    if (speed != null) bySeasonWindSpeeds[season].push(speed);

    const precip = daily.precipitation_sum?.[i] ?? 0;
    const direction = daily.wind_direction_10m_dominant?.[i];
    if (precip < RAIN_DAY_THRESHOLD_MM || direction == null) return;
    bySeasonRainyDirections[season].push(direction);
  });

  const average = (values: number[]): number | null =>
    values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

  const seasons: Season[] = ['spring', 'summer', 'fall', 'winter'];
  const result = Object.fromEntries(
    seasons.map((season) => [
      season,
      {
        rainWindDirection: circularMean(bySeasonRainyDirections[season]),
        avgWindSpeedKmh: average(bySeasonWindSpeeds[season]),
      },
    ]),
  ) as Record<Season, SeasonalClimate>;

  writeCache(latitude, longitude, result);
  return result;
}
