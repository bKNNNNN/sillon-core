import type { Crop } from '../crops/schema.js';
import type { PlantingLike } from '../plantings/types.js';
import { nightsOf, type HourlyModel, type HourlyWeather } from '../weather/hourly.js';
import { dayLabel, daysOf, modelsOf, runsOf } from './days.js';
import { celsius, daysBetween } from './format.js';
import { cropIn, cropList, cropsInGround, toAlertCrop } from './in-ground.js';
import type { Alert, Param, ParamSet } from './types.js';

const MERIGNAC = 'Météo-France, fiche climatologique Bordeaux-Mérignac 1991-2020 (catégorie de jours)';
const UMD = 'J. Brust, University of Maryland, via University of Delaware Weekly Crop Update, https://sites.udel.edu/weeklycropupdate/?p=4489 (75 °F)';
const BOLTING = 'University of Delaware Weekly Crop Update, Bolting in spring planted vegetables, https://sites.udel.edu/weeklycropupdate/?p=22287 (80 °F)';

/** Heat thresholds from agronomy 6. A reporting category used for agronomy, or a run length, is an estimate. */
export const HEAT_PARAMS = {
  heatDayC: { value: 30, unit: '°C', estimate: true, source: MERIGNAC },
  caniculeC: { value: 35, unit: '°C', estimate: true },
  hotNightC: { value: 24, unit: '°C', estimate: false, source: UMD },
  fruitSetNights: { value: 3, unit: 'nuits', estimate: true },
  tomatoFloweringAfterDays: { value: 30, unit: 'jours', estimate: true },
  boltingC: { value: 27, unit: '°C', estimate: false, source: BOLTING },
  boltingDays: { value: 3, unit: 'jours', estimate: true },
} satisfies ParamSet;
export type HeatParams = Record<keyof typeof HEAT_PARAMS, Param>;

/** Crops each heat warning concerns: tomato fruit set, bolting of long-day leaf crops (agronomy 6). */
export const HEAT_CROPS = { fruitSet: ['tomate'], bolting: ['salade', 'epinard'] } as const;

/** One day: its maximum, and the minimum of the night that starts that evening (null when cut short). */
export type HeatDay = {
  date: string;
  tmaxC: number | null;
  nightMinC: number | null;
  heatDay: boolean;
  canicule: boolean;
  bolting: boolean;
  hotNight: boolean | null;
};

export type HeatLevel = 'canicule' | 'nouaison' | 'montaison';
export type HeatInputs = {
  /** First and last date of the run (for nights, the evening dates). */
  from: string;
  to: string;
  days: number;
  /** Highest maximum of the run, or for hot nights the warmest night minimum. */
  peakC: number;
  models: HourlyModel[];
  params: HeatParams;
};
export type HeatAlert = Alert<'heat', HeatLevel, HeatInputs>;
export type HeatOptions = { today: string; params?: HeatParams };

const LEVEL_ORDER: HeatLevel[] = ['canicule', 'nouaison', 'montaison'];

function completeNight(night: string, hours: HourlyWeather[]): boolean {
  return hours.length === 16 && hours[0]!.ts === `${night}T18:00` && hours[15]!.ts.endsWith('T09:00');
}

/** Every day in the hours, past days included so a run that started before today still counts. */
export function assessHeatDays(hours: readonly HourlyWeather[], options: HeatOptions): HeatDay[] {
  const params = options.params ?? HEAT_PARAMS;
  const nightMins = new Map<string, number>();
  for (const n of nightsOf(hours)) {
    const temps = n.hours.flatMap((h) => (h.temperature_2m === null ? [] : [h.temperature_2m]));
    if (completeNight(n.night, n.hours) && temps.length === n.hours.length) nightMins.set(n.night, Math.min(...temps));
  }
  return daysOf(hours).map((d) => {
    const tmax = d.tmaxC;
    const nightMinC = nightMins.get(d.date) ?? null;
    return {
      date: d.date,
      tmaxC: tmax,
      nightMinC,
      heatDay: tmax !== null && tmax >= params.heatDayC.value,
      canicule: tmax !== null && tmax >= params.caniculeC.value,
      bolting: tmax !== null && tmax >= params.boltingC.value,
      hotNight: nightMinC === null ? null : nightMinC >= params.hotNightC.value,
    };
  });
}

/** The date a run alerts on: its `needed`-th day, or today when that day is past and the run goes on. */
function alertDate(run: HeatDay[], needed: number, today: string): string | null {
  if (run.length < needed) return null;
  const last = run[run.length - 1]!.date;
  if (last < today) return null;
  const reached = run[needed - 1]!.date;
  return reached < today ? today : reached;
}

