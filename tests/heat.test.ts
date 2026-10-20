import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assessHeatDays, HEAT_PARAMS, heatAlerts, type HourlyWeather } from '../src/index.js';
import { crop, days, planting } from './day-fixtures.js';

const TODAY = '2026-07-14'; // a Tuesday
const tomate = crop('tomate', 'Tomate');
const salade = crop('salade', 'Salade');
const epinard = crop('epinard', 'Épinard');
const crops = [tomate, salade, epinard];

/** Days from `from`, each with a daytime maximum at 15:00 and a night minimum at 05:00. */
const weather = (from: string, list: { max: number; min?: number }[]): HourlyWeather[] =>
  days(from, list.length, (i, h) => {
    const { max, min } = list[i]!;
    const low = min ?? 15;
    // The night of day i runs from 18:00 on day i to 09:00 on day i + 1, so day i's 05:00 holds night i - 1's minimum.
    const prevMin = list[i - 1]?.min ?? low;
    if (h === 15) return { t: max };
    if (h === 5) return { t: i === 0 ? low : prevMin };
    return { t: Math.max(low, prevMin) + 1 };
  });
const flat = (n: number, max: number, min = 15, from = TODAY) => weather(from, Array.from({ length: n }, () => ({ max, min })));

describe('assessHeatDays at the boundaries', () => {
  const one = (max: number, min: number) => assessHeatDays(flat(3, max, min), { today: TODAY })[0]!;

  it.each([
    [29.9, false, false],
    [30, true, false],
    [34.9, true, false],
    [35, true, true],
  ])('a maximum of %s °C: heat day %s, canicule %s', (max, heatDay, canicule) => {
    expect(one(max, 15)).toMatchObject({ tmaxC: max, heatDay, canicule });
  });

  it.each([
    [26.9, false],
    [27, true],
  ])('a maximum of %s °C is a bolting day: %s', (max, bolting) => {
    expect(one(max, 15).bolting).toBe(bolting);
  });

  it.each([
    [23.9, false],
    [24, true],
  ])('a night minimum of %s °C is a hot night: %s', (min, hot) => {
    expect(one(32, min)).toMatchObject({ nightMinC: min, hotNight: hot });
  });

  it('leaves the hot night unknown when the night is cut short', () => {
    const list = assessHeatDays(flat(2, 32, 25), { today: TODAY });
    expect(list.map((d) => d.hotNight)).toEqual([true, null]);
  });
});

