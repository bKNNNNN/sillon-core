import { describe, expect, it } from 'vitest';
import {
  MILDEW_PARAMS,
  mildewAlerts,
  mildewDays,
  mildewPeriods,
  mildewRuns,
  type Crop,
  type PlantingLike,
} from '../src/index.js';
import { day, days, hour, type DayShape } from './hourly-fixtures.js';

const crop = (id: string, name: string, extra: Partial<Crop> = {}): Crop => ({
  id,
  name,
  family: 'solanacees',
  frostSensitive: true,
  goodCompanions: [],
  badCompanions: [],
  ...extra,
});
const tomate = crop('tomate', 'Tomate');
const patate = crop('pomme-de-terre', 'Pomme de terre', { aliases: ['patate'] });
const salade = crop('salade', 'Salade', { family: 'asteracees', frostSensitive: false });
const crops = [tomate, patate, salade];

const planting = (species: string, extra: Partial<PlantingLike> = {}): PlantingLike => ({
  species,
  sownOn: '2026-05-01',
  method: 'bought',
  status: 'active',
  ...extra,
});

/** Tuesday 14 July 2026. The window runs from Sunday 12 (two observed days) to Saturday 18. */
const TODAY = '2026-07-14';
const DRY: DayShape = { tmin: 14, humidHours: 2 };
const HUMID: DayShape = { tmin: 11, humidHours: 8 };
const SOAKED: DayShape = { tmin: 12, humidHours: 12 };

/** Seven days from Sunday 12 July with the given shapes, dry where none is given. */
const week = (shapes: Partial<Record<number, DayShape>>): ReturnType<typeof days> =>
  days(
    '2026-07-12',
    Array.from({ length: 7 }, (_, i) => shapes[i] ?? DRY),
  );

describe('mildewDays', () => {
  it('reads the minimum, the humid hours and the models of each calendar day', () => {
    const [d] = mildewDays(day('2026-07-15', { tmin: 10.4, humidHours: 7 }));
    expect(d).toEqual({
      date: '2026-07-15',
      tminC: 10.4,
      humidHours: 7,
      hours: 24,
      complete: true,
      hutton: true,
      smith: false,
      models: ['meteofrance_arome_france_hd'],
    });
  });

  it('never qualifies a day cut short by the edge of the forecast', () => {
    const [d] = mildewDays(day('2026-07-15', SOAKED).slice(0, 20));
    expect(d).toMatchObject({ hours: 20, complete: false, hutton: false, smith: false });
  });

  it('skips hours without temperature or humidity in the counts', () => {
    const hours = day('2026-07-15', HUMID).map((h, i) => (i === 0 ? { ...h, relative_humidity_2m: null } : h));
    const [d] = mildewDays(hours);
    expect(d!.humidHours).toBe(7);
  });

  it('moves the day boundary with dayStartHour', () => {
    const params = { ...MILDEW_PARAMS, dayStartHour: { value: 6, unit: 'h', estimate: true } };
    const hours = [...day('2026-07-15', HUMID), ...day('2026-07-16', HUMID)];
    const list = mildewDays(hours, params);
    expect(list.map((d) => [d.date, d.hours])).toEqual([
      ['2026-07-14', 6],
      ['2026-07-15', 24],
      ['2026-07-16', 18],
    ]);
  });
});

