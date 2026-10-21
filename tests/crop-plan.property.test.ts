import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scoreCropPlan, solveCropPlan, type CropPlanAssignment, type CropPlanBed, type CropPlanInput } from '../src/index.js';
import { catalog, value } from './crop-plan-fixtures.js';

const ids = catalog.map((c) => c.id);
const species = fc.constantFrom(...ids);
const year = fc.integer({ min: 2021, max: 2026 });

const bedArb = (i: number): fc.Arbitrary<CropPlanBed> =>
  fc
    .array(fc.record({ species, sownOn: year.map((y) => `${y}-04-01`) }), { maxLength: 3 })
    .map((history) => ({ id: `b${i}`, label: `Planche ${i + 1}`, history }));

const inputArb: fc.Arbitrary<CropPlanInput> = fc
  .integer({ min: 1, max: 6 })
  .chain((n) =>
    fc.record({
      beds: fc.tuple(...Array.from({ length: n }, (_, i) => bedArb(i))),
      wishes: fc
        .uniqueArray(species, { minLength: 1, maxLength: 7 })
        .chain((list) => fc.tuple(...list.map((cropId) => fc.integer({ min: 1, max: 3 }).map((beds) => ({ cropId, beds }))))),
      neighbours:
        n < 2
          ? fc.constant([])
          : fc.array(
              fc
                .tuple(fc.integer({ min: 0, max: n - 2 }), fc.integer({ min: 1, max: n - 1 }))
                .map(([a, k]) => [`b${a}`, `b${(a + k) % n}`] as const)
                .filter(([a, b]) => a !== b),
              { maxLength: 8 },
            ),
      cropsPerBed: fc.integer({ min: 1, max: 3 }),
    }),
  )
  .map((r) => ({ ...r, crops: catalog, sownOn: '2026-04-01' }));

const swapped = (plan: CropPlanAssignment[], a: number, i: number, b: number, j: number): CropPlanAssignment[] =>
  plan.map((bed, k) => {
    if (k !== a && k !== b) return bed;
    const cropIds = [...bed.cropIds];
    if (k === a) cropIds[i] = plan[b]!.cropIds[j]!;
    if (k === b) cropIds[j] = plan[a]!.cropIds[i]!;
    return { ...bed, cropIds };
  });

describe('solveCropPlan properties', () => {
  it('places every wished bed or lists it, never overfills a bed, never repeats a crop on one bed', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const { options } = value(solveCropPlan(input));
        const cap = input.cropsPerBed ?? 1;
        for (const o of options) {
          expect(o.assignments.map((a) => a.bedId)).toEqual(input.beds.map((b) => b.id));
          for (const a of o.assignments) {
            expect(a.cropIds.length).toBeLessThanOrEqual(cap);
            expect(new Set(a.cropIds).size).toBe(a.cropIds.length);
          }
          for (const w of input.wishes) {
            const placed = o.assignments.filter((a) => a.cropIds.includes(w.cropId)).length;
            const missing = o.unplaced.find((u) => u.cropId === w.cropId)?.beds ?? 0;
            expect(placed + missing).toBe(w.beds ?? 1);
          }
          const wanted = input.wishes.reduce((s, w) => s + Math.min(w.beds ?? 1, input.beds.length), 0);
          if (wanted <= input.beds.length * cap && input.wishes.every((w) => (w.beds ?? 1) <= input.beds.length)) {
            expect(o.unplaced).toEqual([]);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('the breakdown adds up and rescoring gives the same numbers', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        for (const o of value(solveCropPlan(input)).options) {
          const s = o.score;
          expect(s.total).toBe(s.rotation + s.companions + s.families + s.unplaced);
          expect(s.items.reduce((sum, i) => sum + i.points, 0)).toBe(s.total);
          expect(value(scoreCropPlan(input, o.assignments))).toEqual(s);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('options come best first and no single swap of two crops improves the best one', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const { options } = value(solveCropPlan(input));
        for (let i = 1; i < options.length; i++) expect(options[i - 1]!.score.total).toBeGreaterThanOrEqual(options[i]!.score.total);
        const best = options[0]!;
        const plan = best.assignments;
        for (let a = 0; a < plan.length; a++)
          for (let b = a + 1; b < plan.length; b++)
            plan[a]!.cropIds.forEach((ca, i) =>
              plan[b]!.cropIds.forEach((cb, j) => {
                if (ca === cb || plan[a]!.cropIds.includes(cb) || plan[b]!.cropIds.includes(ca)) return;
                const other = value(scoreCropPlan(input, swapped(plan, a, i, b, j)));
                expect(other.total).toBeLessThanOrEqual(best.score.total);
              }),
            );
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic and ignores the order neighbour pairs are written in', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const flipped = { ...input, neighbours: [...(input.neighbours ?? [])].reverse().map(([a, b]) => [b, a] as const) };
        expect(solveCropPlan(input)).toEqual(solveCropPlan(input));
        expect(solveCropPlan(flipped)).toEqual(solveCropPlan(input));
      }),
      { numRuns: 150 },
    );
  });
});
