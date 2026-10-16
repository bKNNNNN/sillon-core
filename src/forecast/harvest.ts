import { addDays } from '../dates.js';
import type { Crop } from '../crops/schema.js';
import type { PlantingLike } from '../plantings/types.js';
import type { DailyWeather } from '../weather/openmeteo.js';
import { dailyGdd } from './gdd.js';

export type HarvestForecast =
  | { kind: 'no-data' }
  /** `fromSowing`: a pot not yet transplanted, so the season is counted from the sowing date. */
  | { kind: 'days'; expected: string; estimate: boolean; fromSowing: boolean }
  | {
      kind: 'gdd';
      expected: string;
      earliest: string;
      latest: string;
      progressPct: number;
      estimate: boolean;
      weatherStale: boolean;
    };

/** The planting fields `forecastHarvest` reads. */
export type HarvestPlanting = Pick<PlantingLike, 'sownOn' | 'transplantedOn' | 'method'>;

export type HarvestInput = {
  planting: HarvestPlanting;
  crop: Crop;
  observed: DailyWeather[];
  forecast: DailyWeather[];
  climatology: Record<number, DailyWeather[]>;
  today: string;
  weatherStale: boolean;
};

const FORECAST_SPREAD_DAYS = 2;

type Reach = { date: string | null; total: number };

function accumulate(days: DailyWeather[], start: string, tBase: number, target: number, from: number): Reach {
  let total = from;
  for (const day of days) {
    if (day.date < start) continue;
    total += dailyGdd(day.tmin, day.tmax, tBase);
    if (total >= target) return { date: day.date, total };
  }
  return { date: null, total };
}

function monthDay(date: string): string {
  return date.slice(5);
}

function climatologyReach(
  year: DailyWeather[],
  after: string,
  cutoff: string,
  tBase: number,
  target: number,
  from: number,
): string | null {
  const byMonthDay = new Map(year.map((d) => [monthDay(d.date), d]));
  let total = from;
  for (let date = addDays(after, 1); date <= cutoff; date = addDays(date, 1)) {
    const md = monthDay(date);
    const day = byMonthDay.get(md === '02-29' ? '02-28' : md) ?? byMonthDay.get(md);
    if (!day) return null;
    total += dailyGdd(day.tmin, day.tmax, tBase);
    if (total >= target) return date;
  }
  return null;
}

function nearestRank(sorted: string[], p: number): string {
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
}

function daysFallback(planting: HarvestPlanting, crop: Crop): HarvestForecast {
  if (!crop.daysToMaturity) return { kind: 'no-data' };
  const start = planting.transplantedOn ?? planting.sownOn;
  return {
    kind: 'days',
    expected: addDays(start, crop.daysToMaturity.value),
    estimate: !!crop.daysToMaturity.estimate,
    fromSowing: planting.method === 'pot' && !planting.transplantedOn,
  };
}

export function forecastHarvest(input: HarvestInput): HarvestForecast {
  const { planting, crop, observed, forecast, climatology, weatherStale } = input;
  const start = planting.transplantedOn ?? planting.sownOn;
  if (!crop.gdd || !crop.tBaseC) return daysFallback(planting, crop);

  const target = crop.gdd.value;
  const tBase = crop.tBaseC.value;
  const estimate = !!(crop.gdd.estimate || crop.tBaseC.estimate);
  const base = { estimate, weatherStale };

  const seen = accumulate(observed, start, tBase, target, 0);
  const progressPct = Math.min(100, Math.round((seen.total / target) * 100));
  if (seen.date) {
    return { kind: 'gdd', expected: seen.date, earliest: seen.date, latest: seen.date, progressPct, ...base };
  }

  const ahead = accumulate(forecast, start, tBase, target, seen.total);
  if (ahead.date) {
    return {
      kind: 'gdd',
      expected: ahead.date,
      earliest: addDays(ahead.date, -FORECAST_SPREAD_DAYS),
      latest: addDays(ahead.date, FORECAST_SPREAD_DAYS),
      progressPct,
      ...base,
    };
  }

  const lastDay = [...observed, ...forecast].reduce((max, d) => (d.date > max ? d.date : max), start);
  const cutoff = `${Number(start.slice(0, 4)) + 1}-12-31`;
  const reached = Object.values(climatology)
    .map((year) => climatologyReach(year, lastDay, cutoff, tBase, target, ahead.total))
    .filter((d): d is string => d !== null)
    .sort();
  if (reached.length === 0) return daysFallback(planting, crop);

  return {
    kind: 'gdd',
    expected: nearestRank(reached, 0.5),
    earliest: nearestRank(reached, 0.1),
    latest: nearestRank(reached, 0.9),
    progressPct,
    ...base,
  };
}