describe('heatAlerts', () => {
  it('warns of a canicule once per run, with the hottest maximum and what to do', () => {
    const hours = weather(TODAY, [{ max: 31 }, { max: 36 }, { max: 38 }, { max: 35 }, { max: 30 }]);
    const alerts = heatAlerts(hours, [planting('tomate')], crops, { today: TODAY });
    const canicule = alerts.filter((a) => a.level === 'canicule');
    expect(canicule).toHaveLength(1);
    expect(canicule[0]).toMatchObject({ kind: 'heat', date: '2026-07-15', daysAhead: 1, estimate: true, crops: [{ species: 'tomate' }] });
    expect(canicule[0]!.inputs).toMatchObject({ from: '2026-07-15', to: '2026-07-17', days: 3, peakC: 38 });
    expect(canicule[0]!.inputs.params.caniculeC).toEqual(HEAT_PARAMS.caniculeC);
    expect(canicule[0]!.reason).toBe(
      'Canicule 3 jours à partir de demain (maxi prévue 38 °C). Arrose tôt le matin, paille le sol et ombre les jeunes plants.',
    );
  });

  it('writes a one-day canicule from today without "à partir de"', () => {
    const [a] = heatAlerts(weather(TODAY, [{ max: 35.4 }, { max: 25 }]), [planting('tomate')], crops, { today: TODAY });
    expect(a!.reason).toBe("Canicule aujourd'hui (maxi prévue 35,4 °C). Arrose tôt le matin, paille le sol et ombre les jeunes plants.");
  });

  it('says nothing about heat when nothing is in the ground', () => {
    expect(heatAlerts(flat(5, 38, 26), [], crops, { today: TODAY })).toEqual([]);
  });

  it('warns about tomato fruit set after three hot nights in a row, not two', () => {
    const tomatoes = [planting('tomate', { method: 'pot', sownOn: '2026-04-01', transplantedOn: '2026-05-15' })];
    const nights = (n: number) => weather(TODAY, [...Array.from({ length: n }, () => ({ max: 29, min: 25 })), { max: 25, min: 15 }, { max: 25, min: 15 }]);
    expect(heatAlerts(nights(2), tomatoes, crops, { today: TODAY })).toEqual([]);
    const [a] = heatAlerts(nights(3), tomatoes, crops, { today: TODAY });
    expect(a).toMatchObject({ level: 'nouaison', date: '2026-07-16', daysAhead: 2, crops: [{ species: 'tomate' }], estimate: true });
    expect(a!.inputs).toMatchObject({ from: '2026-07-14', to: '2026-07-16', days: 3, peakC: 25 });
    expect(a!.reason).toBe(
      "Nuits chaudes : 3 nuits de suite à 24 °C ou plus à partir d'aujourd'hui. La tomate va perdre des fleurs : paille et arrose régulièrement, la nouaison reprendra avec la fraîcheur.",
    );
  });

  it('skips young tomatoes that are not flowering yet', () => {
    const young = [planting('tomate', { method: 'pot', sownOn: '2026-05-01', transplantedOn: '2026-07-01' })];
    expect(heatAlerts(flat(5, 29, 25), young, crops, { today: TODAY })).toEqual([]);
  });

  it('still warns for flowering tomatoes when a younger tomato batch went in later, in either order', () => {
    const old = planting('tomate', { sownOn: '2026-05-01' });
    const young = planting('tomate', { sownOn: '2026-07-01' });
    const hours = flat(6, 28, 25);
    expect(heatAlerts(hours, [old], crops, { today: TODAY }).map((a) => a.level)).toEqual(['nouaison']);
    expect(heatAlerts(hours, [old, young], crops, { today: TODAY }).map((a) => a.level)).toEqual(['nouaison']);
    expect(heatAlerts(hours, [young, old], crops, { today: TODAY }).map((a) => a.level)).toEqual(['nouaison']);
    expect(heatAlerts(hours, [young], crops, { today: TODAY })).toEqual([]);
  });

  it('keeps a run that started in the past and still goes on, dated today', () => {
    const hours = flat(6, 29, 25, '2026-07-10');
    const [a] = heatAlerts(hours, [planting('tomate')], crops, { today: TODAY });
    expect(a).toMatchObject({ level: 'nouaison', date: TODAY, daysAhead: 0, inputs: { from: '2026-07-10' } });
    expect(a!.reason).toContain('à partir de vendredi 10 juillet');
  });

  it('drops a run that ended before today', () => {
    const hours = [...flat(4, 29, 25, '2026-07-08'), ...flat(4, 22, 12, '2026-07-12')];
    expect(heatAlerts(hours, [planting('tomate')], crops, { today: TODAY })).toEqual([]);
  });

  it('warns that salads and spinach will bolt after three days at 27 °C or more', () => {
    const hours = weather(TODAY, [{ max: 27 }, { max: 28 }, { max: 27.5 }, { max: 22 }]);
    const alerts = heatAlerts(hours, [planting('salade'), planting('epinard'), planting('tomate')], crops, { today: TODAY });
    expect(alerts.map((a) => a.level)).toEqual(['montaison']);
    expect(alerts[0]).toMatchObject({ date: '2026-07-16', crops: [{ species: 'salade' }, { species: 'epinard' }], inputs: { peakC: 28 } });
    expect(alerts[0]!.reason).toBe(
      "Chaleur durable : 3 jours de suite à 27 °C ou plus à partir d'aujourd'hui. Salade, épinard vont monter en graines : récolte les plus avancées, ombre les autres.",
    );
    const single = heatAlerts(weather(TODAY, [{ max: 27 }, { max: 28 }, { max: 27 }, { max: 22 }]), [planting('salade')], crops, { today: TODAY });
    expect(single[0]!.reason).toContain('Salade va monter en graines');
    expect(heatAlerts(weather(TODAY, [{ max: 27 }, { max: 28 }, { max: 22 }]), [planting('salade')], crops, { today: TODAY })).toEqual([]);
  });

  it('orders alerts by date then level', () => {
    const hours = flat(4, 36, 25);
    const levels = heatAlerts(hours, [planting('tomate'), planting('salade')], crops, { today: TODAY }).map((a) => [a.date, a.level]);
    expect(levels).toEqual([
      ['2026-07-14', 'canicule'],
      ['2026-07-16', 'nouaison'],
      ['2026-07-16', 'montaison'],
    ]);
  });
});

describe('heat properties', () => {
  it('a canicule day is always a heat day and a bolting day', () => {
    fc.assert(
      fc.property(fc.double({ min: 10, max: 45, noNaN: true }), (max) => {
        const d = assessHeatDays(flat(2, max), { today: TODAY })[0]!;
        if (d.canicule) expect(d.heatDay && d.bolting).toBe(true);
        if (d.heatDay) expect(d.bolting).toBe(true);
      }),
    );
  });
});
