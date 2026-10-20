import { getISOWeek, parseISO } from 'date-fns';
import { windowsOf, type Crop, type GermSoilC, type WeekWindow } from '../crops/schema.js';
import { addDays } from '../dates.js';
import type { HourlyModel, HourlyWeather } from '../weather/hourly.js';
import { daysOf, modelsOf, runsOf, type DayStats } from './days.js';
import { celsius } from './format.js';
import { cropIn, toAlertCrop } from './in-ground.js';
import type { Alert, Param, ParamSet } from './types.js';

const SPEC = 'Revue agronomique Sillon, section 5 (sol et germination)';
const GFM = 'Growing for Market, Planting and greensprouting potatoes, https://growingformarket.com/planting-and-greensprouting-potatoes/';
const JARDINER_MALIN = 'Jardiner Malin, fiche pomme de terre, https://www.jardiner-malin.fr/fiche/pomme-de-terre.html';

/**
 * Soil rule parameters from agronomy 5. The germination bounds come from each crop's `germSoilC`
 * (Harrington); only the potato thresholds and the look-ahead live here.
 */
export const SOIL_TEMP_PARAMS = {
  lookAheadDays: { value: 3, unit: 'jours', estimate: true, source: SPEC },
  potatoPlantC: { value: 8, unit: '°C', estimate: true, source: `Estimation entre ${GFM} (6 °C) et ${JARDINER_MALIN} (10 °C)` },
  potatoMarketC: { value: 6, unit: '°C', estimate: false, source: GFM },
  potatoMarketDays: { value: 3, unit: 'jours', estimate: false, source: GFM },
  potatoIdealC: { value: 10, unit: '°C', estimate: false, source: JARDINER_MALIN },
} satisfies ParamSet;
export type SoilTempParams = Record<keyof typeof SOIL_TEMP_PARAMS, Param>;

/** Agronomy 5 statuses, coldest first. `trop-chaud` wins when a day's surface maximum passes `max`. */
export type SoilStatus = 'trop-froid' | 'possible' | 'ideal' | 'trop-chaud';

export type SoilTempInputs = {
  /** 6 cm for seeds, 18 cm for potato tubers (closest to a 10 cm planting depth). */
  depthCm: 6 | 18;
  /** Mean of the daily mean soil temperatures over the look-ahead days. */
  meanC: number;
  /** Highest hourly soil temperature at 6 cm over those days; null at 18 cm. */
  maxC: number | null;
  days: string[];
  germSoilC?: Crop['germSoilC'];
  /** Potato only: the longest run of days with a mean at or above `potatoMarketC`. */
  daysAtMarketC?: number;
  models: HourlyModel[];
  params: SoilTempParams;
};
export type SoilTempAlert = Alert<'soil-temp', SoilStatus, SoilTempInputs>;
export type SoilTempOptions = { today: string; params?: SoilTempParams };

const POTATO = ['pomme-de-terre'];
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Agronomy 5 status for a mean soil temperature and the highest hourly value, against Harrington bounds. */
export function soilStatus(g: GermSoilC, meanC: number, maxC: number): SoilStatus {
  if (maxC > g.max) return 'trop-chaud';
  if (meanC < g.min) return 'trop-froid';
  if (g.optLow !== undefined && g.optHigh !== undefined && meanC >= g.optLow && meanC <= g.optHigh) return 'ideal';
  return 'possible';
}

/** Potato status from the soil near 18 cm: the default threshold decides, the ideal one confirms. */
export function potatoStatus(meanC: number, params: SoilTempParams = SOIL_TEMP_PARAMS): SoilStatus {
  if (meanC >= params.potatoIdealC.value) return 'ideal';
  if (meanC >= params.potatoPlantC.value) return 'possible';
  return 'trop-froid';
}

function inWindow(week: number, { from, to }: WeekWindow): boolean {
  return from <= to ? week >= from && week <= to : week >= from || week <= to;
}

function sowsDirectThisWeek(crop: Crop, today: string): boolean {
  const week = getISOWeek(parseISO(today));
  return crop.sowDirect !== undefined && windowsOf(crop.sowDirect.value).some((w) => inWindow(week, w));
}

/** The look-ahead days, or null when one of them has no value at that depth. */
function aheadDays(all: DayStats[], today: string, count: number, key: 'soil6MeanC' | 'soil18MeanC'): DayStats[] | null {
  const wanted = Array.from({ length: count }, (_, i) => addDays(today, i));
  const found = wanted.map((date) => all.find((d) => d.date === date && d[key] !== null));
  return found.every((d) => d !== undefined) ? (found as DayStats[]) : null;
}

const meanOf = (list: number[]) => round1(list.reduce((a, b) => a + b, 0) / list.length);

