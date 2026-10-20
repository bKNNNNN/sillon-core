import { z } from 'zod';
import { addDays } from '../dates.js';
import { fail, ok, type Result } from '../result.js';
import { WEATHER_UNAVAILABLE, type WeatherLocation } from './openmeteo.js';

/** Hourly Open-Meteo variables the alerts read (frost, mildew, slugs, heat, wind, soil). */
export const HOURLY_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'cloud_cover',
  'cloud_cover_low',
  'wind_speed_10m',
  'wind_gusts_10m',
  'soil_temperature_6cm',
  'soil_temperature_18cm',
  'precipitation',
] as const;
export type HourlyVar = (typeof HOURLY_VARS)[number];

/**
 * Models in order of preference: Météo-France AROME 1.5 km, then AROME 2.5 km (it has the total
 * cloud cover that the 1.5 km grid lacks), then ARPEGE Europe (4 days), then Open-Meteo's default
 * blend, which is the only one with soil temperature and covers the last forecast days.
 */
export const HOURLY_MODELS = [
  'meteofrance_arome_france_hd',
  'meteofrance_arome_france',
  'meteofrance_arpege_europe',
  'best_match',
] as const;
export type HourlyModel = (typeof HOURLY_MODELS)[number];

/**
 * One hour, in the local time of the requested time zone (`YYYY-MM-DDTHH:mm`). Open-Meteo keeps
 * one UTC offset for the whole series, so the hours after a daylight-saving change drift by one.
 */
export type HourlyWeather = { ts: string } & Record<HourlyVar, number | null> & {
    /** The model that gave `temperature_2m`, the variable every alert reads. */
    model: HourlyModel;
    /** The model each non-null variable came from. */
    modelOf: Partial<Record<HourlyVar, HourlyModel>>;
  };

export type HourlyOptions = { pastDays?: number; forecastDays?: number };

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 8000;

const payloadSchema = z.object({
  hourly: z.object({ time: z.array(z.string()) }).catchall(z.array(z.number().nullable())),
});
type Columns = Record<string, (number | null)[]>;

function pick(columns: Columns, variable: HourlyVar, i: number): [number, HourlyModel] | null {
  for (const model of HOURLY_MODELS) {
    const value = columns[`${variable}_${model}`]?.[i];
    if (value != null) return [value, model];
  }
  return null;
}

function hourAt(columns: Columns, ts: string, i: number): HourlyWeather | null {
  const values = {} as Record<HourlyVar, number | null>;
  const modelOf: Partial<Record<HourlyVar, HourlyModel>> = {};
  for (const variable of HOURLY_VARS) {
    const found = pick(columns, variable, i);
    values[variable] = found ? found[0] : null;
    if (found) modelOf[variable] = found[1];
  }
  const model = modelOf.temperature_2m;
  if (!model) return null;
  return { ts, ...values, model, modelOf };
}

function parseHourly(json: unknown): HourlyWeather[] | null {
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return null;
  const { time, ...rest } = parsed.data.hourly;
  const columns = rest as Columns;
  if (Object.values(columns).some((column) => column.length !== time.length)) return null;
  return time.map((ts, i) => hourAt(columns, ts, i)).filter((h): h is HourlyWeather => h !== null);
}

/** Hourly weather for the alerts: by default 7 past days (look-back rules) and 7 forecast days. */
export async function fetchHourly(
  fetchFn: typeof fetch,
  location: WeatherLocation,
  options: HourlyOptions = {},
): Promise<Result<HourlyWeather[]>> {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    hourly: HOURLY_VARS.join(','),
    models: HOURLY_MODELS.join(','),
    timezone: location.timezone,
    past_days: String(options.pastDays ?? 7),
    forecast_days: String(options.forecastDays ?? 7),
  });
  const url = `${FORECAST_URL}?${params}`;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[openmeteo] HTTP ${res.status} for ${url}`);
      return fail(WEATHER_UNAVAILABLE);
    }
    const hours = parseHourly(await res.json());
    if (!hours) {
      console.error(`[openmeteo] unexpected hourly payload shape for ${url}`);
      return fail(WEATHER_UNAVAILABLE);
    }
    return ok(hours);
  } catch (error) {
    console.error(`[openmeteo] hourly request failed for ${url}`, error);
    return fail(WEATHER_UNAVAILABLE);
  }
}

/** The hours of one night, from 18:00 on `night` to 09:00 the next morning. */
export type Night = { night: string; hours: HourlyWeather[] };

const NIGHT_START = 18;
const NIGHT_END = 9;

function nightOf(ts: string): string | null {
  const date = ts.slice(0, 10);
  const h = Number(ts.slice(11, 13));
  if (h >= NIGHT_START) return date;
  if (h <= NIGHT_END) return addDays(date, -1);
  return null;
}

/** Groups hours into nights keyed by the evening date; daytime hours (10:00 to 17:00) are left out. */
export function nightsOf(hours: readonly HourlyWeather[]): Night[] {
  const byNight = new Map<string, HourlyWeather[]>();
  for (const h of hours) {
    const key = nightOf(h.ts);
    if (key) byNight.set(key, [...(byNight.get(key) ?? []), h]);
  }
  return [...byNight.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([night, list]) => ({ night, hours: [...list].sort((a, b) => a.ts.localeCompare(b.ts)) }));
}
