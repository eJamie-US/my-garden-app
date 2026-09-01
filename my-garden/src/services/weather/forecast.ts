// src/services/weather/forecast.ts
// Open-Meteo: current conditions + 14 trailing days + today and the next 9.
// generateCareItems() reads .past and .upcoming, so both must be populated.

import axios from 'axios';
import type { DailyWeather, WeatherData } from '../../types';

const OPEN_METEO_API =
  import.meta.env.VITE_OPEN_METEO_API_URL || 'https://api.open-meteo.com/v1';

export const PAST_DAYS = 14;
export const FORECAST_DAYS = 10;

interface DailyBlock {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
  weather_code?: number[];
}

function toDaily(block: DailyBlock | undefined): DailyWeather[] {
  const dates = block?.time ?? [];
  return dates.map((date, i) => {
    const code = block?.weather_code?.[i] ?? 0;
    return {
      date,
      tempMax: block?.temperature_2m_max?.[i] ?? 0,
      tempMin: block?.temperature_2m_min?.[i] ?? 0,
      precipitation: block?.precipitation_sum?.[i] ?? 0,
      weatherCode: code,
      condition: getWeatherCondition(code),
      icon: getWeatherIcon(code),
    };
  });
}

export const weatherService = {
  async getWeather(latitude: number, longitude: number): Promise<WeatherData> {
    try {
      const { data } = await axios.get(`${OPEN_METEO_API}/forecast`, {
        params: {
          latitude,
          longitude,
          current:
            'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code',
          daily:
            'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
          past_days: PAST_DAYS,
          forecast_days: FORECAST_DAYS,
          timezone: 'auto',
        },
        timeout: 15_000,
      });

      const current = data?.current ?? {};
      const code = current.weather_code ?? 0;

      // One daily array covers past_days + forecast_days; split it on today.
      const all = toDaily(data?.daily);
      const today = new Date().toISOString().slice(0, 10);
      let splitAt = all.findIndex((d) => d.date >= today);
      if (splitAt < 0) splitAt = Math.max(0, all.length - FORECAST_DAYS);

      return {
        temperature: current.temperature_2m ?? 0,
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        precipitation: current.precipitation ?? 0,
        condition: getWeatherCondition(code),
        icon: getWeatherIcon(code),
        timestamp: current.time ?? new Date().toISOString(),
        past: all.slice(0, splitAt),
        upcoming: all.slice(splitAt),
      };
    } catch (error) {
      console.error('Weather API error:', error);
      throw new Error('Failed to fetch weather');
    }
  },

  /**
   * Your garden's coordinates if VITE_GARDEN_LAT / VITE_GARDEN_LON are set —
   * a garden doesn't move, and this avoids the browser location prompt, which
   * Safari refuses on plain http:// anyway. Falls back to geolocation.
   */
  async getWeatherHere(): Promise<WeatherData> {
    const lat = Number(import.meta.env.VITE_GARDEN_LAT);
    const lon = Number(import.meta.env.VITE_GARDEN_LON);
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
      return await weatherService.getWeather(lat, lon);
    }

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation unavailable'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 10_000,
        maximumAge: 30 * 60 * 1000,
      });
    });
    return await weatherService.getWeather(
      position.coords.latitude,
      position.coords.longitude,
    );
  },
};

/** Total rainfall over the trailing `days` days — the main watering input. */
export function recentRainfall(weather: WeatherData, days = 7): number {
  return weather.past
    .slice(-days)
    .reduce((sum, day) => sum + (day.precipitation || 0), 0);
}

export function hotDaysAhead(weather: WeatherData, threshold = 29, days = 7): number {
  return weather.upcoming.slice(0, days).filter((d) => d.tempMax >= threshold).length;
}

export function nextFrost(weather: WeatherData, threshold = 2): DailyWeather | undefined {
  return weather.upcoming.find((d) => d.tempMin <= threshold);
}

export function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Foggy with rime',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Slight rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Slight snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
    85: 'Snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
  };
  return conditions[code] || 'Unknown';
}

export function getWeatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  if (code <= 82) return '🌧️';
  return '⛅';
}
