import { getCrop } from '../crops/parse.js';
import type { Crop } from '../crops/schema.js';
import { addDays } from '../dates.js';
import type { PlantingLike } from '../plantings/types.js';
import type { DailyWeather } from '../weather/openmeteo.js';
import { frenchDate } from './format.js';
import { inGroundOn } from './frost.js';
import { MILDEW_HOSTS } from './mildew.js';
import type { Alert, AlertCrop, Param } from './types.js';
import {
  WATER_PARAMS,
  waterBalance,
  type Irrigation,
  type SoilType,
  type WaterDay,
  type WaterParams,
  type WaterStart,
} from './water-balance.js';

export type WaterBed = { name: string; areaM2: number; soil: SoilType | Param };

export type BedWaterInput = {
  bed: WaterBed;
  /** The plantings of this bed. Done, harvested or not yet planted ones are left out. */
  plantings: readonly PlantingLike[];
  crops: readonly Crop[];
  /** Daily weather from the oldest planting date through at least tomorrow's forecast. */
  weather: readonly DailyWeather[];
  today: string;
  irrigations?: readonly Irrigation[];
  start?: WaterStart;
  /** True when a mildew period is active or forecast (from `mildewAlerts`). */
  mildewRisk?: boolean;
  params?: WaterParams;
};

/** `arroser`: Dr at or above RAW. `pluie-prevue`: same, but rain due by tomorrow covers half of it. `a-prevoir`: from 0.7 RAW. */
export type WaterLevel = 'arroser' | 'pluie-prevue' | 'a-prevoir';
export type WaterStatus = 'ok' | 'unknown' | 'no-data' | 'no-crop';

/** One crop's morning state: depletion at the end of yesterday against today's RAW and TAW. */
export type CropWater = {
  species: string;
  name: string;
  drMm: number;
  rawMm: number;
  tawMm: number;
  ratio: number;
  kc: number;
  et0MeanMm: number;
  since: { date: string; from: 'rain' | 'irrigation' | 'start' };
};

export type WaterInputs = {
  bed: string;
  areaM2: number;
  driver: CropWater | null;
  perCrop: CropWater[];
  noData: Array<{ species: string; name: string; missing: string[] }>;
  unknown: string[];
  doseMm: number | null;
  doseL: number | null;
  rainForecastMm: number;
  mildewRisk: boolean;
  params: WaterParams;
};

export type BedWaterAdvice = {
  bed: string;
  date: string;
  status: WaterStatus;
  level: WaterLevel | null;
  crops: AlertCrop[];
  reason: string;
  /** Always true: root growth, the start state and the advice thresholds are estimates. */
  estimate: true;
  inputs: WaterInputs;
};

export type WaterAlert = Alert<'water', WaterLevel, WaterInputs>;

const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mm = (v: number) => `${Math.round(v)} mm`;
const decimal = (v: number, digits: number) => String(Math.round(v * 10 ** digits) / 10 ** digits).replace('.', ',');

function inGroundToday(p: PlantingLike, today: string): boolean {
  if (p.status !== 'active' || (p.harvestedOn && p.harvestedOn <= today)) return false;
  const since = inGroundOn(p);
  return since !== null && since <= today;
}

function sinceOf(days: WaterDay[], morning: WaterDay, anchor: { date: string; from: 'start' | 'rain' }): CropWater['since'] {
  const full = days.filter((d) => d.date <= morning.date && d.drMm === 0).pop();
  if (!full) return { date: anchor.date, from: anchor.from };
  if (full.irrigationMm > 0) return { date: full.date, from: 'irrigation' };
  if (full.effectiveRainMm > 0 || anchor.from === 'rain') return { date: full.date, from: 'rain' };
  return { date: full.date, from: 'start' };
}

type CropState = { crop: Crop; state: CropWater | 'unknown' | { missing: string[] }; days: WaterDay[] };
const isBalanced = (s: CropState['state']): s is CropWater => typeof s === 'object' && 'ratio' in s;
const isMissing = (s: CropState['state']): s is { missing: string[] } => typeof s === 'object' && 'missing' in s;

function cropState(crop: Crop, planting: PlantingLike, input: BedWaterInput): CropState {
  const b = waterBalance({ planting, crop, weather: input.weather, soil: input.bed.soil, irrigations: input.irrigations, start: input.start, params: input.params });
  if (b.kind === 'no-data') return { crop, state: { missing: b.missing }, days: [] };
  if (b.kind === 'unknown') return { crop, state: 'unknown', days: [] };
  const past = b.days.filter((d) => d.date < input.today);
  const morning = past[past.length - 1] ?? (b.anchor.date === input.today ? b.days[0] : undefined);
  if (!morning) return { crop, state: 'unknown', days: [] };
  const today = b.days.find((d) => d.date === input.today) ?? morning;
  const since = sinceOf(b.days, morning, b.anchor);
  const spent = past.filter((d) => d.date > since.date);
  const et0MeanMm = spent.length === 0 ? morning.et0Mm : spent.reduce((s, d) => s + d.et0Mm, 0) / spent.length;
  const state: CropWater = {
    species: crop.id,
    name: crop.name,
    drMm: morning.drMm,
    rawMm: today.rawMm,
    tawMm: today.tawMm,
    ratio: today.rawMm === 0 ? 0 : morning.drMm / today.rawMm,
    kc: today.kc,
    et0MeanMm,
    since,
  };
  return { crop, state, days: b.days };
}

