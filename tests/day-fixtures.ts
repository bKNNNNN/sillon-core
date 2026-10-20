import { addDays, type Crop, type HourlyWeather, type PlantingLike } from '../src/index.js';
import { hour } from './hourly-fixtures.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** The 24 hours of `date` (00:00 to 23:00); `shape` sets each hour's values from its hour of day. */
export function day(date: string, shape: (h: number) => Partial<HourlyWeather> & { t?: number } = () => ({})): HourlyWeather[] {
  return Array.from({ length: 24 }, (_, h) => {
    const { t, ...extra } = shape(h);
    return hour(`${date}T${pad(h)}:00`, t ?? 15, extra);
  });
}

/** Consecutive days from `from`, each shaped by its index and hour of day. */
export function days(from: string, count: number, shape: (i: number, h: number) => Partial<HourlyWeather> & { t?: number }): HourlyWeather[] {
  return Array.from({ length: count }, (_, i) => day(addDays(from, i), (h) => shape(i, h))).flat();
}

export const crop = (id: string, name: string, extra: Partial<Crop> = {}): Crop => ({
  id,
  name,
  family: 'f',
  frostSensitive: false,
  goodCompanions: [],
  badCompanions: [],
  ...extra,
});

export const planting = (species: string, extra: Partial<PlantingLike> = {}): PlantingLike => ({
  species,
  sownOn: '2026-05-01',
  method: 'direct',
  status: 'active',
  ...extra,
});
