import type { Crop } from '../crops/schema.js';
import { dailyGdd } from '../forecast/gdd.js';
import type { PlantingLike } from '../plantings/types.js';
import type { DailyWeather } from '../weather/openmeteo.js';
import { daysBetween } from './format.js';
import { inGroundOn } from './frost.js';
import type { Param, ParamSet } from './types.js';

const FAO_CH8 = 'FAO-56, chapitre 8 (équations 82, 83 et 85, pluie sous 0,2 ET0)';
const FAO_T22 = 'FAO-56, tableau 22 (p ajusté de 0,04 × (5 - ETc), borné entre 0,1 et 0,8)';
const REVIEW = 'Revue agronomique Sillon 4.1';

/**
 * Water held between field capacity and wilting point, in m³ of water per m³ of soil, for the
 * three bed soil choices (agronomy 4.1). The plain sand default sits in the FAO-56 table 19 range.
 */
export const SOIL_WATER = {
  'sable-pur': { value: 0.06, unit: 'm3/m3', estimate: true, source: REVIEW },
  sable: { value: 0.08, unit: 'm3/m3', estimate: false, source: 'FAO-56 tableau 19 (sable 0,05 à 0,11) et AFES, fiche Réserve utile (0,088)' },
  'sable-amende': { value: 0.1, unit: 'm3/m3', estimate: true, source: REVIEW },
} satisfies ParamSet;
export type SoilType = keyof typeof SOIL_WATER;

/** Water balance parameters from agronomy 4.1 and 4.3. */
export const WATER_PARAMS = {
  effectiveRainEt0: { value: 0.2, unit: '× ET0', estimate: false, source: FAO_CH8 },
  pAdjustPerMm: { value: 0.04, unit: 'par mm/j', estimate: false, source: FAO_T22 },
  pReferenceEtcMm: { value: 5, unit: 'mm/j', estimate: false, source: FAO_T22 },
  pMin: { value: 0.1, unit: '', estimate: false, source: FAO_T22 },
  pMax: { value: 0.8, unit: '', estimate: false, source: FAO_T22 },
  rootStartM: { value: 0.15, unit: 'm', estimate: true, source: REVIEW },
  resetRainMm: { value: 20, unit: 'mm', estimate: true, source: REVIEW },
  resetFromMonth: { value: 11, unit: 'mois', estimate: true, source: REVIEW },
  resetToMonth: { value: 5, unit: 'mois', estimate: true, source: REVIEW },
  devFrom: { value: 0.15, unit: 'part des degrés-jours', estimate: true, source: REVIEW },
  midFrom: { value: 0.4, unit: 'part des degrés-jours', estimate: true, source: REVIEW },
  lateFrom: { value: 0.8, unit: 'part des degrés-jours', estimate: true, source: REVIEW },
  soonFraction: { value: 0.7, unit: '× RAW', estimate: true, source: REVIEW },
  waitRainFraction: { value: 0.5, unit: '× Dr', estimate: true, source: REVIEW },
} satisfies ParamSet;
export type WaterParams = Record<keyof typeof WATER_PARAMS, Param>;

/** Rain that counts: under `effectiveRainEt0` × ET0 it evaporates and counts zero (FAO-56). */
export function effectiveRain(rainMm: number, et0Mm: number, params: WaterParams = WATER_PARAMS): number {
  return rainMm < params.effectiveRainEt0.value * et0Mm ? 0 : rainMm;
}

/** FAO-56 table 22 `p` for the day's ETc: p + 0.04 × (5 - ETc), kept between 0.1 and 0.8. */
export function adjustedDepletion(pTable: number, etcMm: number, params: WaterParams = WATER_PARAMS): number {
  const p = pTable + params.pAdjustPerMm.value * (params.pReferenceEtcMm.value - etcMm);
  return Math.min(params.pMax.value, Math.max(params.pMin.value, p));
}

/** TAW in mm, FAO-56 eq. 82: 1000 × (θFC - θWP) × Zr. */
export function totalAvailableWater(waterM3M3: number, rootDepthM: number): number {
  return 1000 * waterM3M3 * rootDepthM;
}

/** RAW in mm, FAO-56 eq. 83: p × TAW, with p adjusted for the day's ETc. */
export function readilyAvailableWater(tawMm: number, pTable: number, etcMm: number, params: WaterParams = WATER_PARAMS): number {
  return adjustedDepletion(pTable, etcMm, params) * tawMm;
}

export type Stage = 'init' | 'dev' | 'mid' | 'late';
export type StageFrom = 'fao56-table11' | 'gdd-fraction' | 'default-fractions';
export type CropStage =
  | { kind: 'stage'; stage: Stage; kc: number; rootFraction: number; from: StageFrom }
  | { kind: 'no-data'; missing: string[] };

