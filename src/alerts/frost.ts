import { getCrop } from '../crops/parse.js';
import type { Crop, FrostClass } from '../crops/schema.js';
import { addDays } from '../dates.js';
import type { PlantingLike } from '../plantings/types.js';
import { nightsOf, type HourlyModel, type HourlyWeather } from '../weather/hourly.js';
import { celsius, daysBetween, eveningOf, nightSpan } from './format.js';
import type { Alert, AlertCrop, FrostLevel, Param, ParamSet } from './types.js';

const FROST_SPEC = 'Spec Sillon et revue agronomique 2.2 (marges sous abri contre gel au sol)';
const FAO_FROST = 'FAO, Snyder et de Melo-Abreu, Frost protection, vol. 1';

/** Frost thresholds from agronomy 2.2. Only the 0 °C definition is sourced; the margins are estimates. */
export const FROST_PARAMS = {
  frostC: { value: 0, unit: '°C', estimate: false, source: FAO_FROST },
  strongC: { value: 2, unit: '°C', estimate: true, source: FROST_SPEC },
  clearStrongC: { value: 4, unit: '°C', estimate: true, source: FROST_SPEC },
  tenderWatchC: { value: 6, unit: '°C', estimate: true },
  clearCloudPct: { value: 30, unit: '%', estimate: true },
  calmWindKmh: { value: 10, unit: 'km/h', estimate: true },
} satisfies ParamSet;
export type FrostParams = Record<keyof typeof FROST_PARAMS, Param>;

/** Chilling injury on young basil: only the recent-transplant window lives here, the threshold is the crop's `chillC`. */
export const CHILL_PARAMS = {
  chillRecentDays: { value: 30, unit: 'jours', estimate: true },
} satisfies ParamSet;

export type FrostNightInputs = {
  tminC: number;
  tminAt: string;
  hours: number;
  /** True when the night runs from 18:00 to 09:00; false at the edge of the forecast. */
  complete: boolean;
  meanCloudPct: number | null;
  meanWindKmh: number | null;
  clear: boolean | null;
  calm: boolean | null;
  models: HourlyModel[];
  params: FrostParams;
};

/** One assessed night. `level` is null on a quiet night; `faible` concerns tender crops only. */
export type FrostNight = {
  night: string;
  daysAhead: number;
  level: FrostLevel | null;
  estimate: boolean;
  reason: string;
  inputs: FrostNightInputs;
};

export type FrostAlert = Alert<'frost', FrostLevel, FrostNightInputs>;
export type ChillAlert = Alert<'chill', 'froid', FrostNightInputs & { chillC: Crop['chillC']; params: FrostParams & typeof CHILL_PARAMS }>;

export type NightOptions = { today: string; params?: FrostParams };

const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/**
 * The agronomy 2.2 level for a night minimum, mean cloud cover and mean wind from 00:00 to 06:00.
 * Unknown cloud or wind counts as neither clear nor calm.
 */
export function frostLevel(
  tminC: number,
  cloudPct: number | null,
  windKmh: number | null,
  params: FrostParams = FROST_PARAMS,
): FrostLevel | null {
  const clear = cloudPct !== null && cloudPct < params.clearCloudPct.value;
  const calm = windKmh !== null && windKmh < params.calmWindKmh.value;
  if (tminC <= params.frostC.value) return 'gel';
  if (tminC <= params.strongC.value) return 'fort';
  if (clear && calm && tminC <= params.clearStrongC.value) return 'fort';
  if (clear && calm && tminC <= params.tenderWatchC.value) return 'faible';
  return null;
}

const LEAD: Record<FrostLevel, string> = {
  gel: 'Gel annoncé',
  fort: 'Gel possible',
  faible: 'Gelée blanche possible au sol',
};

function conditions(tminC: number, clear: boolean | null, calm: boolean | null): string {
  const parts = [`mini prévue ${celsius(tminC)}`];
  if (clear !== null) parts.push(clear ? 'ciel clair' : 'ciel nuageux');
  if (calm !== null) parts.push(calm ? 'vent faible' : 'du vent');
  return parts.join(', ');
}

