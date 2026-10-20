import { addDays } from '../dates.js';
import { celsius, daysBetween, frenchDate } from './format.js';
import type { Param, ParamSet } from './types.js';

/** One day of history: the minimum air temperature at 2 m. `DailyWeather` fits as is. */
export type DailyMin = { date: string; tmin: number };

const MERIGNAC_SOURCE =
  'Météo-France, fiche climatologique Bordeaux-Mérignac 33281001, normales 1991-2020, jours avec Tn <= 0 °C';

/** Mean days per year with Tn <= 0 °C at Bordeaux-Mérignac, 1991-2020, for the months the sheet prints. */
export const MERIGNAC_FROST_DAYS: { source: string; perMonth: Readonly<Record<number, number>> } = {
  source: MERIGNAC_SOURCE,
  perMonth: { 1: 7.3, 2: 6.3, 3: 1.8, 4: 0.1, 5: 0, 10: 0.1, 11: 1.9, 12: 5.8 },
};

export type LastFrostParams = Record<'thresholdC' | 'safePercentile', Param>;

export const LAST_FROST_PARAMS: LastFrostParams = {
  thresholdC: { value: 0, unit: '°C', estimate: false, source: 'Définition du gel sous abri : Tn <= 0 °C' },
  safePercentile: { value: 90, unit: '%', estimate: false, source: 'Revue agronomique 2.1' },
};

export const CALIBRATION_PARAMS = {
  tolerance: { value: 0.2, unit: 'part', estimate: true },
  stepC: { value: 0.5, unit: '°C', estimate: true },
  maxC: { value: 3, unit: '°C', estimate: true },
} satisfies ParamSet;

export type FrostYear = { year: number; lastFrost: string | null; firstFrost: string | null };

export type LastFrostStats = {
  years: number;
  skippedYears: number[];
  yearsWithoutSpringFrost: number;
  yearsWithoutAutumnFrost: number;
  /** MM-DD. `safe` is the 90th percentile of the last spring frost; null where that percentile has no frost. */
  spring: { median: string | null; safe: string | null };
  /** MM-DD. `early` is the 10th percentile of the first autumn frost. */
  autumn: { median: string | null; early: string | null };
  perYear: FrostYear[];
  /** Always true: a reanalysis grid cell smooths the cold pockets where radiative frost forms. */
  estimate: true;
  reason: string;
  inputs: {
    thresholdC: number;
    calibrated: boolean;
    model: string | null;
    percentileMethod: 'nearest-rank';
    from: string | null;
    to: string | null;
    params: LastFrostParams;
  };
};

export type LastFrostOptions = { thresholdC?: number; calibrated?: boolean; model?: string };

const NO_SPRING_FROST = 0;
const NO_AUTUMN_FROST = 367;
const REF = '2000-01-01';
const dayOfYear = (date: string) => daysBetween(REF, `2000-${date.slice(5)}`) + 1;
const monthDay = (doy: number) => addDays(REF, doy - 1).slice(5);

function fullYears(days: readonly DailyMin[]): { complete: Map<number, DailyMin[]>; skipped: number[] } {
  const byYear = new Map<number, Map<string, DailyMin>>();
  for (const d of days) {
    const y = Number(d.date.slice(0, 4));
    const year = byYear.get(y) ?? new Map<string, DailyMin>();
    year.set(d.date, d);
    byYear.set(y, year);
  }
  const complete = new Map<number, DailyMin[]>();
  const skipped: number[] = [];
  for (const [y, year] of [...byYear.entries()].sort(([a], [b]) => a - b)) {
    const length = daysBetween(`${y}-01-01`, `${y + 1}-01-01`);
    if (year.size === length) complete.set(y, [...year.values()].sort((a, b) => a.date.localeCompare(b.date)));
    else skipped.push(y);
  }
  return { complete, skipped };
}

function frostYear(year: number, days: DailyMin[], thresholdC: number): FrostYear {
  const frosts = days.filter((d) => d.tmin <= thresholdC).map((d) => d.date);
  const spring = frosts.filter((d) => d.slice(5) <= '06-30');
  const autumn = frosts.filter((d) => d.slice(5) >= '07-01');
  return { year, lastFrost: spring[spring.length - 1] ?? null, firstFrost: autumn[0] ?? null };
}

