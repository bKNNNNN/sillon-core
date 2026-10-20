import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SLUG_CROPS, SLUG_PARAMS, slugAlerts, type HourlyWeather } from '../src/index.js';
import { crop, days, planting } from './day-fixtures.js';

const TODAY = '2026-10-20'; // a Tuesday
const salade = crop('salade', 'Salade');
const haricot = crop('haricot', 'Haricot');
const ail = crop('ail', 'Ail');
const crops = [salade, haricot, ail];
const young = [planting('salade', { sownOn: '2026-10-10' }), planting('haricot', { sownOn: '2026-10-05' })];

type Shape = { t?: number; rh?: number; rain?: (ts: string) => number };
/** Dry, mild weather from 18 to 23 October (nights of the 18th to the 22nd complete). */
const weather = ({ t = 12, rh = 80, rain = () => 0 }: Shape = {}): HourlyWeather[] =>
  days('2026-10-18', 6, () => ({ t, relative_humidity_2m: rh })).map((h) => ({ ...h, precipitation: rain(h.ts) }));
const rainAt = (when: string, mm: number) => (ts: string) => (ts === when ? mm : 0);
const nightsOf = (hours: HourlyWeather[], plantings = young, lastAlertOn?: string) =>
  slugAlerts(hours, plantings, crops, { today: TODAY, lastAlertOn }).map((a) => a.date);

describe('slug rule boundaries (agronomy 8)', () => {
  it.each([
    [1.9, []],
    [2, ['2026-10-20']],
  ])('%s mm in the 48 h before the night', (mm, expected) => {
    expect(nightsOf(weather({ rain: rainAt('2026-10-19T20:00', mm) }))).toEqual(expected);
  });

  it('counts rain from 48 h before the night starts, not earlier', () => {
    expect(nightsOf(weather({ rain: rainAt('2026-10-18T17:00', 5) }))).toEqual([]);
    expect(nightsOf(weather({ rain: rainAt('2026-10-18T18:00', 5) }))).toEqual(['2026-10-20']);
  });

  it('counts humid hours at 90 % or more during the night', () => {
    const humid = (n: number, rh = 90) =>
      weather().map((h) => {
        const inNight = (h.ts >= '2026-10-21T00:00' && h.ts < `2026-10-21T${String(n).padStart(2, '0')}:00`);
        return inNight ? { ...h, relative_humidity_2m: rh } : h;
      });
    expect(nightsOf(humid(5))).toEqual([]);
    expect(nightsOf(humid(6))).toEqual(['2026-10-20']);
    expect(nightsOf(humid(6, 89.9))).toEqual([]);
  });

  it.each([
    [4.9, []],
    [5, ['2026-10-20']],
    [20, ['2026-10-20']],
    [20.1, []],
  ])('a night mean of %s °C', (t, expected) => {
    expect(nightsOf(weather({ t, rh: 95 }))).toEqual(expected);
  });

  it('needs a young slug-prone crop: under 21 days in the ground, in the list', () => {
    const wet = weather({ rh: 95 });
    expect(nightsOf(wet, [planting('salade', { sownOn: '2026-09-30' })])).toEqual(['2026-10-20']);
    expect(nightsOf(wet, [planting('salade', { sownOn: '2026-09-29' })])).toEqual([]);
    expect(nightsOf(wet, [planting('ail', { sownOn: '2026-10-15' })])).toEqual([]);
    expect(nightsOf(wet, [planting('salade', { sownOn: '2026-10-21' })])).toEqual(['2026-10-21']);
  });
});

describe('slugAlerts', () => {
  it('names the young crops, the night and what to do, with its inputs', () => {
    const [a] = slugAlerts(weather({ rain: rainAt('2026-10-19T20:00', 3) }), young, crops, { today: TODAY });
    expect(a).toMatchObject({
      kind: 'slugs',
      level: 'probable',
      date: '2026-10-20',
      daysAhead: 0,
      estimate: true,
      crops: [{ species: 'salade' }, { species: 'haricot' }],
      inputs: { rain48Mm: 3, humidHours: 0, nightMeanC: 12, wet: true, mild: true },
    });
    expect(a!.inputs.params.youngDays).toEqual(SLUG_PARAMS.youngDays);
    expect(a!.reason).toBe(
      'Sortie de limaces probable la nuit du mardi 20 au mercredi 21 octobre (sol humide, nuit douce). Fais un tour à la tombée de la nuit autour des jeunes plants : salade, haricot.',
    );
  });

  it('says the air is humid when no rain fell', () => {
    const [a] = slugAlerts(weather({ rh: 95 }), young, crops, { today: TODAY });
    expect(a!.reason).toContain('(air très humide, nuit douce)');
    expect(a!.inputs).toMatchObject({ rain48Mm: 0, humidHours: 16 });
  });

  it('keeps at most one alert every three days', () => {
    expect(nightsOf(weather({ rh: 95 }))).toEqual(['2026-10-20']);
    const longer = days('2026-10-18', 9, () => ({ t: 12, relative_humidity_2m: 95 }));
    expect(nightsOf(longer)).toEqual(['2026-10-20', '2026-10-23']);
  });

  it('counts the last alert already sent', () => {
    const longer = days('2026-10-18', 9, () => ({ t: 12, relative_humidity_2m: 95 }));
    expect(nightsOf(longer, young, '2026-10-18')).toEqual(['2026-10-21', '2026-10-24']);
    expect(nightsOf(longer, young, '2026-10-17')).toEqual(['2026-10-20', '2026-10-23']);
  });

  it('skips nights before today and nights cut short by the forecast end', () => {
    const hours = weather({ rh: 95 }).filter((h) => h.ts < '2026-10-21T03:00');
    expect(nightsOf(hours)).toEqual([]);
  });

  it('lists the crop names it watches as an estimate', () => {
    expect(SLUG_CROPS.estimate).toBe(true);
    expect(SLUG_CROPS.value).toContain('salade');
  });
});

describe('slug properties', () => {
  it('never alerts on a dry night', () => {
    fc.assert(
      fc.property(fc.double({ min: -5, max: 30, noNaN: true }), fc.double({ min: 0, max: 89.9, noNaN: true }), (t, rh) => {
        expect(nightsOf(weather({ t, rh }))).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });

  it('alerts are always three days apart or more', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), (wetDays) => {
        const hours = days('2026-10-18', 12, (i) => ({ t: 12, relative_humidity_2m: wetDays[i] ? 95 : 70 }));
        const dates = nightsOf(hours);
        for (let i = 1; i < dates.length; i++) {
          expect(Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)).toBeGreaterThanOrEqual(3 * 86_400_000);
        }
      }),
      { numRuns: 50 },
    );
  });
});