function bedStates(input: BedWaterInput): CropState[] {
  const byCrop = new Map<string, CropState>();
  for (const p of input.plantings) {
    const crop = getCrop([...input.crops], p.species);
    if (!crop || !inGroundToday(p, input.today)) continue;
    const s = cropState(crop, p, input);
    const previous = byCrop.get(crop.id);
    const worse = !previous || (isBalanced(s.state) && (!isBalanced(previous.state) || s.state.ratio > previous.state.ratio));
    if (worse) byCrop.set(crop.id, s);
  }
  return [...byCrop.values()];
}

function rainForecast(days: WaterDay[], today: string): number {
  const tomorrow = addDays(today, 1);
  return days.filter((d) => d.date === today || d.date === tomorrow).reduce((s, d) => s + d.effectiveRainMm, 0);
}

const SINCE_WORDS: Record<CropWater['since']['from'], string> = { rain: 'depuis la pluie du', irrigation: "depuis l'arrosage du", start: 'depuis le' };

function factsOf(d: CropWater): string {
  return `consommé ${mm(d.drMm)} sur ${mm(d.rawMm)} de réserve facile ${SINCE_WORDS[d.since.from]} ${frenchDate(d.since.date)}`;
}

function levelOf(d: CropWater, rainMm: number, params: WaterParams): WaterLevel | null {
  if (d.drMm >= d.rawMm && d.drMm > 0) return rainMm >= params.waitRainFraction.value * d.drMm ? 'pluie-prevue' : 'arroser';
  if (d.drMm >= params.soonFraction.value * d.rawMm && d.drMm > 0) return 'a-prevoir';
  return null;
}

function actionOf(level: WaterLevel | null, d: CropWater, inputs: WaterInputs): string {
  const head = `${inputs.bed} (${lower(d.name)}) :`;
  const why = `${factsOf(d)} (ET0 ${decimal(d.et0MeanMm, 1)} mm/j × Kc ${decimal(d.kc, 2)})`;
  if (level === null) return `${head} rien à arroser, ${factsOf(d)}.`;
  if (level === 'a-prevoir') return `${head} ${why}. Arrosage à prévoir d'ici 1 à 2 jours.`;
  if (level === 'pluie-prevue') return `${head} ${why}. Attends la pluie prévue : ${mm(inputs.rainForecastMm)} d'ici demain.`;
  const foot = inputs.mildewRisk ? ', au pied, le matin : risque de mildiou, ne mouille pas le feuillage' : '';
  return `${head} ${why}. Arrose ${Math.round(inputs.doseMm!)} L/m², soit ${Math.round(inputs.doseL!)} L pour la planche${foot}.`;
}

const noDataText = (list: WaterInputs['noData']) => `pas de donnée d'arrosage pour ${list.map((c) => lower(c.name)).join(', ')}`;

/**
 * This morning's watering advice for one bed (agronomy 4.3): the crop with the highest Dr/RAW
 * drives it; the dose refills to field capacity, in mm and in litres for the bed. On a bed with
 * tomato or potato, a mildew risk turns the advice into "au pied, le matin".
 */
export function waterAdvice(input: BedWaterInput): BedWaterAdvice {
  const params = input.params ?? WATER_PARAMS;
  const states = bedStates(input);
  const perCrop = states.flatMap((s) => (isBalanced(s.state) ? [s.state] : []));
  const noData = states.flatMap((s) => (isMissing(s.state) ? [{ species: s.crop.id, name: s.crop.name, missing: s.state.missing }] : []));
  const unknown = states.filter((s) => s.state === 'unknown').map((s) => s.crop.id);
  const driver = perCrop.reduce<CropWater | null>((best, c) => (best === null || c.ratio > best.ratio ? c : best), null);
  const driverDays = states.find((s) => driver !== null && s.crop.id === driver.species)?.days ?? [];
  const rainForecastMm = rainForecast(driverDays, input.today);
  const level = driver ? levelOf(driver, rainForecastMm, params) : null;
  const hasHost = states.some((s) => (MILDEW_HOSTS as readonly string[]).includes(s.crop.id));
  const dosing = level === 'arroser' || level === 'pluie-prevue';
  const inputs: WaterInputs = {
    bed: input.bed.name,
    areaM2: input.bed.areaM2,
    driver,
    perCrop,
    noData,
    unknown,
    doseMm: dosing ? driver!.drMm : null,
    doseL: dosing ? driver!.drMm * input.bed.areaM2 : null,
    rainForecastMm,
    mildewRisk: Boolean(input.mildewRisk) && hasHost,
    params,
  };
  const status: WaterStatus = driver ? 'ok' : unknown.length > 0 ? 'unknown' : noData.length > 0 ? 'no-data' : 'no-crop';
  const reasons: Record<WaterStatus, () => string> = {
    ok: () => [actionOf(level, driver!, inputs), ...(noData.length > 0 ? [`${capitalize(noDataText(noData))}.`] : [])].join(' '),
    unknown: () => `${input.bed.name} : réserve du sol inconnue. Indique si le sol est humide aujourd'hui pour lancer le calcul.`,
    'no-data': () => `${input.bed.name} : ${noDataText(noData)}.`,
    'no-crop': () => `${input.bed.name} : rien en place, rien à arroser.`,
  };
  return {
    bed: input.bed.name,
    date: input.today,
    status,
    level,
    crops: states.map((s) => ({ species: s.crop.id, name: s.crop.name })),
    reason: reasons[status](),
    estimate: true,
    inputs,
  };
}

/** The beds that need water today, as alerts. */
export function waterAlerts(advices: readonly BedWaterAdvice[]): WaterAlert[] {
  return advices.flatMap((a) =>
    a.level === null
      ? []
      : [{ kind: 'water' as const, level: a.level, date: a.date, daysAhead: 0, crops: a.crops, reason: a.reason, estimate: true, inputs: a.inputs }],
  );
}
