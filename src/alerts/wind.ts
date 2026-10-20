import type { Crop } from '../crops/schema.js';
import type { PlantingLike } from '../plantings/types.js';
import type { HourlyModel, HourlyWeather } from '../weather/hourly.js';
import { dayLabel, daysOf, modelsOf } from './days.js';
import { daysBetween } from './format.js';
import { cropIn, cropList, cropsInGround, toAlertCrop } from './in-ground.js';
import type { Alert, Param, ParamSet } from './types.js';

const MERIGNAC = 'Météo-France, fiche climatologique Bordeaux-Mérignac 1991-2020 (jours de rafales >= 16 m/s)';

/** Wind thresholds from agronomy 7: the Météo-France gust category, used for agronomy as an estimate. */
export const WIND_PARAMS = {
  gustKmh: { value: 58, unit: 'km/h', estimate: true, source: MERIGNAC },
  fromMonth: { value: 4, unit: 'mois', estimate: true },
  toMonth: { value: 10, unit: 'mois', estimate: true },
} satisfies ParamSet;
export type WindParams = Record<keyof typeof WIND_PARAMS, Param>;

/** Crops usually staked, whose stakes a gust can pull (agronomy 7; the list is an estimate). */
export const WIND_CROPS = { value: ['tomate', 'haricot'], estimate: true } as const;

export type WindInputs = {
  gustMaxKmh: number;
  month: number;
  fleece: boolean;
  models: HourlyModel[];
  params: WindParams;
};
export type WindAlert = Alert<'wind', 'rafales', WindInputs>;
/** `fleece`: a fleece or a cover is logged in the garden, so it needs weighing down. */
export type WindOptions = { today: string; fleece?: boolean; params?: WindParams };

function advice(stakedCrops: Crop[], fleece: boolean): string {
  if (stakedCrops.length > 0 && fleece) return `Vérifie les tuteurs (${cropList(stakedCrops)}) et leste les voiles.`;
  if (stakedCrops.length > 0) return `Vérifie les tuteurs (${cropList(stakedCrops)}).`;
  return 'Leste les voiles.';
}

/**
 * Agronomy 7: one alert per day, from today, with a gust at or above `gustKmh`, from April to
 * October, when a staked crop is in the ground or a fleece is out. No separate "wind dries the
 * soil" alert: ET0 already includes wind.
 */
export function windAlerts(
  hours: readonly HourlyWeather[],
  plantings: readonly PlantingLike[],
  crops: readonly Crop[],
  options: WindOptions,
): WindAlert[] {
  const params = options.params ?? WIND_PARAMS;
  const { today } = options;
  const fleece = options.fleece ?? false;
  return daysOf(hours).flatMap((d) => {
    const month = Number(d.date.slice(5, 7));
    if (d.date < today || d.gustMaxKmh === null || d.gustMaxKmh < params.gustKmh.value) return [];
    if (month < params.fromMonth.value || month > params.toMonth.value) return [];
    const stakedCrops = cropsInGround(plantings, crops, d.date)
      .filter((e) => cropIn(e.crop, WIND_CROPS.value))
      .map((e) => e.crop);
    if (stakedCrops.length === 0 && !fleece) return [];
    const alert: WindAlert = {
      kind: 'wind',
      level: 'rafales',
      date: d.date,
      daysAhead: daysBetween(today, d.date),
      crops: stakedCrops.map(toAlertCrop),
      reason: `Rafales à ${Math.round(d.gustMaxKmh)} km/h prévues ${dayLabel(d.date, today)}. ${advice(stakedCrops, fleece)}`,
      estimate: true,
      inputs: {
        gustMaxKmh: d.gustMaxKmh,
        month,
        fleece,
        models: modelsOf(hours.filter((h) => h.ts.startsWith(d.date)), ['wind_gusts_10m']),
        params,
      },
    };
    return [alert];
  });
}
