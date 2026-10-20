import { addDays, type HourlyWeather } from '../src/index.js';

/** One hour of weather, AROME HD everywhere, with optional overrides. */
export function hour(ts: string, temperature: number, extra: Partial<HourlyWeather> = {}): HourlyWeather {
  return {
    ts,
    model: 'meteofrance_arome_france_hd',
    modelOf: { temperature_2m: 'meteofrance_arome_france_hd' },
    temperature_2m: temperature,
    relative_humidity_2m: 90,
    dew_point_2m: temperature - 1,
    cloud_cover: 80,
    cloud_cover_low: 50,
    wind_speed_10m: 15,
    wind_gusts_10m: 25,
    soil_temperature_6cm: 8,
    soil_temperature_18cm: 9,
    precipitation: 0,
    ...extra,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export type NightShape = {
  /** Night minimum, reached at 05:00. */
  tmin: number;
  /** Cloud cover from 00:00 to 06:00. */
  cloud?: number;
  /** Wind speed from 00:00 to 06:00. */
  wind?: number;
};

/** The 16 hours of the night of `evening` (18:00 to 09:00), warm at the edges and coldest at 05:00. */
export function night(evening: string, shape: NightShape): HourlyWeather[] {
  const next = addDays(evening, 1);
  const stamps = [18, 19, 20, 21, 22, 23].map((h) => `${evening}T${pad(h)}:00`).concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((h) => `${next}T${pad(h)}:00`));
  return stamps.map((ts) => {
    const h = Number(ts.slice(11, 13));
    const temperature = h === 5 ? shape.tmin : shape.tmin + 3;
    const core = ts.startsWith(next) && h <= 6;
    return hour(ts, temperature, {
      cloud_cover: core ? (shape.cloud ?? 80) : 90,
      wind_speed_10m: core ? (shape.wind ?? 15) : 20,
    });
  });
}
