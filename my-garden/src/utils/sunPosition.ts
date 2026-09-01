// src/utils/sunPosition.ts
// Where the sun actually is in the sky, for a given place and moment —
// the standard NOAA solar position algorithm (the same equations behind
// NOAA's public solar calculator spreadsheet). Deterministic astronomy,
// no API call, no AI — this is the part of "where does the sun/shade fall"
// that has an exact right answer.

export interface SunPosition {
  /** Compass bearing the sun is in, 0-360, 0 = north, 90 = east. */
  azimuthDeg: number;
  /** Degrees above the horizon. Negative = below the horizon (night). */
  elevationDeg: number;
}

const deg2rad = (d: number) => (d * Math.PI) / 180;
const rad2deg = (r: number) => (r * 180) / Math.PI;
const normalizeDeg = (d: number) => ((d % 360) + 360) % 360;
/** Guards acos() against a ratio that drifted a hair past ±1 from float error. */
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * @param lat Latitude in degrees, north positive.
 * @param lon Longitude in degrees, east positive (matches how this app
 *   already stores garden coordinates).
 * @param date The moment to compute for (its UTC instant is what's used).
 */
export function solarPosition(lat: number, lon: number, date: Date): SunPosition {
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525.0;

  const L0 = normalizeDeg(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  const Mrad = deg2rad(M);
  const C =
    Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mrad) * 0.000289;

  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(deg2rad(omega));

  const meanObliq = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(deg2rad(omega));

  const declRad = Math.asin(Math.sin(deg2rad(obliqCorr)) * Math.sin(deg2rad(apparentLong)));

  const y = Math.tan(deg2rad(obliqCorr / 2)) ** 2;
  const eqTimeMinutes =
    4 *
    rad2deg(
      y * Math.sin(2 * deg2rad(L0)) -
        2 * e * Math.sin(Mrad) +
        4 * e * y * Math.sin(Mrad) * Math.cos(2 * deg2rad(L0)) -
        0.5 * y * y * Math.sin(4 * deg2rad(L0)) -
        1.25 * e * e * Math.sin(2 * Mrad),
    );

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = ((utcMinutes + eqTimeMinutes + 4 * lon) % 1440 + 1440) % 1440;

  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const haRad = deg2rad(hourAngle);
  const latRad = deg2rad(lat);

  const cosZenith = clamp(
    Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad),
    -1,
    1,
  );
  const zenithRad = Math.acos(cosZenith);
  const elevationDeg = 90 - rad2deg(zenithRad);

  const sinZenith = Math.sin(zenithRad);
  let azimuthDeg: number;
  if (Math.abs(sinZenith) < 1e-6) {
    // Sun (near) directly overhead or underfoot — azimuth is undefined;
    // north is as good a convention as any, and elevation already carries
    // the meaningful information at that point.
    azimuthDeg = 0;
  } else {
    const cosAz = clamp(
      (Math.sin(latRad) * Math.cos(zenithRad) - Math.sin(declRad)) / (Math.cos(latRad) * sinZenith),
      -1,
      1,
    );
    const azRad = Math.acos(cosAz);
    azimuthDeg = hourAngle > 0 ? normalizeDeg(rad2deg(azRad) + 180) : normalizeDeg(540 - rad2deg(azRad));
  }

  return { azimuthDeg, elevationDeg };
}

/** True when the sun is up at all — elevation above the horizon. */
export function isDaytime(pos: SunPosition): boolean {
  return pos.elevationDeg > 0;
}
