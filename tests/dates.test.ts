import { describe, expect, it } from 'vitest';
import { addDays, isTooFarInFuture, isValidCivilDate } from '../src/index.js';

describe('isValidCivilDate', () => {
  it('accepts real dates and leap days only', () => {
    expect(isValidCivilDate('2026-06-01')).toBe(true);
    expect(isValidCivilDate('2024-02-29')).toBe(true);
    expect(isValidCivilDate('2026-02-29')).toBe(false);
    expect(isValidCivilDate('2026-02-30')).toBe(false);
    expect(isValidCivilDate('2026-13-45')).toBe(false);
    expect(isValidCivilDate('26-1-1')).toBe(false);
  });
});

describe('isTooFarInFuture', () => {
  it('allows today and tomorrow, refuses later', () => {
    expect(isTooFarInFuture('2026-06-10', '2026-06-10')).toBe(false);
    expect(isTooFarInFuture('2026-06-11', '2026-06-10')).toBe(false);
    expect(isTooFarInFuture('2026-06-12', '2026-06-10')).toBe(true);
    expect(isTooFarInFuture('2027-01-01', '2026-12-31')).toBe(false);
    expect(isTooFarInFuture('2027-01-02', '2026-12-31')).toBe(true);
  });
});

describe('addDays', () => {
  it('moves across month, year and leap boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