function seedReason(crop: Crop, g: GermSoilC, status: SoilStatus, meanC: number, maxC: number): string {
  const head = `${crop.name} : sol à ${celsius(meanC)} en surface`;
  if (status === 'trop-chaud') {
    return `${crop.name} : sol trop chaud en surface (jusqu'à ${celsius(maxC)}, plus de ${celsius(g.max)}). Sème le soir, ombre et garde le sillon humide.`;
  }
  if (status === 'trop-froid') return `${head}, trop froid pour semer (${celsius(g.min)} minimum). Attends quelques jours.`;
  if (status === 'ideal') return `${head}, idéal pour semer cette semaine.`;
  if (g.optLow === undefined || g.optHigh === undefined) return `${head}, semis possible (entre ${celsius(g.min).replace(' °C', '')} et ${celsius(g.max)}).`;
  if (meanC < g.optLow) return `${head}, semis possible mais lent (idéal à partir de ${celsius(g.optLow)}).`;
  return `${head}, semis possible, un peu chaud (idéal jusqu'à ${celsius(g.optHigh)}).`;
}

function potatoReason(status: SoilStatus, meanC: number, params: SoilTempParams): string {
  const head = `Pomme de terre : sol à ${celsius(meanC)} vers 18 cm`;
  if (status === 'ideal') return `${head}, idéal pour planter cette semaine.`;
  if (status === 'possible') return `${head}, plantation possible (${celsius(params.potatoIdealC.value)} conseillés par certaines fiches).`;
  const market = `${celsius(params.potatoMarketC.value)} trois jours de suite pour certains maraîchers`;
  return `${head}, trop froid pour planter (${celsius(params.potatoPlantC.value)} conseillés ; ${market}, ${celsius(params.potatoIdealC.value)} pour d'autres). Attends quelques jours.`;
}

function alertOf(crop: Crop, today: string, level: SoilStatus, reason: string, inputs: SoilTempInputs): SoilTempAlert {
  return { kind: 'soil-temp', level, date: today, daysAhead: 0, crops: [toAlertCrop(crop)], reason, estimate: true, inputs };
}

function potatoAlert(crop: Crop, hours: readonly HourlyWeather[], all: DayStats[], options: Required<SoilTempOptions>): SoilTempAlert | null {
  const { today, params } = options;
  const ahead = aheadDays(all, today, params.lookAheadDays.value, 'soil18MeanC');
  if (!ahead) return null;
  const meanC = meanOf(ahead.map((d) => d.soil18MeanC!));
  const runs = runsOf(ahead, (d) => d.soil18MeanC! >= params.potatoMarketC.value);
  const status = potatoStatus(meanC, params);
  const dates = ahead.map((d) => d.date);
  return alertOf(crop, today, status, potatoReason(status, meanC, params), {
    depthCm: 18,
    meanC,
    maxC: null,
    days: dates,
    daysAtMarketC: Math.max(0, ...runs.map((r) => r.length)),
    models: modelsOf(hours.filter((h) => dates.includes(h.ts.slice(0, 10))), ['soil_temperature_18cm']),
    params,
  });
}

function seedAlert(crop: Crop, hours: readonly HourlyWeather[], all: DayStats[], options: Required<SoilTempOptions>): SoilTempAlert | null {
  const { today, params } = options;
  if (!crop.germSoilC) return null;
  const ahead = aheadDays(all, today, params.lookAheadDays.value, 'soil6MeanC');
  if (!ahead) return null;
  const g = crop.germSoilC.value;
  const meanC = meanOf(ahead.map((d) => d.soil6MeanC!));
  const maxC = Math.max(...ahead.map((d) => d.soil6MaxC!));
  const status = soilStatus(g, meanC, maxC);
  const dates = ahead.map((d) => d.date);
  return alertOf(crop, today, status, seedReason(crop, g, status, meanC, maxC), {
    depthCm: 6,
    meanC,
    maxC,
    days: dates,
    germSoilC: crop.germSoilC,
    models: modelsOf(hours.filter((h) => dates.includes(h.ts.slice(0, 10))), ['soil_temperature_6cm']),
    params,
  });
}

/**
 * Agronomy 5: for each crop whose direct sowing window is open this week, compares the modelled
 * soil temperature of the next days (from today) with the crop's germination bounds. Potatoes
 * read the soil near 18 cm against fixed planting thresholds. One entry per crop, `ideal` and
 * `possible` included, so the calendar can say "now" as well as "not yet". Always an estimate:
 * Open-Meteo soil temperature is modelled for a generic soil.
 */
export function soilSowingAlerts(hours: readonly HourlyWeather[], crops: readonly Crop[], options: SoilTempOptions): SoilTempAlert[] {
  const full = { today: options.today, params: options.params ?? SOIL_TEMP_PARAMS };
  const all = daysOf(hours);
  return crops
    .filter((c) => sowsDirectThisWeek(c, options.today))
    .flatMap((c) => (cropIn(c, POTATO) ? potatoAlert(c, hours, all, full) : seedAlert(c, hours, all, full)) ?? []);
}
