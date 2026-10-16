import { z } from 'zod';
import { fail, ok, type Result } from '../result.js';

export type DailyWeather = {
  date: string;
  tmin: number;
  tmax: number;
  precipMm: number;
  et0Mm: number;
  source: 'archive' | 'forecast';
};

/** Where to ask the weather for. `timezone` is an IANA name, e.g. `Europe/Paris`. */
export type WeatherLocation = {
  lat: number;
  lon: number;
  timezone: string;
};

export const WEATHER_UNAVAILABLE = 'Météo indisponible.';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const DAILY_VARS =
  'temperature_2m_min,temperature_2m_max,precipitation_sum,et0_fao_evapotranspiration';
const TIMEOUT_MS = 8000;

const numbers = z.array(z.number().nullable());
const payloadSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_min: numbers,
    temperature_2m_max: numbers,
    precipitation_sum: numbers,
    et0_fao_evapotranspiration: numbers,
  }),
});

function baseParams(location: WeatherLocation): URLSearchParams {
  return new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    daily: DAILY_VARS,
    timezone: location.timezone,
  });
}

function parseDaily(json: unknown, source: DailyWeather['source']): DailyWeather[] | null {
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return null;
  const d = parsed.data.daily;
  const days: DailyWeather[] = [];
  d.time.forEach((date, i) => {
    const tmin = d.temperature_2m_min[i];
    const tmax = d.temperature_2m_max[i];
    const precipMm = d.precipitation_sum[i];
    const et0Mm = d.et0_fao_evapotranspiration[i];
    if (tmin == null || tmax == null || precipMm == null || et0Mm == null) return;
    days.push({ date, tmin, tmax, precipMm, et0Mm, source });
  });
  return days;
}

async function request(
  fetchFn: typeof fetch,
  url: string,
  source: DailyWeather['source'],
): Promise<Result<DailyWeather[]>> {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[openmeteo] HTTP ${res.status} for ${url}`);
      return fail(WEATHER_UNAVAILABLE);
    }
    const days = parseDaily(await res.json(), source);
    if (!days) {
      console.error(`[openmeteo] unexpected payload shape for ${url}`);
      return fail(WEATHER_UNAVAILABLE);
    }
    return ok(days);
  } catch (error) {
    console.error(`[openmeteo] request failed for ${url}`, error);
    return fail(WEATHER_UNAVAILABLE);
  }
}

export function fetchForecast(
  fetchFn: typeof fetch,
  location: WeatherLocation,
): Promise<Result<DailyWeather[]>> {
  const params = baseParams(location);
  params.set('past_days', '7');
  params.set('forecast_days', '16');
  return request(fetchFn, `${FORECAST_URL}?${params}`, 'forecast');
}

export function fetchArchive(
  fetchFn: typeof fetch,
  location: WeatherLocation,
  from: string,
  to: string,
): Promise<Result<DailyWeather[]>> {
  const params = baseParams(location);
  params.set('start_date', from);
  params.set('end_date', to);
  return request(fetchFn, `${ARCHIVE_URL}?${params}`, 'archive');
}