const fromLabel = (date: string, today: string) => {
  const label = dayLabel(date, today);
  return label === "aujourd'hui" ? "à partir d'aujourd'hui" : `à partir de ${label}`;
};
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type RunRule = {
  level: HeatLevel;
  test: (d: HeatDay) => boolean;
  needed: (p: HeatParams) => number;
  peak: (run: HeatDay[]) => number;
  crops: (inGround: { crop: Crop; since: string }[], date: string, p: HeatParams) => Crop[];
  reason: (run: HeatDay[], peak: number, crops: Crop[], today: string, p: HeatParams) => string;
};

const maxOf = (run: HeatDay[]) => Math.max(...run.map((d) => d.tmaxC!));
const ADVICE_CANICULE = 'Arrose tôt le matin, paille le sol et ombre les jeunes plants.';

const RULES: RunRule[] = [
  {
    level: 'canicule',
    test: (d) => d.canicule,
    needed: () => 1,
    peak: maxOf,
    crops: (g) => g.map((e) => e.crop),
    reason: (run, peak, _c, today) => {
      const when = run.length === 1 ? dayLabel(run[0]!.date, today) : `${run.length} jours ${fromLabel(run[0]!.date, today)}`;
      return `Canicule ${when} (maxi prévue ${celsius(peak)}). ${ADVICE_CANICULE}`;
    },
  },
  {
    level: 'nouaison',
    test: (d) => d.hotNight === true,
    needed: (p) => p.fruitSetNights.value,
    peak: (run) => Math.max(...run.map((d) => d.nightMinC!)),
    crops: (g, date, p) =>
      g.filter((e) => cropIn(e.crop, HEAT_CROPS.fruitSet) && daysBetween(e.since, date) >= p.tomatoFloweringAfterDays.value).map((e) => e.crop),
    reason: (run, _peak, _c, today, p) =>
      `Nuits chaudes : ${run.length} nuits de suite à ${celsius(p.hotNightC.value)} ou plus ${fromLabel(run[0]!.date, today)}. La tomate va perdre des fleurs : paille et arrose régulièrement, la nouaison reprendra avec la fraîcheur.`,
  },
  {
    level: 'montaison',
    test: (d) => d.bolting,
    needed: (p) => p.boltingDays.value,
    peak: maxOf,
    crops: (g) => g.filter((e) => cropIn(e.crop, HEAT_CROPS.bolting)).map((e) => e.crop),
    reason: (run, _peak, crops, today, p) =>
      `Chaleur durable : ${run.length} jours de suite à ${celsius(p.boltingC.value)} ou plus ${fromLabel(run[0]!.date, today)}. ${capital(cropList(crops))} vont monter en graines : récolte les plus avancées, ombre les autres.`,
  },
];

/**
 * Agronomy 6: a canicule (any crop in the ground), tomato fruit set after hot nights (tomatoes
 * in the ground long enough to flower), and bolting of salads and spinach after a run of warm
 * days. One alert per run and rule, dated the day the run reaches its length. Heat days alone
 * do not alert: the water balance already reacts to a higher ET0.
 */
export function heatAlerts(
  hours: readonly HourlyWeather[],
  plantings: readonly PlantingLike[],
  crops: readonly Crop[],
  options: HeatOptions,
): HeatAlert[] {
  const params = options.params ?? HEAT_PARAMS;
  const { today } = options;
  const heatDays = assessHeatDays(hours, { today, params });
  const alerts = RULES.flatMap((rule) =>
    runsOf(heatDays, rule.test).flatMap((run) => {
      const date = alertDate(run, rule.needed(params), today);
      if (!date) return [];
      const concerned = rule.crops(cropsInGround(plantings, crops, date), date, params);
      if (concerned.length === 0) return [];
      const peak = rule.peak(run);
      const from = run[0]!.date;
      const to = run[run.length - 1]!.date;
      const alert: HeatAlert = {
        kind: 'heat',
        level: rule.level,
        date,
        daysAhead: daysBetween(today, date),
        crops: concerned.map(toAlertCrop),
        reason: rule.reason(run, peak, concerned, today, params),
        estimate: true,
        inputs: {
          from,
          to,
          days: run.length,
          peakC: peak,
          models: modelsOf(hours.filter((h) => h.ts.slice(0, 10) >= from && h.ts.slice(0, 10) <= to), ['temperature_2m']),
          params,
        },
      };
      return [alert];
    }),
  );
  return alerts.sort((a, b) => a.date.localeCompare(b.date) || LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
}
