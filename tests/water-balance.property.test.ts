import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, waterBalance, type SoilType } from '../src/index.js';
import { fraise, planting, salade, tomate, weather } from './water-fixtures.js';

const dayShape = fc.record({
  rain: fc.double({ min: 0, max: 80, noNaN: true }),
  et0: fc.double({ min: 0, max: 9, noNaN: true }),
  tmin: fc.double({ min: -5, max: 22, noNaN: true }),
  tmax: fc.double({ min: 5, max: 38, noNaN: true }),
});
const crop = fc.constantFrom(tomate, salade, fraise);
const soil = fc.constantFrom<SoilType>('sable-pur', 'sable', 'sable-amende');
const sownOffset = fc.integer({ min: -120, max: 10 });
const irrigation = fc.array(fc.record({ day: fc.integer({ min: 0, max: 40 }), mm: fc.double({ min: 0, max: 60, noNaN: true }) }), { maxLength: 8 });
const startDr = fc.double({ min: 0, max: 200, noNaN: true });
/** Start day relative to the first weather day, often outside the weather range. */
const startOffset = fc.integer({ min: -15, max: 50 });

const FIRST = '2026-06-01';
const dateAt = (i: number) => weather(FIRST, Array.from({ length: i + 1 }, () => ({})))[i]!.date;

describe('water balance properties', () => {
  it('keeps Dr between 0 and TAW every day, and RAW at or under TAW', () => {
    fc.assert(
      fc.property(fc.array(dayShape, { minLength: 1, maxLength: 40 }), crop, soil, sownOffset, irrigation, startDr, startOffset, (shapes, c, s, offset, irr, dr0, at) => {
        const sownOn = offset < 0 ? dateAt(0).replace('06-01', '05-01') : dateAt(offset);
        const b = waterBalance({
          planting: planting(c.id, { sownOn }),
          crop: c,
          weather: weather(FIRST, shapes),
          soil: s,
          irrigations: irr.map((i) => ({ date: dateAt(i.day), mm: i.mm })),
          start: { date: addDays(FIRST, at), drMm: dr0 },
        });
        if (b.kind !== 'balance') return;
        expect(b.days.length).toBeGreaterThan(0);
        expect(b.days[0]!.date >= b.anchor.date).toBe(true);
        for (const d of b.days) {
          expect(d.drMm).toBeGreaterThanOrEqual(0);
          expect(d.drMm).toBeLessThanOrEqual(d.tawMm + 1e-9);
          expect(d.rawMm).toBeLessThanOrEqual(d.tawMm + 1e-9);
          expect(d.drainedMm).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('never ends drier with more rain', () => {
    fc.assert(
      fc.property(fc.array(dayShape, { minLength: 2, maxLength: 30 }), fc.integer({ min: 0, max: 29 }), fc.double({ min: 0, max: 30, noNaN: true }), (shapes, at, extra) => {
        const run = (list: typeof shapes) =>
          waterBalance({ planting: planting('tomate'), crop: tomate, weather: weather(FIRST, list), soil: 'sable', start: { date: FIRST, drMm: 20 } });
        const i = Math.min(at, shapes.length - 1);
        const wetter = shapes.map((s, j) => (j === i ? { ...s, rain: s.rain + extra } : s));
        const a = run(shapes);
        const b = run(wetter);
        if (a.kind !== 'balance' || b.kind !== 'balance') throw new Error('expected balances');
        const last = (x: typeof a) => x.days[x.days.length - 1]!.drMm;
        expect(last(b)).toBeLessThanOrEqual(last(a) + 1e-9);
      }),
    );
  });
});