describe('mildew levels at the Hutton and Smith boundaries', () => {
  it.each([
    // tmin, humid hours, level
    [10, 6, 'moyen'],
    [9.9, 6, null],
    [10, 5, null],
    [10, 10, 'moyen'],
    [10, 11, 'eleve'],
    [9.9, 11, null],
  ] as const)('two days at tmin %s °C with %s humid hours give %s', (tmin, humidHours, expected) => {
    const hours = week({ 3: { tmin, humidHours }, 4: { tmin, humidHours } });
    const periods = mildewPeriods(hours, { today: TODAY });
    expect(periods.map((p) => [p.date, p.level])).toEqual(expected ? [['2026-07-16', expected]] : []);
  });

  it('needs two consecutive days: one humid day alone is not a period', () => {
    expect(mildewPeriods(week({ 3: SOAKED }), { today: TODAY })).toEqual([]);
    expect(mildewPeriods(week({ 2: SOAKED, 4: SOAKED }), { today: TODAY })).toEqual([]);
  });

  it('is moyen when only one of the two days meets Smith', () => {
    const periods = mildewPeriods(week({ 3: HUMID, 4: SOAKED }), { today: TODAY });
    expect(periods.map((p) => p.level)).toEqual(['moyen']);
  });

  it('counts observed days and stops four days ahead', () => {
    const hours = days('2026-07-11', Array.from({ length: 9 }, () => HUMID));
    const periods = mildewPeriods(hours, { today: TODAY });
    expect(periods.map((p) => [p.date, p.daysAhead])).toEqual([
      ['2026-07-13', -1],
      ['2026-07-14', 0],
      ['2026-07-15', 1],
      ['2026-07-16', 2],
      ['2026-07-17', 3],
      ['2026-07-18', 4],
    ]);
  });
});

describe('mildewRuns', () => {
  it('merges periods separated by fewer than three dry days', () => {
    const hours = week({ 0: HUMID, 1: HUMID, 4: HUMID, 5: HUMID });
    const runs = mildewRuns(mildewPeriods(hours, { today: TODAY }));
    expect(runs.map((r) => [r.from, r.to, r.level])).toEqual([['2026-07-13', '2026-07-17', 'moyen']]);
  });

  it('starts a new run after three dry days', () => {
    const hours = days('2026-07-12', [HUMID, HUMID, DRY, DRY, DRY, HUMID, HUMID]);
    const runs = mildewRuns(mildewPeriods(hours, { today: TODAY }));
    expect(runs.map((r) => [r.from, r.to])).toEqual([
      ['2026-07-13', '2026-07-13'],
      ['2026-07-18', '2026-07-18'],
    ]);
  });

  it('takes the strongest level of the run', () => {
    const hours = week({ 1: HUMID, 2: SOAKED, 3: SOAKED });
    const [run] = mildewRuns(mildewPeriods(hours, { today: TODAY }));
    expect(run!.level).toBe('eleve');
  });
});

