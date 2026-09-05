// src/services/weather/climateWind.ts
// The prevailing wind direction on rainy days, per season — real history
// from Open-Meteo's archive (same provider as current conditions in
// forecast.ts), not a forecast stretched to cover the whole year and not a
// guess. This is what makes "year-round" rain-shelter reasoning in
// bestPlacement.ts honest: a roof only actually matters if wind-driven rain
// from that direction is something this location sees.

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

function readCache(lat: number, lon: number): Record<Season, number | null> | null {
  try {
    const raw = localStorage.getItem(cacheKey(lat, lon));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: number; data: Record<Season, number | null> };
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(lat: number, lon: number, data: Record<Season, number | null>): void {
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
}

/**
 * The prevailing wind direction on rainy days, per season, from actual
 * history at this location — cached locally for `CACHE_TTL_MS` since it's a
 * multi-year daily pull and climatology doesn't meaningfully change day to
 * day. A season with no rainy days in the sample (or a request failure)
 * comes back null for that season; callers should fall back to a
 * direction-agnostic rain check rather than guessing.
 */
export async function getSeasonalRainWindDirections(
  latitude: number,
  longitude: number,
): Promise<Record<Season, number | null>> {
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
      daily: 'precipitation_sum,wind_direction_10m_dominant',
      timezone: 'auto',
    },
    timeout: 20_000,
  });

  const daily: ArchiveDaily = data?.daily ?? {};
  const dates = daily.time ?? [];

  const bySeasonDirections: Record<Season, number[]> = {
    spring: [], summer: [], fall: [], winter: [],
  };

  dates.forEach((date, i) => {
    const precip = daily.precipitation_sum?.[i] ?? 0;
    const direction = daily.wind_direction_10m_dominant?.[i];
    if (precip < RAIN_DAY_THRESHOLD_MM || direction == null) return;
    const season = SEASON_BY_MONTH[Number(date.slice(5, 7))];
    if (season) bySeasonDirections[season].push(direction);
  });

  const result: Record<Season, number | null> = {
    spring: circularMean(bySeasonDirections.spring),
    summer: circularMean(bySeasonDirections.summer),
    fall: circularMean(bySeasonDirections.fall),
    winter: circularMean(bySeasonDirections.winter),
  };

  writeCache(latitude, longitude, result);
  return result;
}
