import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { daysBetween } from '../src/alerts/format.js';
import { mildewDays, mildewPeriods, mildewRuns, type MildewLevel } from '../src/index.js';
import { days, type DayShape } from './hourly-fixtures.js';

const TODAY = '2026-07-14';
const RANK: Record<MildewLevel | 'none', number> = { none: 0, moyen: 1, eleve: 2 };
const shape = fc.record({ tmin: fc.double({ min: 5, max: 20, noNaN: true }), humidHours: fc.integer({ min: 0, max: 24 }) });
const week = fc.array(shape, { minLength: 7, maxLength: 7 });
const levels = (shapes: DayShape[]) => {
  const byDate = new Map(mildewPeriods(days('2026-07-12', shapes), { today: TODAY }).map((p) => [p.date, p.level]));
  return ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18'].map((d) => RANK[byDate.get(d) ?? 'none']);
};

describe('mildew properties', () => {
  it('a Smith day is always a Hutton day', () => {
    fc.assert(
      fc.property(week, (shapes) => {
        for (const d of mildewDays(days('2026-07-12', shapes))) if (d.smith) expect(d.hutton).toBe(true);
      }),
    );
  });

  it('more humid hours or a warmer minimum never lower the level of any day', () => {
    fc.assert(
      fc.property(week, fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 12 }), fc.double({ min: 0, max: 5, noNaN: true }), (shapes, i, moreHours, warmer) => {
        const boosted = shapes.map((s, j) => (j === i ? { tmin: s.tmin + warmer, humidHours: Math.min(24, s.humidHours + moreHours) } : s));
        const before = levels(shapes);
        levels(boosted).forEach((rank, k) => expect(rank).toBeGreaterThanOrEqual(before[k]!));
      }),
    );
  });

  it('runs cover every period once, in order, with dry gaps of three days or more between them', () => {
    fc.assert(
      fc.property(week, (shapes) => {
        const periods = mildewPeriods(days('2026-07-12', shapes), { today: TODAY });
        const runs = mildewRuns(periods);
        expect(runs.flatMap((r) => r.periods)).toEqual(periods);
        for (const r of runs) expect(r.level).toBe(r.periods.some((p) => p.level === 'eleve') ? 'eleve' : 'moyen');
        runs.slice(1).forEach((r, k) => expect(daysBetween(runs[k]!.to, r.periods[0]!.days[0].date) - 1).toBeGreaterThanOrEqual(3));
      }),
    );
  });
});
