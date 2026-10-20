import { getISOWeek, parseISO } from 'date-fns';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, whatsNext, type Crop } from '../src/index.js';
import { baseCrop, basePlanting } from './fixtures.js';

const week = fc.integer({ min: 1, max: 52 });
const day = fc.integer({ min: 0, max: 16 * 365 }).map((n) => addDays('2020-01-01', n));
const inWindow = (w: number, from: number, to: number) => (from <= to ? w >= from && w <= to : w >= from || w <= to);
const cropWith = (from: number, to: number): Crop => ({ ...baseCrop, sowDirect: { value: { from, to }, estimate: true } });

describe('whatsNext properties', () => {
  it('proposes a window, wrapping or not, exactly during its weeks', () => {
    fc.assert(
      fc.property(week, week, day, (from, to, today) => {
        const open = whatsNext([cropWith(from, to)], [], today).length === 1;
        expect(open).toBe(inWindow(getISOWeek(parseISO(today)), from, to));
      }),
    );
  });

  it('a sowing made today keeps the window visible and is listed as done', () => {
    fc.assert(
      fc.property(week, week, day, (from, to, today) => {
        fc.pre(inWindow(getISOWeek(parseISO(today)), from, to));
        const r = whatsNext([cropWith(from, to)], [{ ...basePlanting, sownOn: today }], today);
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ action: 'sow_direct', doneOn: [today] });
      }),
    );
  });

  it('a sowing from more than a year ago never counts as done', () => {
    fc.assert(
      fc.property(week, week, day, fc.integer({ min: 372, max: 900 }), (from, to, today, back) => {
        fc.pre(inWindow(getISOWeek(parseISO(today)), from, to));
        const r = whatsNext([cropWith(from, to)], [{ ...basePlanting, sownOn: addDays(today, -back) }], today);
        expect(r).toEqual([expect.objectContaining({ doneOn: [] })]);
      }),
    );
  });

  it('doneOn is sorted, unique and drawn from the sowings', () => {
    fc.assert(
      fc.property(day, fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 6 }), (today, backs) => {
        const sown = backs.map((b) => addDays(today, -b));
        const plantings = sown.map((sownOn) => ({ ...basePlanting, sownOn }));
        for (const a of whatsNext([cropWith(1, 52)], plantings, today)) {
          expect([...new Set(a.doneOn)].sort()).toEqual(a.doneOn);
          for (const d of a.doneOn) expect(sown).toContain(d);
        }
      }),
    );
  });
});
