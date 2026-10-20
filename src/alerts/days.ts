import { addDays } from '../dates.js';
import type { HourlyModel, HourlyVar, HourlyWeather } from '../weather/hourly.js';
import { daysBetween, frenchDate, weekday } from './format.js';

/** One calendar day (00:00 to 23:00 local) summed up from its hours. A value is null when no hour has it. */
export type DayStats = {
  date: string;
  hours: number;
  tmaxC: number | null;
  soil6MeanC: number | null;
  soil6MaxC: number | null;
  soil18MeanC: number | null;
  gustMaxKmh: number | null;
  precipMm: number | null;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const values = (hours: readonly HourlyWeather[], variable: HourlyVar) => hours.flatMap((h) => (h[variable] === null ? [] : [h[variable]]));
const maxOf = (list: number[]) => (list.length === 0 ? null : Math.max(...list));
const meanOf = (list: number[]) => (list.length === 0 ? null : round1(list.reduce((a, b) => a + b, 0) / list.length));
const sumOf = (list: number[]) => (list.length === 0 ? null : round1(list.reduce((a, b) => a + b, 0)));

function statsOf(date: string, hours: readonly HourlyWeather[]): DayStats {
  return {
    date,
    hours: hours.length,
    tmaxC: maxOf(values(hours, 'temperature_2m')),
    soil6MeanC: meanOf(values(hours, 'soil_temperature_6cm')),
    soil6MaxC: maxOf(values(hours, 'soil_temperature_6cm')),
    soil18MeanC: meanOf(values(hours, 'soil_temperature_18cm')),
    gustMaxKmh: maxOf(values(hours, 'wind_gusts_10m')),
    precipMm: sumOf(values(hours, 'precipitation')),
  };
}

/** Groups hours by calendar day, in date order. */
export function daysOf(hours: readonly HourlyWeather[]): DayStats[] {
  const byDay = new Map<string, HourlyWeather[]>();
  for (const h of hours) {
    const date = h.ts.slice(0, 10);
    byDay.set(date, [...(byDay.get(date) ?? []), h]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => statsOf(date, list));
}

/** "aujourd'hui", "demain", or "jeudi 22 octobre". */
export function dayLabel(date: string, today: string): string {
  const ahead = daysBetween(today, date);
  if (ahead === 0) return "aujourd'hui";
  if (ahead === 1) return 'demain';
  return `${weekday(date)} ${frenchDate(date)}`;
}

/** Runs of consecutive dates whose item passes `test`. A missing date ends a run. */
export function runsOf<T extends { date: string }>(items: readonly T[], test: (item: T) => boolean): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    const last = current[current.length - 1];
    const follows = last !== undefined && addDays(last.date, 1) === item.date;
    if (!test(item)) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    if (current.length > 0 && !follows) runs.push(current);
    current = current.length > 0 && follows ? [...current, item] : [item];
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Every model that gave one of `variables` in these hours, in order of first use. */
export function modelsOf(hours: readonly HourlyWeather[], variables: readonly HourlyVar[]): HourlyModel[] {
  const seen = new Set<HourlyModel>();
  for (const h of hours) {
    for (const v of variables) {
      const m = h.modelOf[v];
      if (m) seen.add(m);
    }
  }
  return [...seen];
}
