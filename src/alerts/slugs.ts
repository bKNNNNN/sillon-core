import type { Crop } from '../crops/schema.js';
import { addDays } from '../dates.js';
import type { PlantingLike } from '../plantings/types.js';
import { nightsOf, type HourlyModel, type HourlyWeather } from '../weather/hourly.js';
import { modelsOf } from './days.js';
import { daysBetween, nightSpan } from './format.js';
import { cropIn, cropList, cropsInGround, toAlertCrop } from './in-ground.js';
import type { Alert, Param, ParamSet } from './types.js';

const AHDB = 'AHDB, What conditions favour slugs, https://archive.ahdb.org.uk/knowledge-library/what-conditions-favour-slugs';

/** Slug thresholds from agronomy 8. Only the 5 to 20 °C activity range is sourced. */
export const SLUG_PARAMS = {
  rainMm: { value: 2, unit: 'mm', estimate: true },
  rainLookBackHours: { value: 48, unit: 'h', estimate: true },
  humidPct: { value: 90, unit: '%', estimate: true },
  humidHours: { value: 6, unit: 'h', estimate: true },
  mildMinC: { value: 5, unit: '°C', estimate: false, source: AHDB },
  mildMaxC: { value: 20, unit: '°C', estimate: false, source: AHDB },
  youngDays: { value: 21, unit: 'jours', estimate: true },
  repeatDays: { value: 3, unit: 'jours', estimate: true },
} satisfies ParamSet;
export type SlugParams = Record<keyof typeof SLUG_PARAMS, Param>;

/** Crops whose young plants slugs eat first (agronomy 8; the list is an estimate). "chou" covers the three cabbages. */
export const SLUG_CROPS = {
  value: ['salade', 'haricot', 'courgette', 'courge', 'concombre', 'chou-ete', 'chou-hiver', 'chou-chinois', 'epinard', 'betterave', 'basilic', 'fraise'],
  estimate: true,
} as const;

export type SlugInputs = {
  rain48Mm: number;
  humidHours: number;
  nightMeanC: number;
  wet: boolean;
  mild: boolean;
  models: HourlyModel[];
  params: SlugParams;
};
export type SlugAlert = Alert<'slugs', 'probable', SlugInputs>;
/** `lastAlertOn`: the night of the last slug alert already sent, so the repeat gap holds across runs. */
export type SlugOptions = { today: string; lastAlertOn?: string; params?: SlugParams };

const round1 = (v: number) => Math.round(v * 10) / 10;

function rainBefore(hours: readonly HourlyWeather[], night: string, lookBackHours: number): number {
  const end = Date.parse(`${night}T18:00Z`);
  const start = end - lookBackHours * 3_600_000;
  const inWindow = hours.filter((h) => {
    const t = Date.parse(`${h.ts}Z`);
    return t >= start && t < end;
  });
  return round1(inWindow.reduce((sum, h) => sum + (h.precipitation ?? 0), 0));
}

function isComplete(night: string, list: HourlyWeather[]): boolean {
  return list.length === 16 && list[0]!.ts === `${night}T18:00` && list[15]!.ts === `${addDays(night, 1)}T09:00`;
}

/**
 * Agronomy 8: slugs come out on a wet and mild night when young plants they like are in the
 * ground. Wet means enough rain in the 48 h before the night, or enough humid hours during it
 * (the forecast night stands for the spec's "last night"). At most one alert per `repeatDays`.
 */
export function slugAlerts(
  hours: readonly HourlyWeather[],
  plantings: readonly PlantingLike[],
  crops: readonly Crop[],
  options: SlugOptions,
): SlugAlert[] {
  const params = options.params ?? SLUG_PARAMS;
  const { today } = options;
  let last = options.lastAlertOn;
  const alerts: SlugAlert[] = [];
  for (const n of nightsOf(hours)) {
    if (n.night < today || !isComplete(n.night, n.hours)) continue;
    if (last !== undefined && daysBetween(last, n.night) < params.repeatDays.value) continue;
    const temps = n.hours.flatMap((h) => (h.temperature_2m === null ? [] : [h.temperature_2m]));
    const nightMeanC = round1(temps.reduce((a, b) => a + b, 0) / temps.length);
    const rain48Mm = rainBefore(hours, n.night, params.rainLookBackHours.value);
    const humidHours = n.hours.filter((h) => h.relative_humidity_2m !== null && h.relative_humidity_2m >= params.humidPct.value).length;
    const wet = rain48Mm >= params.rainMm.value || humidHours >= params.humidHours.value;
    const mild = nightMeanC >= params.mildMinC.value && nightMeanC <= params.mildMaxC.value;
    if (!wet || !mild) continue;
    const youngCrops = cropsInGround(plantings, crops, n.night)
      .filter((e) => cropIn(e.crop, SLUG_CROPS.value) && daysBetween(e.since, n.night) < params.youngDays.value)
      .map((e) => e.crop);
    if (youngCrops.length === 0) continue;
    last = n.night;
    const why = rain48Mm >= params.rainMm.value ? 'sol humide' : 'air très humide';
    alerts.push({
      kind: 'slugs',
      level: 'probable',
      date: n.night,
      daysAhead: daysBetween(today, n.night),
      crops: youngCrops.map(toAlertCrop),
      reason: `Sortie de limaces probable la nuit ${nightSpan(n.night, addDays(n.night, 1))} (${why}, nuit douce). Fais un tour à la tombée de la nuit autour des jeunes plants : ${cropList(youngCrops)}.`,
      estimate: true,
      inputs: {
        rain48Mm,
        humidHours,
        nightMeanC,
        wet,
        mild,
        models: modelsOf(n.hours, ['temperature_2m', 'relative_humidity_2m', 'precipitation']),
        params,
      },
    });
  }
  return alerts;
}
