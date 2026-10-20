import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { WIND_CROPS, WIND_PARAMS, windAlerts } from '../src/index.js';
import { crop, day, days, planting } from './day-fixtures.js';

const TODAY = '2026-10-20'; // a Tuesday
const tomate = crop('tomate', 'Tomate');
const haricot = crop('haricot', 'Haricot');
const poireau = crop('poireau', 'Poireau');
const crops = [tomate, haricot, poireau];
const staked = [planting('tomate'), planting('haricot')];
const gusty = (date: string, gust: number) => day(date, (h) => ({ wind_gusts_10m: h === 14 ? gust : 20 }));

describe('wind rule boundaries (agronomy 7)', () => {
  it.each([
    [57.9, 0],
    [58, 1],
  ])('gusts of %s km/h give %s alert', (gust, count) => {
    expect(windAlerts(gusty('2026-10-22', gust), staked, crops, { today: TODAY })).toHaveLength(count);
  });

  it.each([
    ['2026-03-31', 0],
    ['2026-04-01', 1],
    ['2026-10-31', 1],
    ['2026-11-01', 0],
  ])('a gusty %s gives %s alert (April to October)', (date, count) => {
    const early = [planting('tomate', { sownOn: '2026-03-01' })];
    expect(windAlerts(gusty(date, 70), early, crops, { today: date })).toHaveLength(count);
  });
});

describe('windAlerts', () => {
  it('names the day, the gust and the staked crops', () => {
    const [a] = windAlerts(gusty('2026-10-22', 64.6), staked, crops, { today: TODAY, fleece: true });
    expect(a).toMatchObject({
      kind: 'wind',
      level: 'rafales',
      date: '2026-10-22',
      daysAhead: 2,
      estimate: true,
      crops: [{ species: 'tomate' }, { species: 'haricot' }],
      inputs: { gustMaxKmh: 64.6, fleece: true },
    });
    expect(a!.inputs.params.gustKmh).toEqual(WIND_PARAMS.gustKmh);
    expect(a!.reason).toBe('Rafales à 65 km/h prévues jeudi 22 octobre. Vérifie les tuteurs (tomate, haricot) et leste les voiles.');
  });

  it('adapts the advice to what is in the garden', () => {
    const reason = (plantings = staked, fleece = false) => windAlerts(gusty(TODAY, 60), plantings, crops, { today: TODAY, fleece })[0]?.reason;
    expect(reason([planting('tomate')])).toBe("Rafales à 60 km/h prévues aujourd'hui. Vérifie les tuteurs (tomate).");
    expect(reason([planting('poireau')], true)).toBe("Rafales à 60 km/h prévues aujourd'hui. Leste les voiles.");
    expect(reason([planting('poireau')])).toBeUndefined();
    expect(reason([planting('tomate', { status: 'done' })])).toBeUndefined();
  });

  it('gives one alert per gusty day from today on', () => {
    const hours = days('2026-10-19', 4, (i, h) => ({ wind_gusts_10m: h === 10 ? [80, 30, 70, 59][i]! : 10 }));
    const list = windAlerts(hours, staked, crops, { today: TODAY });
    expect(list.map((a) => [a.date, a.reason.slice(0, 40)])).toEqual([
      ['2026-10-21', 'Rafales à 70 km/h prévues demain. Vérifi'],
      ['2026-10-22', 'Rafales à 59 km/h prévues jeudi 22 octob'],
    ]);
  });

  it('ignores a day without gust data', () => {
    expect(windAlerts(day(TODAY, () => ({ wind_gusts_10m: null })), staked, crops, { today: TODAY })).toEqual([]);
  });

  it('lists the staked crops as an estimate', () => {
    expect(WIND_CROPS).toEqual({ value: ['tomate', 'haricot'], estimate: true });
  });
});

describe('wind properties', () => {
  it('alerts exactly when the gust reaches the threshold inside the season', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 150, noNaN: true }), (gust) => {
        const count = windAlerts(gusty('2026-06-10', gust), staked, crops, { today: '2026-06-10' }).length;
        expect(count).toBe(gust >= WIND_PARAMS.gustKmh.value ? 1 : 0);
      }),
      { numRuns: 100 },
    );
  });
});
