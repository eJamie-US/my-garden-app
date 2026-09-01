import { describe, it, expect } from 'vitest';
import { solarPosition, isDaytime } from './sunPosition';

// Portland, OR — used elsewhere in this repo's sample data (VITE_GARDEN_LAT/LON).
const LAT = 45.5152;
const LON = -122.6784;

/** Scans a UTC time window in `stepMinutes` increments and returns the max elevation found. */
function maxElevationOnDay(lat: number, lon: number, dateUTC: string, stepMinutes = 5): number {
  const start = new Date(`${dateUTC}T00:00:00Z`);
  let max = -90;
  for (let m = 0; m < 24 * 60; m += stepMinutes) {
    const t = new Date(start.getTime() + m * 60_000);
    const { elevationDeg } = solarPosition(lat, lon, t);
    if (elevationDeg > max) max = elevationDeg;
  }
  return max;
}

describe('solarPosition', () => {
  it('keeps azimuth in [0, 360) and elevation in [-90, 90]', () => {
    const samples = [
      new Date('2026-01-15T12:00:00Z'),
      new Date('2026-06-21T20:00:00Z'),
      new Date('2026-12-21T04:00:00Z'),
      new Date('2026-03-20T15:30:00Z'),
    ];
    for (const t of samples) {
      const { azimuthDeg, elevationDeg } = solarPosition(LAT, LON, t);
      expect(azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(azimuthDeg).toBeLessThan(360);
      expect(elevationDeg).toBeGreaterThanOrEqual(-90);
      expect(elevationDeg).toBeLessThanOrEqual(90);
    }
  });

  it('is below the horizon at 3am local (well before dawn) in the mid-latitudes', () => {
    // Portland is UTC-7 in June (PDT) — 3am local is ~10:00 UTC.
    const pos = solarPosition(LAT, LON, new Date('2026-06-15T10:00:00Z'));
    expect(isDaytime(pos)).toBe(false);
    expect(pos.elevationDeg).toBeLessThan(0);
  });

  it('is above the horizon at local solar noon', () => {
    // ~19:20 UTC is close to solar noon at this longitude.
    const pos = solarPosition(LAT, LON, new Date('2026-06-15T19:20:00Z'));
    expect(isDaytime(pos)).toBe(true);
    expect(pos.elevationDeg).toBeGreaterThan(40);
  });

  // The sun's max elevation at solar noon has a simple, well-known closed
  // form: 90° - |latitude - solar declination|. Declination is ~+23.44° at
  // the June solstice and ~-23.44° at the December solstice — this is an
  // independent check on the whole equation-of-time/declination pipeline,
  // not just "the code agrees with itself".
  it('matches the known noon-elevation formula at the June solstice (declination ≈ +23.44°)', () => {
    const max = maxElevationOnDay(LAT, LON, '2026-06-21');
    const expected = 90 - Math.abs(LAT - 23.44);
    expect(max).toBeGreaterThan(expected - 1.5);
    expect(max).toBeLessThan(expected + 1.5);
  });

  it('matches the known noon-elevation formula at the December solstice (declination ≈ -23.44°)', () => {
    const max = maxElevationOnDay(LAT, LON, '2026-12-21');
    const expected = 90 - Math.abs(LAT - -23.44);
    expect(max).toBeGreaterThan(expected - 1.5);
    expect(max).toBeLessThan(expected + 1.5);
  });

  it('sits roughly in the east in the morning and the west in the afternoon (northern mid-latitudes)', () => {
    const morning = solarPosition(LAT, LON, new Date('2026-06-15T14:00:00Z')); // ~7am local
    const afternoon = solarPosition(LAT, LON, new Date('2026-06-16T02:00:00Z')); // ~7pm local
    expect(morning.azimuthDeg).toBeGreaterThan(45);
    expect(morning.azimuthDeg).toBeLessThan(135);
    expect(afternoon.azimuthDeg).toBeGreaterThan(225);
    expect(afternoon.azimuthDeg).toBeLessThan(315);
  });
});