describe('mildewAlerts', () => {
  const plantings = [planting('tomate'), planting('salade')];

  it('names the host crops and gives prophylaxis only, for a moyen run', () => {
    const [alert, ...rest] = mildewAlerts(week({ 3: HUMID, 4: HUMID }), { today: TODAY }, plantings, crops);
    expect(rest).toEqual([]);
    expect(alert).toMatchObject({
      kind: 'mildew',
      level: 'moyen',
      date: '2026-07-16',
      daysAhead: 2,
      estimate: true,
      crops: [{ species: 'tomate', name: 'Tomate' }],
      inputs: { from: '2026-07-16', to: '2026-07-16', repeat: false, qualifyingDays: 2, tminC: 11, minHumidHours: 8 },
    });
    expect(alert!.inputs.params).toEqual(MILDEW_PARAMS);
    expect(alert!.inputs.days.map((d) => d.date)).toEqual(['2026-07-15', '2026-07-16']);
    expect(alert!.reason).toBe(
      "Risque de mildiou moyen sur tomate à partir du jeudi 16 juillet (2 jours doux et humides : mini 11 °C, au moins 8 h à 90 % d'humidité ou plus). Arrose au pied le matin, jamais le feuillage. Retire les feuilles du bas qui touchent le sol. Surveille les taches brunes.",
    );
  });

  it('adds the removal advice on an eleve run', () => {
    const [alert] = mildewAlerts(week({ 0: SOAKED, 1: SOAKED }), { today: TODAY }, [planting('patate')], crops);
    expect(alert!.level).toBe('eleve');
    expect(alert!.crops).toEqual([{ species: 'pomme-de-terre', name: 'Pomme de terre' }]);
    expect(alert!.reason).toBe(
      "Risque de mildiou élevé sur pomme de terre depuis hier (2 jours doux et humides : mini 12 °C, au moins 12 h à 90 % d'humidité ou plus). Arrose au pied le matin, jamais le feuillage. Retire les feuilles du bas qui touchent le sol. Surveille les taches brunes. Si une tache apparaît, coupe la feuille et sors-la du jardin, ne la composte pas.",
    );
  });

  it.each([
    [1, "dès aujourd'hui"],
    [2, 'à partir de demain'],
  ] as const)('words the start of a run that begins on day index %s', (start, when) => {
    const hours = week({ [start]: HUMID, [start + 1]: HUMID });
    const [alert] = mildewAlerts(hours, { today: TODAY }, plantings, crops);
    expect(alert!.reason).toContain(`sur tomate ${when} (`);
  });

  it('stays silent without a host crop in open ground', () => {
    const hours = week({ 3: SOAKED, 4: SOAKED });
    expect(mildewAlerts(hours, { today: TODAY }, [planting('salade')], crops)).toEqual([]);
    expect(mildewAlerts(hours, { today: TODAY }, [planting('tomate', { method: 'pot' })], crops)).toEqual([]);
    expect(mildewAlerts(hours, { today: TODAY }, [planting('tomate', { status: 'done' })], crops)).toEqual([]);
    expect(mildewAlerts(hours, { today: TODAY }, [planting('tomate', { sownOn: '2026-07-17' })], crops)).toEqual([]);
    expect(mildewAlerts(hours, { today: TODAY }, [planting('tomate', { harvestedOn: '2026-07-10' })], crops)).toEqual([]);
  });

  it('counts a pot sowing from its transplant', () => {
    const hours = week({ 3: SOAKED, 4: SOAKED });
    const pot = planting('tomate', { method: 'pot', sownOn: '2026-04-01', transplantedOn: '2026-05-10' });
    expect(mildewAlerts(hours, { today: TODAY }, [pot], crops)).toHaveLength(1);
  });

  it.each([
    ['2026-04-02', 1],
    ['2026-03-31', 0],
    ['2026-10-30', 1],
    ['2026-11-02', 0],
  ] as const)('keeps to April to October: a period on %s gives %s alert', (date, count) => {
    const hours = days(date.replace(/\d\d$/, (d) => String(Number(d) - 1).padStart(2, '0')), [HUMID, HUMID]);
    const alerts = mildewAlerts(hours, { today: date }, [planting('tomate', { sownOn: '2026-03-01' })], crops);
    expect(alerts).toHaveLength(count);
  });

  it('flags a run that continues the one already sent', () => {
    const hours = week({ 3: HUMID, 4: HUMID });
    const opts = (lastAlertedOn: string) => ({ today: TODAY, lastAlertedOn });
    expect(mildewAlerts(hours, opts('2026-07-14'), plantings, crops)[0]!.inputs.repeat).toBe(true);
    expect(mildewAlerts(hours, opts('2026-07-13'), plantings, crops)[0]!.inputs.repeat).toBe(true);
    expect(mildewAlerts(hours, opts('2026-07-12'), plantings, crops)[0]!.inputs.repeat).toBe(true);
    expect(mildewAlerts(hours, opts('2026-07-11'), plantings, crops)[0]!.inputs.repeat).toBe(false);
  });

  it('ignores hours with no humidity at all', () => {
    const hours = week({ 3: HUMID, 4: HUMID }).map((h) => ({ ...h, relative_humidity_2m: null }));
    expect(mildewAlerts(hours, { today: TODAY }, plantings, crops)).toEqual([]);
  });

  it('lists every model that fed the run', () => {
    const hours = week({ 3: HUMID, 4: HUMID }).map((h) =>
      h.ts.startsWith('2026-07-16') ? hour(h.ts, h.temperature_2m!, { ...h, model: 'best_match', modelOf: { temperature_2m: 'best_match' } }) : h,
    );
    const [alert] = mildewAlerts(hours, { today: TODAY }, plantings, crops);
    expect(alert!.inputs.models).toEqual(['meteofrance_arome_france_hd', 'best_match']);
  });
});
