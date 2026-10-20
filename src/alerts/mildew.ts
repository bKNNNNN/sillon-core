import { getCrop } from '../crops/parse.js';
import type { Crop } from '../crops/schema.js';
import { addDays } from '../dates.js';
import type { PlantingLike } from '../plantings/types.js';
import type { HourlyModel, HourlyWeather } from '../weather/hourly.js';
import { celsius, daysBetween, frenchDate, weekday } from './format.js';
import { inGroundOn } from './frost.js';
import type { Alert, AlertCrop, Param, ParamSet } from './types.js';

const HUTTON = "AHDB, Hutton Criteria (système national d'alerte mildiou de la pomme de terre, 2017)";
const SMITH = 'Kitchen Garden et CPM, Smith Period contre Hutton Criteria (11 h contre 6 h)';
const BSV = "BSV Maraîchage Sud Nouvelle-Aquitaine n° 1, 1er mars 2024 (risque d'avril à octobre)";
const REVIEW = 'Revue agronomique Sillon 3.1';

/** Mildew thresholds from agronomy 3.1. Hutton and Smith are sourced; the day boundary and the de-duplication are estimates. */
export const MILDEW_PARAMS = {
  tminC: { value: 10, unit: '°C', estimate: false, source: HUTTON },
  humidRhPct: { value: 90, unit: '%', estimate: false, source: HUTTON },
  huttonHours: { value: 6, unit: 'h', estimate: false, source: HUTTON },
  smithHours: { value: 11, unit: 'h', estimate: false, source: SMITH },
  seasonFromMonth: { value: 4, unit: 'mois', estimate: false, source: BSV },
  seasonToMonth: { value: 10, unit: 'mois', estimate: false, source: BSV },
  pastDays: { value: 2, unit: 'jours', estimate: true, source: REVIEW },
  forecastDays: { value: 4, unit: 'jours', estimate: true, source: REVIEW },
  quietDays: { value: 3, unit: 'jours', estimate: true, source: REVIEW },
  dayStartHour: { value: 0, unit: 'h', estimate: true, source: REVIEW },
} satisfies ParamSet;
export type MildewParams = Record<keyof typeof MILDEW_PARAMS, Param>;

/** Crops the mildew alert is about (Phytophthora infestans): tomato and potato. */
export const MILDEW_HOSTS = ['tomate', 'pomme-de-terre'] as const;

/** `eleve` on a Smith period, `moyen` on a Hutton period. */
export type MildewLevel = 'eleve' | 'moyen';

/** One calendar day. Only a complete day (23 hours or more) can meet a criterion. */
export type MildewDay = {
  date: string;
  tminC: number | null;
  humidHours: number;
  hours: number;
  complete: boolean;
  hutton: boolean;
  smith: boolean;
  models: HourlyModel[];
};

/** Day `date` closes a period: it and the day before both meet Hutton (or Smith for `eleve`). */
export type MildewPeriod = { date: string; daysAhead: number; level: MildewLevel; days: [MildewDay, MildewDay] };

/** Periods close enough to be one episode: fewer than `quietDays` dry days between them. */
export type MildewRun = { from: string; to: string; level: MildewLevel; periods: MildewPeriod[] };

export type MildewOptions = {
  today: string;
  params?: MildewParams;
  /** Last period day of the alert already sent. A run that continues it gets `repeat: true`. */
  lastAlertedOn?: string;
};

export type MildewInputs = {
  from: string;
  to: string;
  days: MildewDay[];
  qualifyingDays: number;
  tminC: number;
  minHumidHours: number;
  repeat: boolean;
  models: HourlyModel[];
  params: MildewParams;
};

export type MildewAlert = Alert<'mildew', MildewLevel, MildewInputs>;

const COMPLETE_HOURS = 23;

function dayKey(ts: string, startHour: number): string {
  const date = ts.slice(0, 10);
  return Number(ts.slice(11, 13)) < startHour ? addDays(date, -1) : date;
}