function nightModels(hours: HourlyWeather[]): HourlyModel[] {
  const seen = new Set<HourlyModel>();
  for (const h of hours) {
    for (const m of [h.model, h.modelOf.temperature_2m, h.modelOf.cloud_cover, h.modelOf.wind_speed_10m]) if (m) seen.add(m);
  }
  return [...seen];
}

function assessNight(night: string, hours: HourlyWeather[], today: string, params: FrostParams): FrostNight | null {
  const warm = hours.filter((h): h is HourlyWeather & { temperature_2m: number } => h.temperature_2m !== null);
  if (warm.length === 0) return null;
  const coldest = warm.reduce((a, b) => (b.temperature_2m < a.temperature_2m ? b : a));
  const morning = addDays(night, 1);
  const core = hours.filter((h) => h.ts.startsWith(morning) && Number(h.ts.slice(11, 13)) <= 6);
  const complete = hours[0]!.ts === `${night}T18:00` && hours[hours.length - 1]!.ts === `${morning}T09:00`;
  const meanCloud = complete ? mean(core.flatMap((h) => (h.cloud_cover === null ? [] : [h.cloud_cover]))) : null;
  const meanWind = complete ? mean(core.flatMap((h) => (h.wind_speed_10m === null ? [] : [h.wind_speed_10m]))) : null;
  const tminC = coldest.temperature_2m;
  const level = frostLevel(tminC, meanCloud, meanWind, params);
  const clear = meanCloud === null ? null : meanCloud < params.clearCloudPct.value;
  const calm = meanWind === null ? null : meanWind < params.calmWindKmh.value;
  const span = nightSpan(night, morning);
  const lead = level ? `${LEAD[level]} la nuit ${span}` : `Pas de gel prévu la nuit ${span}`;
  return {
    night,
    daysAhead: daysBetween(today, night),
    level,
    estimate: level !== null && level !== 'gel',
    reason: `${lead} (${conditions(tminC, clear, calm)}).`,
    inputs: {
      tminC,
      tminAt: coldest.ts,
      hours: hours.length,
      complete,
      meanCloudPct: round1(meanCloud),
      meanWindKmh: round1(meanWind),
      clear,
      calm,
      models: nightModels(hours),
      params,
    },
  };
}

/** Every night from tonight onward (night key on or after `today`), quiet nights included. */
export function assessNights(hours: readonly HourlyWeather[], options: NightOptions): FrostNight[] {
  const params = options.params ?? FROST_PARAMS;
  return nightsOf(hours)
    .filter((n) => n.night >= options.today)
    .flatMap((n) => assessNight(n.night, n.hours, options.today, params) ?? []);
}

/** The nights with a frost level. Without crops, this is what a generic frost warning reads. */
export function frostNights(hours: readonly HourlyWeather[], options: NightOptions): FrostNight[] {
  return assessNights(hours, options).filter((n) => n.level !== null);
}

/** The crop's frost class, or the legacy `frostSensitive` flag mapped to tender or hardy. */
export function frostClassOf(crop: Crop): { frostClass: FrostClass; from: 'frostClass' | 'frostSensitive' } {
  if (crop.frostClass) return { frostClass: crop.frostClass.value, from: 'frostClass' };
  return { frostClass: crop.frostSensitive ? 'tender' : 'hardy', from: 'frostSensitive' };
}

const CLASS_LEVELS: Record<FrostClass, readonly FrostLevel[]> = {
  tender: ['gel', 'fort', 'faible'],
  semi: ['gel', 'fort'],
  hardy: [],
};

/** True when a frost level concerns a crop of this class. */
export function frostConcerns(frostClass: FrostClass, level: FrostLevel | null): boolean {
  return level !== null && CLASS_LEVELS[frostClass].includes(level);
}

/**
 * The date a planting went into open ground, or null while it is still under cover.
 * A pot sowing counts from its transplant; a direct sowing or a bought plant from its date.
 */
export function inGroundOn(planting: PlantingLike): string | null {
  if (planting.method === 'pot') return planting.transplantedOn ?? null;
  return planting.transplantedOn ?? planting.sownOn;
}

