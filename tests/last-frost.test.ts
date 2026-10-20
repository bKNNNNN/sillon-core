import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  calibrateFrostThreshold,
  lastFrostStats,
  MERIGNAC_FROST_DAYS,
  type DailyMin,
} from '../src/index.js';

/** ERA5-Land daily minimum at Le Pian-Médoc (grid cell 45.0, -0.7), 1991 to 2020, recorded 2026-10-20. */
const archive = JSON.parse(readFileSync(new URL('./fixtures/era5-land-tmin-1991-2020.json', import.meta.url), 'utf8')) as {
  daily: { time: string[]; temperature_2m_min: number[] };
};
const recorded: DailyMin[] = archive.daily.time.map((date, i) => ({ date, tmin: archive.daily.temperature_2m_min[i]! }));

/** A full year at 10 °C, with frost (-1 °C) on the given MM-DD days. */
function year(y: number, frostDays: string[] = []): DailyMin[] {
  const days: DailyMin[] = [];
  for (let d = `${y}-01-01`; d.startsWith(String(y)); d = addDays(d, 1)) {
    days.push({ date: d, tmin: frostDays.includes(d.slice(5)) ? -1 : 10 });
  }
  return days;
}

describe('lastFrostStats', () => {
  it('takes the last spring frost and the first autumn frost of each year', () => {
    const s = lastFrostStats(year(2020, ['01-10', '03-15', '06-30', '07-01', '11-20', '12-24']));
    expect(s.perYear).toEqual([{ year: 2020, lastFrost: '2020-06-30', firstFrost: '2020-07-01' }]);
  });

  it('gives the median and the 9-in-10 safe date with nearest-rank percentiles', () => {
    const days = Array.from({ length: 10 }, (_, i) => year(2001 + i, [`03-${String(10 + i).padStart(2, '0')}`, `11-${String(10 + i).padStart(2, '0')}`])).flat();
    const s = lastFrostStats(days);
    expect(s.years).toBe(10);
    expect(s.spring).toEqual({ median: '03-14', safe: '03-18' });
    expect(s.autumn).toEqual({ median: '11-14', early: '11-10' });
    expect(s.inputs).toMatchObject({ thresholdC: 0, percentileMethod: 'nearest-rank', from: '2001-01-01', to: '2010-12-31' });
    expect(s.estimate).toBe(true);
    expect(s.reason).toBe(
      "D'après 10 ans d'historique, la dernière gelée de printemps tombe en médiane le 14 mars. Après le 18 mars, 9 printemps sur 10 n'en ont plus. La première gelée d'automne arrive en médiane le 14 novembre, et 1 automne sur 10 dès le 10 novembre.",
    );
  });

  it('counts years without frost instead of dropping them', () => {
    const frosty = Array.from({ length: 4 }, (_, i) => year(2001 + i, ['03-20', '11-15'])).flat();
    const quiet = Array.from({ length: 6 }, (_, i) => year(2005 + i)).flat();
    const s = lastFrostStats([...frosty, ...quiet]);
    expect(s.years).toBe(10);
    expect(s.yearsWithoutSpringFrost).toBe(6);
    expect(s.yearsWithoutAutumnFrost).toBe(6);
    expect(s.spring).toEqual({ median: null, safe: '03-20' });
    expect(s.autumn).toEqual({ median: null, early: '11-15' });
    expect(s.perYear[5]).toEqual({ year: 2006, lastFrost: null, firstFrost: null });
    expect(s.reason).toBe(
      "D'après 10 ans d'historique, au moins un printemps sur deux n'a pas de gelée. Après le 20 mars, 9 printemps sur 10 n'en ont plus. Au moins un automne sur deux n'a pas de gelée avant le 31 décembre, et 1 automne sur 10 en a une dès le 15 novembre.",
    );
  });

  it('says so when almost no year has frost', () => {
    const s = lastFrostStats(Array.from({ length: 10 }, (_, i) => year(2001 + i)).flat());
    expect(s.spring).toEqual({ median: null, safe: null });
    expect(s.reason).toBe("D'après 10 ans d'historique, au plus 1 printemps sur 10 a une gelée, et au plus 1 automne sur 10.");
  });

  it('skips incomplete years and lists them', () => {
    const s = lastFrostStats([...year(2001, ['03-01']), ...year(2002, ['03-02']).slice(0, 200)]);
    expect(s.years).toBe(1);
    expect(s.skippedYears).toEqual([2002]);
  });

  it('returns no dates for an empty history', () => {
    const s = lastFrostStats([]);
    expect(s).toMatchObject({ years: 0, spring: { median: null, safe: null }, autumn: { median: null, early: null } });
    expect(s.reason).toBe("Pas assez d'historique pour dater les gelées.");
  });

  it('uses the threshold it is given and says it was calibrated', () => {
    const days = year(2001).map((d) => (d.date === '2001-04-02' ? { ...d, tmin: 0.8 } : d));
    expect(lastFrostStats(days).perYear[0]!.lastFrost).toBeNull();
    const s = lastFrostStats(days, { thresholdC: 1, calibrated: true, model: 'era5_land' });
    expect(s.perYear[0]!.lastFrost).toBe('2001-04-02');
    expect(s.inputs).toMatchObject({ thresholdC: 1, calibrated: true, model: 'era5_land' });
    expect(s.reason).toContain('Seuil de 1 °C calé sur Bordeaux-Mérignac.');
  });

  it('reads 30 recorded years at Le Pian-Médoc', () => {
    const s = lastFrostStats(recorded, { model: 'era5_land' });
    expect(s.years).toBe(30);
    expect(s.yearsWithoutSpringFrost).toBe(2);
    expect(s.yearsWithoutAutumnFrost).toBe(5);
    expect(s.spring).toEqual({ median: '02-22', safe: '03-12' });
    expect(s.autumn).toEqual({ median: '12-04', early: '11-19' });
    expect(s.perYear[0]).toEqual({ year: 1991, lastFrost: '1991-02-15', firstFrost: '1991-11-23' });
  });

  it('never moves a year frost date the wrong way when the threshold rises', () => {
    fc.assert(
      fc.property(fc.double({ min: -2, max: 3, noNaN: true }), fc.double({ min: 0, max: 2, noNaN: true }), (t, rise) => {
        const low = lastFrostStats(recorded.slice(0, 365 * 3 + 1), { thresholdC: t });
        const high = lastFrostStats(recorded.slice(0, 365 * 3 + 1), { thresholdC: t + rise });
        low.perYear.forEach((y, i) => {
          const h = high.perYear[i]!;
          if (y.lastFrost) expect(h.lastFrost! >= y.lastFrost).toBe(true);
          if (y.firstFrost) expect(h.firstFrost! <= y.firstFrost).toBe(true);
        });
      }),
      { numRuns: 30 },
    );
  });

  it('keeps the safe date on or after the median', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 120 }), { minLength: 1, maxLength: 12 }), (doys) => {
        const days = doys.flatMap((doy, i) => year(2001 + i, [addDays('2001-01-01', doy - 1).slice(5)]));
        const s = lastFrostStats(days);
        expect(s.spring.safe! >= s.spring.median!).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});

