import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assessNights, frostLevel, type FrostLevel } from '../src/index.js';
import { night } from './hourly-fixtures.js';

const RANK: Record<FrostLevel | 'none', number> = { none: 0, faible: 1, fort: 2, gel: 3 };
const rank = (l: FrostLevel | null) => RANK[l ?? 'none'];
const level = (tmin: number, cloud: number, wind: number) =>
  assessNights(night('2026-10-22', { tmin, cloud, wind }), { today: '2026-10-20' })[0]!.level;

describe('frost level at the agronomy 2.2 boundaries', () => {
  it.each([
    // tmin, cloud, wind, level
    [0, 90, 20, 'gel'],
    [0.1, 90, 20, 'fort'],
    [2, 90, 20, 'fort'],
    [2.1, 90, 20, null],
    [4, 29.9, 9.9, 'fort'],
    [4, 30, 9.9, null],
    [4, 29.9, 10, null],
    [4.1, 29.9, 9.9, 'faible'],
    [6, 29.9, 9.9, 'faible'],
    [6.1, 29.9, 9.9, null],
    [6, 30, 9.9, null],
    [6, 29.9, 10, null],
  ] as const)('tmin %s °C, cloud %s %%, wind %s km/h gives %s', (tmin, cloud, wind, expected) => {
    expect(level(tmin, cloud, wind)).toBe(expected);
  });
});

describe('frost level properties', () => {
  const tmin = fc.double({ min: -10, max: 12, noNaN: true });
  const cloud = fc.double({ min: 0, max: 100, noNaN: true });
  const wind = fc.double({ min: 0, max: 60, noNaN: true });

  it('never drops when the night gets colder', () => {
    fc.assert(
      fc.property(tmin, fc.double({ min: 0, max: 5, noNaN: true }), cloud, wind, (t, drop, c, w) => {
        expect(rank(frostLevel(t - drop, c, w))).toBeGreaterThanOrEqual(rank(frostLevel(t, c, w)));
      }),
    );
  });

  it('never drops when the sky clears or the wind falls', () => {
    fc.assert(
      fc.property(tmin, cloud, wind, (t, c, w) => {
        expect(rank(frostLevel(t, 0, 0))).toBeGreaterThanOrEqual(rank(frostLevel(t, c, w)));
      }),
    );
  });

  it('is gel exactly at or below 0 °C, whatever the sky', () => {
    fc.assert(
      fc.property(tmin, cloud, wind, (t, c, w) => {
        expect(frostLevel(t, c, w) === 'gel').toBe(t <= 0);
      }),
    );
  });

  it('is silent above 6 °C', () => {
    fc.assert(
      fc.property(fc.double({ min: 6.0001, max: 30, noNaN: true }), cloud, wind, (t, c, w) => {
        expect(frostLevel(t, c, w)).toBeNull();
      }),
    );
  });

  it('treats unknown cloud or wind as neither clear nor calm', () => {
    fc.assert(
      fc.property(fc.double({ min: 2.0001, max: 6, noNaN: true }), (t) => {
        expect(frostLevel(t, null, 0)).toBeNull();
        expect(frostLevel(t, 0, null)).toBeNull();
      }),
    );
  });

  it('matches the hourly assessment', () => {
    fc.assert(
      fc.property(tmin, cloud, wind, (t, c, w) => {
        expect(level(t, c, w)).toBe(frostLevel(t, c, w));
      }),
      { numRuns: 200 },
    );
  });
});