/** Nearest-rank percentile; null when it lands on a year without frost. */
function percentile(sorted: number[], p: number): string | null {
  if (sorted.length === 0) return null;
  const v = sorted[Math.ceil((p / 100) * sorted.length) - 1]!;
  return v === NO_SPRING_FROST || v === NO_AUTUMN_FROST ? null : monthDay(v);
}

const asDate = (md: string) => frenchDate(`2000-${md}`);

function springText(s: LastFrostStats['spring']): string {
  const median = s.median
    ? `la dernière gelée de printemps tombe en médiane le ${asDate(s.median)}.`
    : "au moins un printemps sur deux n'a pas de gelée.";
  return `${median} Après le ${asDate(s.safe!)}, 9 printemps sur 10 n'en ont plus.`;
}

function autumnText(a: LastFrostStats['autumn']): string {
  if (a.median) return `La première gelée d'automne arrive en médiane le ${asDate(a.median)}, et 1 automne sur 10 dès le ${asDate(a.early!)}.`;
  if (a.early) return `Au moins un automne sur deux n'a pas de gelée avant le 31 décembre, et 1 automne sur 10 en a une dès le ${asDate(a.early)}.`;
  return 'Au plus 1 automne sur 10 a une gelée.';
}

function statsReason(years: number, spring: LastFrostStats['spring'], autumn: LastFrostStats['autumn']): string {
  if (years === 0) return "Pas assez d'historique pour dater les gelées.";
  const head = `D'après ${years} ans d'historique, `;
  if (!spring.safe && !autumn.early) return `${head}au plus 1 printemps sur 10 a une gelée, et au plus 1 automne sur 10.`;
  const springPart = spring.safe ? springText(spring) : 'au plus 1 printemps sur 10 a une gelée.';
  return `${head}${springPart} ${autumnText(autumn)}`;
}

/**
 * Last spring frost (1 January to 30 June) and first autumn frost (1 July to 31 December) per full
 * year, then the median and the 9-in-10 dates (agronomy 2.1). Years without frost are counted.
 */
export function lastFrostStats(days: readonly DailyMin[], options: LastFrostOptions = {}): LastFrostStats {
  const thresholdC = options.thresholdC ?? LAST_FROST_PARAMS.thresholdC.value;
  const calibrated = options.calibrated ?? false;
  const { complete, skipped } = fullYears(days);
  const perYear = [...complete.entries()].map(([y, list]) => frostYear(y, list, thresholdC));
  const springDoys = perYear.map((y) => (y.lastFrost ? dayOfYear(y.lastFrost) : NO_SPRING_FROST)).sort((a, b) => a - b);
  const autumnDoys = perYear.map((y) => (y.firstFrost ? dayOfYear(y.firstFrost) : NO_AUTUMN_FROST)).sort((a, b) => a - b);
  const spring = { median: percentile(springDoys, 50), safe: percentile(springDoys, LAST_FROST_PARAMS.safePercentile.value) };
  const autumn = { median: percentile(autumnDoys, 50), early: percentile(autumnDoys, 100 - LAST_FROST_PARAMS.safePercentile.value) };
  const years = perYear.length;
  const note = calibrated ? ` Seuil de ${celsius(thresholdC)} calé sur Bordeaux-Mérignac.` : '';
  const kept = [...complete.keys()];
  return {
    years,
    skippedYears: skipped,
    yearsWithoutSpringFrost: perYear.filter((y) => !y.lastFrost).length,
    yearsWithoutAutumnFrost: perYear.filter((y) => !y.firstFrost).length,
    spring,
    autumn,
    perYear,
    estimate: true,
    reason: `${statsReason(years, spring, autumn)}${years > 0 ? note : ''}`,
    inputs: {
      thresholdC,
      calibrated,
      model: options.model ?? null,
      percentileMethod: 'nearest-rank',
      from: kept.length ? `${kept[0]}-01-01` : null,
      to: kept.length ? `${kept[kept.length - 1]}-12-31` : null,
      params: {
        ...LAST_FROST_PARAMS,
        thresholdC: calibrated
          ? { value: thresholdC, unit: '°C', estimate: true, source: MERIGNAC_SOURCE }
          : { ...LAST_FROST_PARAMS.thresholdC, value: thresholdC },
      },
    },
  };
}

export type CalibrationRow = { month: number; gridDays: number; normalDays: number; withinTolerance: boolean };