describe('calibrateFrostThreshold', () => {
  it('carries the Mérignac normals with their source', () => {
    expect(MERIGNAC_FROST_DAYS.perMonth[3]).toBe(1.8);
    expect(MERIGNAC_FROST_DAYS.perMonth[11]).toBe(1.9);
    expect(MERIGNAC_FROST_DAYS.source).toContain('Bordeaux-Mérignac');
  });

  it('keeps 0 °C when the grid already matches the normals', () => {
    // 2 frost days in March and in November every year: within 20 % of 1.8 and 1.9.
    const days = Array.from({ length: 5 }, (_, i) => year(2001 + i, ['03-01', '03-02', '11-01', '11-02'])).flat();
    const c = calibrateFrostThreshold(days);
    expect(c).toMatchObject({ thresholdC: 0, matched: true, estimate: true });
    expect(c.table.find((r) => r.month === 3)).toEqual({ month: 3, gridDays: 2, normalDays: 1.8, withinTolerance: true });
    expect(c.reason).toBe('Seuil de gel calé à 0 °C sur Bordeaux-Mérignac : mars 2 jours par an contre 1,8, novembre 2 contre 1,9.');
  });

  it('raises the threshold in 0.5 °C steps until the grid matches', () => {
    // Nights at 0.4 °C count only from a 0.5 °C threshold.
    const days = Array.from({ length: 5 }, (_, i) => year(2001 + i, [])).flat().map((d) =>
      ['03-01', '03-02', '11-01', '11-02'].includes(d.date.slice(5)) ? { ...d, tmin: 0.4 } : d,
    );
    const c = calibrateFrostThreshold(days);
    expect(c).toMatchObject({ thresholdC: 0.5, matched: true });
    expect(c.tried.map((t) => t.thresholdC)).toEqual([0, 0.5]);
  });

  it('calibrates the recorded grid cell to 1 °C, the closest it gets', () => {
    const c = calibrateFrostThreshold(recorded);
    expect(c.thresholdC).toBe(1);
    expect(c.matched).toBe(false);
    expect(c.table.filter((r) => r.month === 3 || r.month === 11)).toEqual([
      { month: 3, gridDays: 1.83, normalDays: 1.8, withinTolerance: true },
      { month: 11, gridDays: 1.4, normalDays: 1.9, withinTolerance: false },
    ]);
    expect(c.tried).toHaveLength(7);
    expect(c.inputs).toMatchObject({ months: [3, 11], years: 30 });
    expect(c.inputs.params.tolerance).toEqual({ value: 0.2, unit: 'part', estimate: true });
    expect(c.reason).toBe(
      "Seuil de gel retenu : 1 °C, le plus proche de Bordeaux-Mérignac, sans atteindre l'écart de 20 % visé : mars 1,8 jour par an contre 1,8, novembre 1,4 contre 1,9.",
    );
  });

  it('feeds lastFrostStats', () => {
    const c = calibrateFrostThreshold(recorded);
    const s = lastFrostStats(recorded, { thresholdC: c.thresholdC, calibrated: true });
    expect(s.spring).toEqual({ median: '02-26', safe: '03-23' });
    expect(s.autumn).toEqual({ median: '11-30', early: '11-16' });
  });

  it('refuses to calibrate without history', () => {
    const c = calibrateFrostThreshold([]);
    expect(c).toMatchObject({ thresholdC: 0, matched: false });
    expect(c.reason).toBe("Pas assez d'historique pour caler le seuil de gel : 0 °C par défaut.");
  });
});