function inGroundOnNight(planting: PlantingLike, night: string): boolean {
  if (planting.status !== 'active') return false;
  if (planting.harvestedOn && planting.harvestedOn <= night) return false;
  const since = inGroundOn(planting);
  return since !== null && since <= night;
}

type Exposed = { crop: Crop; frostClass: FrostClass; from: 'frostClass' | 'frostSensitive'; since: string };

function exposedCrops(plantings: readonly PlantingLike[], crops: readonly Crop[], night: string): Exposed[] {
  const byId = new Map<string, Exposed>();
  for (const p of plantings) {
    const crop = getCrop([...crops], p.species);
    if (!crop || !inGroundOnNight(p, night)) continue;
    const since = inGroundOn(p)!;
    const previous = byId.get(crop.id);
    if (!previous || since > previous.since) byId.set(crop.id, { crop, ...frostClassOf(crop), since });
  }
  return [...byId.values()];
}

const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
const toAlertCrop = (e: Exposed): AlertCrop => ({ species: e.crop.id, name: e.crop.name, frostClass: e.frostClass, frostClassFrom: e.from });

function frostAdvice(exposed: Exposed[], evening: string): string {
  const hill = exposed.filter((e) => e.crop.id === 'pomme-de-terre');
  const cover = exposed.filter((e) => e.crop.id !== 'pomme-de-terre');
  const parts: string[] = [];
  if (cover.length > 0) parts.push(`Couvre d'un voile ${evening} : ${cover.map((e) => lower(e.crop.name)).join(', ')}.`);
  if (hill.length > 0) parts.push('Butte les pommes de terre levées : la terre protège les feuilles.');
  parts.push("Arrose le sol l'après-midi : un sol humide garde mieux la chaleur.");
  return parts.join(' ');
}

/** One alert per frost night that concerns a crop in open ground, naming those crops and what to do. */
export function frostAlerts(nights: readonly FrostNight[], plantings: readonly PlantingLike[], crops: readonly Crop[]): FrostAlert[] {
  return nights.flatMap((n) => {
    if (n.level === null) return [];
    const level = n.level;
    const exposed = exposedCrops(plantings, crops, n.night).filter((e) => frostConcerns(e.frostClass, level));
    if (exposed.length === 0) return [];
    return [
      {
        kind: 'frost' as const,
        level,
        date: n.night,
        daysAhead: n.daysAhead,
        crops: exposed.map(toAlertCrop),
        reason: `${n.reason} ${frostAdvice(exposed, eveningOf(n.night, n.daysAhead))}`,
        estimate: n.estimate,
        inputs: n.inputs,
      },
    ];
  });
}

/**
 * Chilling injury without frost: a crop with `chillC` (basil), in open ground for less than
 * `chillRecentDays`, on a night at or below `chillC`. Nights already covered by a frost alert for
 * that crop are left to the frost alert.
 */
export function chillAlerts(nights: readonly FrostNight[], plantings: readonly PlantingLike[], crops: readonly Crop[]): ChillAlert[] {
  const recent = CHILL_PARAMS.chillRecentDays.value;
  return nights.flatMap((n) => {
    const young = exposedCrops(plantings, crops, n.night).filter(
      (e) =>
        e.crop.chillC !== undefined &&
        n.inputs.tminC <= e.crop.chillC.value &&
        daysBetween(e.since, n.night) < recent &&
        !frostConcerns(e.frostClass, n.level),
    );
    return young.map((e) => ({
      kind: 'chill' as const,
      level: 'froid' as const,
      date: n.night,
      daysAhead: n.daysAhead,
      crops: [toAlertCrop(e)],
      reason: `Nuit froide pour les jeunes plants de ${lower(e.crop.name)} ${nightSpan(n.night, addDays(n.night, 1))} (mini prévue ${celsius(n.inputs.tminC)}, seuil ${celsius(e.crop.chillC!.value)}). Couvre-les d'un voile ${eveningOf(n.night, n.daysAhead)}.`,
      estimate: true,
      inputs: { ...n.inputs, chillC: e.crop.chillC, params: { ...n.inputs.params, ...CHILL_PARAMS } },
    }));
  });
}
