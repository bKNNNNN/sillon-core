import { addDays, type Crop, type DailyWeather, type PlantingLike } from '../src/index.js';

const FAO = 'FAO-56';

const crop = (id: string, name: string, extra: Partial<Crop>): Crop => ({
  id,
  name,
  family: 'f',
  frostSensitive: false,
  goodCompanions: [],
  badCompanions: [],
  ...extra,
});

export const tomate = crop('tomate', 'Tomate', {
  kc: { value: { initial: 0.6, mid: 1.15, late: 0.8 }, source: FAO },
  kcStages: { value: { method: 'fao56-table11', initDays: 30, devDays: 40, midDays: 40, lateDays: 25 }, source: FAO },
  rootDepthM: { value: 0.7, source: FAO },
  depletionP: { value: 0.4, source: FAO },
});
export const salade = crop('salade', 'Salade', {
  kc: { value: { initial: 0.7, mid: 1.0, late: 0.95 }, source: FAO },
  kcStages: { value: { method: 'fao56-table11', initDays: 20, devDays: 30, midDays: 15, lateDays: 10 }, source: FAO },
  rootDepthM: { value: 0.3, source: FAO },
  depletionP: { value: 0.3, source: FAO },
});
export const fraise = crop('fraise', 'Fraise', {
  kc: { value: { initial: 0.4, mid: 0.85, late: 0.75 }, source: FAO },
  kcStages: { value: { method: 'gdd-fraction', devFrom: 0.2, midFrom: 0.5, lateFrom: 0.9 }, estimate: true },
  gdd: { value: 1000, estimate: true },
  tBaseC: { value: 5, estimate: true },
  rootDepthM: { value: 0.2, source: FAO },
  depletionP: { value: 0.2, source: FAO },
});
/** A crop with no water data at all. */
export const ail = crop('ail', 'Ail', {});

export const planting = (species: string, extra: Partial<PlantingLike> = {}): PlantingLike => ({
  species,
  sownOn: '2026-04-15',
  method: 'bought',
  status: 'active',
  ...extra,
});

export type DayShape = { rain?: number; et0?: number; tmin?: number; tmax?: number; source?: DailyWeather['source'] };

/** Consecutive days from `first`: 5 mm of ET0, no rain, 15 to 25 °C, unless a shape says otherwise. */
export function weather(first: string, shapes: DayShape[]): DailyWeather[] {
  return shapes.map((s, i) => ({
    date: addDays(first, i),
    tmin: s.tmin ?? 15,
    tmax: s.tmax ?? 25,
    precipMm: s.rain ?? 0,
    et0Mm: s.et0 ?? 5,
    source: s.source ?? 'archive',
  }));
}

export const dry = (n: number, extra: DayShape = {}): DayShape[] => Array.from({ length: n }, () => ({ ...extra }));