export type FrostCalibration = {
  thresholdC: number;
  /** True when every compared month is within the tolerance. */
  matched: boolean;
  /** Grid frost days per year at the chosen threshold, next to the normals, for every month the normals print. */
  table: CalibrationRow[];
  tried: { thresholdC: number; worstError: number }[];
  estimate: true;
  reason: string;
  inputs: { months: number[]; years: number; normalsSource: string; params: typeof CALIBRATION_PARAMS };
};

export type CalibrationOptions = { normals?: typeof MERIGNAC_FROST_DAYS; months?: number[] };

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const decimal = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
const round2 = (v: number) => Math.round(v * 100) / 100;

function gridDaysPerMonth(days: readonly DailyMin[], thresholdC: number): Map<number, number> {
  const years = new Map<number, Set<number>>();
  const counts = new Map<number, number>();
  for (const d of days) {
    const month = Number(d.date.slice(5, 7));
    years.set(month, (years.get(month) ?? new Set()).add(Number(d.date.slice(0, 4))));
    if (d.tmin <= thresholdC) counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return new Map([...years.entries()].map(([month, ys]) => [month, (counts.get(month) ?? 0) / ys.size]));
}

function relativeError(grid: number, normal: number): number {
  return normal === 0 ? (grid === 0 ? 0 : Infinity) : Math.abs(grid - normal) / normal;
}

function tableAt(days: readonly DailyMin[], thresholdC: number, normals: Record<number, number>, tolerance: number): CalibrationRow[] {
  const grid = gridDaysPerMonth(days, thresholdC);
  return Object.entries(normals).map(([m, normalDays]) => {
    const gridDays = round2(grid.get(Number(m)) ?? 0);
    return { month: Number(m), gridDays, normalDays, withinTolerance: relativeError(gridDays, normalDays) <= tolerance };
  });
}

function comparison(table: CalibrationRow[], months: number[]): string {
  return table
    .filter((r) => months.includes(r.month))
    .map((r, i) => `${MONTH_NAMES[r.month - 1]} ${decimal(r.gridDays)}${i === 0 ? (r.gridDays >= 2 ? ' jours par an' : ' jour par an') : ''} contre ${decimal(r.normalDays)}`)
    .join(', ');
}

/**
 * Raises the frost threshold from 0 °C in 0.5 °C steps until the grid cell's frost days in the
 * compared months (March and November) are within 20 % of the Bordeaux-Mérignac normals
 * (agronomy 2.1). Without a match, keeps the threshold with the smallest worst error.
 */
export function calibrateFrostThreshold(days: readonly DailyMin[], options: CalibrationOptions = {}): FrostCalibration {
  const normals = options.normals ?? MERIGNAC_FROST_DAYS;
  const months = options.months ?? [3, 11];
  const { tolerance, stepC, maxC } = CALIBRATION_PARAMS;
  const years = new Set(days.map((d) => d.date.slice(0, 4))).size;
  const inputs = { months, years, normalsSource: normals.source, params: CALIBRATION_PARAMS };
  if (days.length === 0) {
    return {
      thresholdC: 0,
      matched: false,
      table: tableAt(days, 0, normals.perMonth, tolerance.value),
      tried: [],
      estimate: true,
      reason: "Pas assez d'historique pour caler le seuil de gel : 0 °C par défaut.",
      inputs,
    };
  }
  const tried: FrostCalibration['tried'] = [];
  let best = { thresholdC: 0, worstError: Infinity };
  for (let t = 0; t <= maxC.value + 1e-9; t = Math.round((t + stepC.value) * 10) / 10) {
    const table = tableAt(days, t, normals.perMonth, tolerance.value);
    const compared = table.filter((r) => months.includes(r.month));
    const worstError = Math.max(...compared.map((r) => relativeError(r.gridDays, r.normalDays)));
    tried.push({ thresholdC: t, worstError: round2(worstError) });
    if (worstError < best.worstError) best = { thresholdC: t, worstError };
    if (worstError <= tolerance.value) {
      return { thresholdC: t, matched: true, table, tried, estimate: true, reason: `Seuil de gel calé à ${celsius(t)} sur Bordeaux-Mérignac : ${comparison(table, months)}.`, inputs };
    }
  }
  const table = tableAt(days, best.thresholdC, normals.perMonth, tolerance.value);
  const reason = `Seuil de gel retenu : ${celsius(best.thresholdC)}, le plus proche de Bordeaux-Mérignac, sans atteindre l'écart de ${Math.round(tolerance.value * 100)} % visé : ${comparison(table, months)}.`;
  return { thresholdC: best.thresholdC, matched: false, table, tried, estimate: true, reason, inputs };
}