/** Where a planting is: days since it went into open ground, and its degree-day progress (null when unknown). */
export type Progress = { days: number; gddFraction: number | null };

type Bounds = { devFrom: number; midFrom: number; lateFrom: number; end: number };

const lerp = (from: number, to: number, t: number) => from + (to - from) * Math.min(1, Math.max(0, t));

function stageAt(x: number, b: Bounds, kc: { initial: number; mid: number; late: number }) {
  const rootFraction = Math.min(1, Math.max(0, x / b.midFrom));
  if (x < b.devFrom) return { stage: 'init' as const, kc: kc.initial, rootFraction };
  if (x < b.midFrom) return { stage: 'dev' as const, kc: lerp(kc.initial, kc.mid, (x - b.devFrom) / (b.midFrom - b.devFrom)), rootFraction };
  if (x < b.lateFrom) return { stage: 'mid' as const, kc: kc.mid, rootFraction };
  return { stage: 'late' as const, kc: lerp(kc.mid, kc.late, (x - b.lateFrom) / (b.end - b.lateFrom)), rootFraction };
}

/**
 * The crop's Kc stage, its Kc (linear during development and late season, as in FAO-56) and the
 * share of its final rooting depth. Uses `kcStages` when the crop has it, else the estimated
 * default degree-day fractions for a crop with `gdd`.
 */
export function cropStage(crop: Crop, progress: Progress, params: WaterParams = WATER_PARAMS): CropStage {
  const stages = crop.kcStages?.value;
  const missing = [...(crop.kc ? [] : ['kc']), ...(stages || crop.gdd ? [] : ['kcStages'])];
  if (missing.length > 0) return { kind: 'no-data', missing };
  const kc = crop.kc!.value;
  if (stages?.method === 'fao56-table11') {
    const devFrom = stages.initDays;
    const midFrom = devFrom + stages.devDays;
    const lateFrom = midFrom + stages.midDays;
    return { kind: 'stage', from: 'fao56-table11', ...stageAt(progress.days, { devFrom, midFrom, lateFrom, end: lateFrom + stages.lateDays }, kc) };
  }
  if (progress.gddFraction === null) return { kind: 'no-data', missing: ['gdd'] };
  const fractions = stages ?? { devFrom: params.devFrom.value, midFrom: params.midFrom.value, lateFrom: params.lateFrom.value };
  const from: StageFrom = stages ? 'gdd-fraction' : 'default-fractions';
  return { kind: 'stage', from, ...stageAt(progress.gddFraction, { ...fractions, end: 1 }, kc) };
}

/** A logged watering, already converted to mm (1 L/m² = 1 mm). */
export type Irrigation = { date: string; mm: number };

/** A known soil state: the depletion at the end of `date`, for example 0 when the owner says the soil is wet. */
export type WaterStart = { date: string; drMm: number };

export type WaterBalanceInput = {
  planting: PlantingLike;
  crop: Crop;
  /** Daily weather, sorted, from the planting date (for the degree-days) through the forecast. */
  weather: readonly DailyWeather[];
  soil: SoilType | Param;
  irrigations?: readonly Irrigation[];
  start?: WaterStart;
  params?: WaterParams;
};

export type WaterDay = {
  date: string;
  source: DailyWeather['source'];
  et0Mm: number;
  rainMm: number;
  effectiveRainMm: number;
  irrigationMm: number;
  stage: Stage;
  from: StageFrom;
  kc: number;
  etcMm: number;
  zrM: number;
  tawMm: number;
  p: number;
  rawMm: number;
  /** Root-zone depletion at the end of the day, between 0 and TAW. */
  drMm: number;
  /** Water lost below the roots that day (FAO-56 DP). */
  drainedMm: number;
};

export type WaterAnchor = { date: string; drMm: number; from: 'start' | 'rain' };

export type WaterBalance =
  | { kind: 'no-data'; missing: string[] }
  | { kind: 'unknown'; missing: Array<'weather' | 'inGround' | 'start'> }
  | {
      kind: 'balance';
      anchor: WaterAnchor;
      inGroundOn: string;
      /** False when the weather starts after the planting date, so degree-days are undercounted. */
      gddComplete: boolean;
      soil: Param;
      days: WaterDay[];
      params: WaterParams;
    };

type DayModel = Omit<WaterDay, 'drMm' | 'drainedMm' | 'irrigationMm'>;

function missingWaterData(crop: Crop): string[] {
  const own = cropStage(crop, { days: 0, gddFraction: 0 });
  return [
    ...(own.kind === 'no-data' ? own.missing : []),
    ...(crop.rootDepthM ? [] : ['rootDepthM']),
    ...(crop.depletionP ? [] : ['depletionP']),
    ...(own.kind === 'stage' && own.from !== 'fao56-table11' && !crop.tBaseC ? ['tBaseC'] : []),
  ];
}