function modelsOf(hours: readonly HourlyWeather[]): HourlyModel[] {
  const seen = new Set<HourlyModel>();
  for (const h of hours) {
    for (const m of [h.model, h.modelOf.relative_humidity_2m]) if (m) seen.add(m);
  }
  return [...seen];
}

function assessDay(date: string, hours: HourlyWeather[], params: MildewParams): MildewDay {
  const temps = hours.flatMap((h) => (h.temperature_2m === null ? [] : [h.temperature_2m]));
  const tminC = temps.length === 0 ? null : Math.min(...temps);
  const humidHours = hours.filter((h) => h.relative_humidity_2m !== null && h.relative_humidity_2m >= params.humidRhPct.value).length;
  const complete = hours.length >= COMPLETE_HOURS;
  const mild = complete && tminC !== null && tminC >= params.tminC.value;
  return {
    date,
    tminC,
    humidHours,
    hours: hours.length,
    complete,
    hutton: mild && humidHours >= params.huttonHours.value,
    smith: mild && humidHours >= params.smithHours.value,
    models: modelsOf(hours),
  };
}

/** Groups hours into days (from `dayStartHour`, midnight by default) and checks each against Hutton and Smith. */
export function mildewDays(hours: readonly HourlyWeather[], params: MildewParams = MILDEW_PARAMS): MildewDay[] {
  const byDay = new Map<string, HourlyWeather[]>();
  for (const h of hours) {
    const key = dayKey(h.ts, params.dayStartHour.value);
    byDay.set(key, [...(byDay.get(key) ?? []), h]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => assessDay(date, list, params));
}

/**
 * Periods closing from yesterday to `forecastDays` ahead, read on `pastDays` observed days plus the
 * forecast. A period needs two consecutive complete days; it is `eleve` when both meet Smith.
 */
export function mildewPeriods(hours: readonly HourlyWeather[], options: MildewOptions): MildewPeriod[] {
  const params = options.params ?? MILDEW_PARAMS;
  const byDate = new Map(mildewDays(hours, params).map((d) => [d.date, d]));
  const periods: MildewPeriod[] = [];
  for (let ahead = 1 - params.pastDays.value; ahead <= params.forecastDays.value; ahead++) {
    const date = addDays(options.today, ahead);
    const day = byDate.get(date);
    const before = byDate.get(addDays(date, -1));
    if (!day || !before || !day.hutton || !before.hutton) continue;
    periods.push({ date, daysAhead: ahead, level: day.smith && before.smith ? 'eleve' : 'moyen', days: [before, day] });
  }
  return periods;
}

/** Dry days between the end of one episode and the first humid day of the next period. */
const dryDaysBetween = (lastPeriodDay: string, next: MildewPeriod) => daysBetween(lastPeriodDay, next.days[0].date) - 1;

/** Merges periods into episodes: a new one starts after `quietDays` dry days or more. */
export function mildewRuns(periods: readonly MildewPeriod[], params: MildewParams = MILDEW_PARAMS): MildewRun[] {
  const runs: MildewRun[] = [];
  for (const p of periods) {
    const last = runs[runs.length - 1];
    if (last && dryDaysBetween(last.to, p) < params.quietDays.value) {
      runs[runs.length - 1] = {
        ...last,
        to: p.date,
        level: last.level === 'eleve' || p.level === 'eleve' ? 'eleve' : 'moyen',
        periods: [...last.periods, p],
      };
    } else {
      runs.push({ from: p.date, to: p.date, level: p.level, periods: [p] });
    }
  }
  return runs;
}

function inSeason(date: string, params: MildewParams): boolean {
  const month = Number(date.slice(5, 7));
  return month >= params.seasonFromMonth.value && month <= params.seasonToMonth.value;
}

function hostsOn(plantings: readonly PlantingLike[], crops: readonly Crop[], date: string): Crop[] {
  const found = new Map<string, Crop>();
  for (const p of plantings) {
    const crop = getCrop([...crops], p.species);
    if (!crop || !(MILDEW_HOSTS as readonly string[]).includes(crop.id) || p.status !== 'active') continue;
    if (p.harvestedOn && p.harvestedOn <= date) continue;
    const since = inGroundOn(p);
    if (since !== null && since <= date) found.set(crop.id, crop);
  }
  return [...found.values()];
}

const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
const LEVEL_WORD: Record<MildewLevel, string> = { moyen: 'moyen', eleve: 'élevé' };

function startWording(date: string, today: string): string {
  const ahead = daysBetween(today, date);
  if (ahead < 0) return 'depuis hier';
  if (ahead === 0) return "dès aujourd'hui";
  if (ahead === 1) return 'à partir de demain';
  return `à partir du ${weekday(date)} ${frenchDate(date)}`;
}

const PROPHYLAXIS = 'Arrose au pied le matin, jamais le feuillage. Retire les feuilles du bas qui touchent le sol. Surveille les taches brunes.';
const REMOVAL = 'Si une tache apparaît, coupe la feuille et sors-la du jardin, ne la composte pas.';

function runInputs(run: MildewRun, options: MildewOptions, params: MildewParams): MildewInputs {
  const days = [...new Map(run.periods.flatMap((p) => p.days).map((d) => [d.date, d])).values()];
  const qualifying = days.filter((d) => d.hutton);
  const repeat =
    options.lastAlertedOn !== undefined &&
    options.lastAlertedOn < run.from &&
    dryDaysBetween(options.lastAlertedOn, run.periods[0]!) < params.quietDays.value;
  return {
    from: run.from,
    to: run.to,
    days,
    qualifyingDays: qualifying.length,
    tminC: Math.min(...qualifying.map((d) => d.tminC!)),
    minHumidHours: Math.min(...qualifying.map((d) => d.humidHours)),
    repeat,
    models: [...new Set(days.flatMap((d) => d.models))],
    params,
  };
}

function reasonOf(run: MildewRun, hosts: Crop[], inputs: MildewInputs, today: string): string {
  const names = hosts.map((c) => lower(c.name)).join(', ');
  const facts = `${inputs.qualifyingDays} jours doux et humides : mini ${celsius(inputs.tminC)}, au moins ${inputs.minHumidHours} h à ${inputs.params.humidRhPct.value} % d'humidité ou plus`;
  const lead = `Risque de mildiou ${LEVEL_WORD[run.level]} sur ${names} ${startWording(run.from, today)} (${facts}).`;
  return [lead, PROPHYLAXIS, ...(run.level === 'eleve' ? [REMOVAL] : [])].join(' ');
}

/**
 * One alert per mildew episode, from April to October, when a tomato or potato is in open ground
 * on a period day. Advice is prophylaxis only (owner ruling). Every alert is `estimate: true`,
 * because the day boundary and the de-duplication are estimates.
 */
export function mildewAlerts(
  hours: readonly HourlyWeather[],
  options: MildewOptions,
  plantings: readonly PlantingLike[],
  crops: readonly Crop[],
): MildewAlert[] {
  const params = options.params ?? MILDEW_PARAMS;
  const exposed = mildewPeriods(hours, options).filter(
    (p) => inSeason(p.date, params) && hostsOn(plantings, crops, p.date).length > 0,
  );
  return mildewRuns(exposed, params).map((run) => {
    const hosts = [...new Map(run.periods.flatMap((p) => hostsOn(plantings, crops, p.date)).map((c) => [c.id, c])).values()];
    const inputs = runInputs(run, options, params);
    return {
      kind: 'mildew' as const,
      level: run.level,
      date: run.from,
      daysAhead: daysBetween(options.today, run.from),
      crops: hosts.map((c): AlertCrop => ({ species: c.id, name: c.name })),
      reason: reasonOf(run, hosts, inputs, options.today),
      estimate: true,
      inputs,
    };
  });
}
