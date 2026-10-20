import { describe, expect, it } from 'vitest';
import { cropsInGround, dayLabel, daysOf, runsOf } from '../src/index.js';
import { crop, day, planting } from './day-fixtures.js';
import { hour } from './hourly-fixtures.js';

describe('daysOf', () => {
  it('gives each calendar day its maximum temperature, soil means and maxima, gusts and rain', () => {
    const hours = day('2026-10-22', (h) => ({
      t: h === 15 ? 21 : 12,
      soil_temperature_6cm: h < 12 ? 10 : 14,
      soil_temperature_18cm: 11,
      wind_gusts_10m: h === 3 ? 60 : 20,
      precipitation: h < 4 ? 0.5 : 0,
    }));
    expect(daysOf(hours)).toEqual([
      {
        date: '2026-10-22',
        hours: 24,
        tmaxC: 21,
        soil6MeanC: 12,
        soil6MaxC: 14,
        soil18MeanC: 11,
        gustMaxKmh: 60,
        precipMm: 2,
      },
    ]);
  });

  it('sorts days and leaves a variable unknown when every hour lacks it', () => {
    const hours = [
      ...day('2026-10-23', () => ({ soil_temperature_6cm: null, soil_temperature_18cm: null, wind_gusts_10m: null, precipitation: null })),
      hour('2026-10-22T23:00', 9),
    ];
    const [first, second] = daysOf(hours);
    expect(first).toMatchObject({ date: '2026-10-22', hours: 1, tmaxC: 9 });
    expect(second).toMatchObject({ soil6MeanC: null, soil6MaxC: null, soil18MeanC: null, gustMaxKmh: null, precipMm: null });
  });

  it('ignores an hour without temperature for the maximum', () => {
    const hours = [hour('2026-10-22T10:00', 9), hour('2026-10-22T11:00', 0, { temperature_2m: null })];
    expect(daysOf(hours)[0]!.tmaxC).toBe(9);
  });
});

describe('dayLabel', () => {
  it.each([
    ['2026-10-20', "aujourd'hui"],
    ['2026-10-21', 'demain'],
    ['2026-10-22', 'jeudi 22 octobre'],
    ['2026-11-01', 'dimanche 1er novembre'],
  ])('%s reads %s from Tuesday 20 October', (date, label) => {
    expect(dayLabel(date, '2026-10-20')).toBe(label);
  });
});

describe('runsOf', () => {
  it('groups consecutive dates that pass the test', () => {
    const items = ['2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25'].map((date) => ({ date, ok: date !== '2026-10-24' }));
    expect(runsOf(items, (i) => i.ok).map((r) => r.map((i) => i.date))).toEqual([['2026-10-20', '2026-10-21'], ['2026-10-23'], ['2026-10-25']]);
  });

  it('splits a run at a missing date', () => {
    const items = ['2026-10-20', '2026-10-22'].map((date) => ({ date }));
    expect(runsOf(items, () => true)).toHaveLength(2);
  });
});

describe('cropsInGround', () => {
  const salade = crop('salade', 'Salade');
  const tomate = crop('tomate', 'Tomate', { aliases: ['tomate-cerise'] });

  it('keeps active plantings in open ground on the date, once per crop, with the latest date', () => {
    const list = cropsInGround(
      [
        planting('salade', { sownOn: '2026-09-01' }),
        planting('salade', { sownOn: '2026-10-10' }),
        planting('tomate-cerise', { sownOn: '2026-04-01', method: 'pot', transplantedOn: '2026-05-10' }),
      ],
      [salade, tomate],
      '2026-10-20',
    );
    expect(list.map((g) => [g.crop.id, g.since])).toEqual([
      ['salade', '2026-10-10'],
      ['tomate', '2026-05-10'],
    ]);
  });

  it('leaves out pots not yet transplanted, later sowings, closed, harvested and unknown plantings', () => {
    const list = cropsInGround(
      [
        planting('tomate', { method: 'pot', sownOn: '2026-10-01' }),
        planting('salade', { sownOn: '2026-10-25' }),
        planting('salade', { status: 'done' }),
        planting('salade', { harvestedOn: '2026-10-19' }),
        planting('inconnu'),
      ],
      [salade, tomate],
      '2026-10-20',
    );
    expect(list).toEqual([]);
  });
});