function dayModels(input: WaterBalanceInput, since: string, soil: Param, params: WaterParams): DayModel[] {
  const { crop } = input;
  const zrMax = crop.rootDepthM!.value;
  const zr0 = Math.min(params.rootStartM.value, zrMax);
  let gdd = 0;
  return input.weather.map((w) => {
    const growing = w.date >= since;
    if (growing && crop.tBaseC) gdd += dailyGdd(w.tmin, w.tmax, crop.tBaseC.value);
    const progress = { days: growing ? daysBetween(since, w.date) : 0, gddFraction: growing && crop.gdd ? gdd / crop.gdd.value : 0 };
    const s = cropStage(crop, progress, params) as Extract<CropStage, { kind: 'stage' }>;
    const kc = growing ? s.kc : crop.kc!.value.initial;
    const zrM = growing ? zr0 + (zrMax - zr0) * s.rootFraction : zr0;
    const etcMm = w.et0Mm * kc;
    const tawMm = totalAvailableWater(soil.value, zrM);
    const p = adjustedDepletion(crop.depletionP!.value, etcMm, params);
    return {
      date: w.date,
      source: w.source,
      et0Mm: w.et0Mm,
      rainMm: w.precipMm,
      effectiveRainMm: effectiveRain(w.precipMm, w.et0Mm, params),
      stage: growing ? s.stage : 'init',
      from: s.from,
      kc,
      etcMm,
      zrM,
      tawMm,
      p,
      rawMm: p * tawMm,
    };
  });
}

function inResetSeason(date: string, params: WaterParams): boolean {
  const month = Number(date.slice(5, 7));
  return month >= params.resetFromMonth.value || month <= params.resetToMonth.value;
}

/** The known start: the owner's state, else the first rain that refills the soil (agronomy 4.3). */
function findAnchor(models: DayModel[], start: WaterStart | undefined, params: WaterParams): WaterAnchor | null {
  if (start) return { date: start.date, drMm: Math.max(0, start.drMm), from: 'start' };
  const refill = models.find(
    (d) =>
      (inResetSeason(d.date, params) && d.effectiveRainMm >= params.resetRainMm.value) ||
      d.effectiveRainMm >= d.tawMm,
  );
  return refill ? { date: refill.date, drMm: 0, from: 'rain' } : null;
}

/** FAO-56 eq. 85 with no run-off and no capillary rise; what passes field capacity drains. */
function step(previous: number, d: DayModel, irrigationMm: number): Pick<WaterDay, 'drMm' | 'drainedMm'> {
  const dr = previous - d.effectiveRainMm - irrigationMm + d.etcMm;
  if (dr < 0) return { drMm: 0, drainedMm: -dr };
  return { drMm: Math.min(dr, d.tawMm), drainedMm: 0 };
}

/**
 * The daily root-zone water balance of one planting on sandy soil (FAO-56 single Kc, agronomy 4.1):
 * effective rain, logged waterings, ETc = ET0 × Kc(stage), roots growing from 0.15 m to the crop's
 * `rootDepthM`. It starts at a known state only; days before that state are left out.
 */
export function waterBalance(input: WaterBalanceInput): WaterBalance {
  const params = input.params ?? WATER_PARAMS;
  const missing = missingWaterData(input.crop);
  if (missing.length > 0) return { kind: 'no-data', missing };
  if (input.weather.length === 0) return { kind: 'unknown', missing: ['weather'] };
  const since = inGroundOn(input.planting);
  if (since === null) return { kind: 'unknown', missing: ['inGround'] };
  const soil = typeof input.soil === 'string' ? SOIL_WATER[input.soil] : input.soil;
  const models = dayModels(input, since, soil, params);
  const anchor = findAnchor(models, input.start, params);
  if (!anchor) return { kind: 'unknown', missing: ['start'] };
  const irrigation = new Map<string, number>();
  for (const i of input.irrigations ?? []) irrigation.set(i.date, (irrigation.get(i.date) ?? 0) + i.mm);
  const days: WaterDay[] = [];
  for (const d of models.filter((m) => m.date >= anchor.date)) {
    const irrigationMm = irrigation.get(d.date) ?? 0;
    const state = d.date === anchor.date ? { drMm: Math.min(anchor.drMm, d.tawMm), drainedMm: 0 } : step(days[days.length - 1]!.drMm, d, irrigationMm);
    days.push({ ...d, irrigationMm, ...state });
  }
  return { kind: 'balance', anchor, inGroundOn: since, gddComplete: input.weather[0]!.date <= since, soil, days, params };
}
