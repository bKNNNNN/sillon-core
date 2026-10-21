import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_EXACT_BEDS,
  MAX_EXACT_SLOTS,
  MAX_EXACT_WORK,
  scoreCropPlan,
  solveCropPlan,
  type CropPlanAssignment,
  type CropPlanBed,
  type CropPlanInput,
} from '../src/index.js';
import { solveCropPlanWithWork } from '../src/layout/crop-plan.js';
import { beds, byBed, catalog, line, plan, value } from './crop-plan-fixtures.js';

const ids = catalog.map((c) => c.id);

/**
 * Every plan the rules allow, by brute force: at most `cropsPerBed` crops on a bed, a crop once per
 * bed and on no more beds than wished, and no bed left empty while another one holds two crops.
 */
function allPlans(input: CropPlanInput): CropPlanAssignment[][] {
  const cap = input.cropsPerBed ?? 1;
  const wishes = input.wishes.map((w) => ({ id: w.cropId, left: w.beds ?? 1 }));
  const subsets: number[][] = [[]];
  for (let c = 0; c < wishes.length; c++) for (const s of [...subsets]) if (s.length < cap) subsets.push([...s, c]);
  const plans: CropPlanAssignment[][] = [];
  const walk = (b: number, acc: number[][]) => {
    if (b === input.beds.length) {
      const loads = acc.map((s) => s.length);
      if (loads.includes(0) && loads.some((l) => l > 1)) return;
      plans.push(input.beds.map((bed, k) => ({ bedId: bed.id, label: bed.label ?? bed.id, cropIds: acc[k]!.map((c) => wishes[c]!.id) })));
      return;
    }
    for (const s of subsets) {
      if (s.some((c) => wishes[c]!.left === 0)) continue;
      s.forEach((c) => wishes[c]!.left--);
      walk(b + 1, [...acc, s]);
      s.forEach((c) => wishes[c]!.left++);
    }
  };
  walk(0, []);
  return plans;
}

const placed = (p: readonly Pick<CropPlanAssignment, 'cropIds'>[]) => p.reduce((n, a) => n + a.cropIds.length, 0);

const species = fc.constantFrom(...ids);
const smallInput: fc.Arbitrary<CropPlanInput> = fc
  .record({ n: fc.integer({ min: 1, max: 4 }), cropsPerBed: fc.integer({ min: 1, max: 2 }) })
  .chain(({ n, cropsPerBed }) =>
    fc.record({
      beds: fc.tuple(
        ...Array.from({ length: n }, (_, i) =>
          fc
            .array(fc.record({ species, sownOn: fc.integer({ min: 2023, max: 2026 }).map((y) => `${y}-04-01`) }), { maxLength: 2 })
            .map((history): CropPlanBed => ({ id: `b${i}`, label: `Planche ${i + 1}`, history })),
        ),
      ),
      wishes: fc
        .uniqueArray(species, { minLength: 1, maxLength: n * cropsPerBed > 4 ? 4 : 5 })
        .chain((list) => fc.tuple(...list.map((cropId) => fc.integer({ min: 1, max: 2 }).map((k) => ({ cropId, beds: k }))))),
      neighbours: n < 2 ? fc.constant([]) : fc.subarray(Array.from({ length: n - 1 }, (_, i) => [`b${i}`, `b${i + 1}`] as const).concat(n > 2 ? [[`b0`, `b${n - 1}`] as const] : [])),
      cropsPerBed: fc.constant(cropsPerBed),
    }),
  )
  .map((r) => ({ ...r, crops: catalog, sownOn: '2026-04-01' }));

describe('solveCropPlan: exact search on small gardens', () => {
  it(`exports the exact-search limits (${MAX_EXACT_BEDS} beds, ${MAX_EXACT_SLOTS} slots)`, () => {
    expect(MAX_EXACT_BEDS).toBe(6);
    expect(MAX_EXACT_SLOTS).toBe(12);
    expect(MAX_EXACT_WORK).toBeGreaterThan(0);
  });

  it('no plan the rules allow beats the best option at the same placed count (brute force)', () => {
    fc.assert(
      fc.property(smallInput, (input) => {
        const solved = value(solveCropPlan(input));
        expect(solved.approx).toBe(false);
        const best = solved.options[0]!;
        const all = allPlans(input);
        const most = Math.max(...all.map(placed));
        expect(placed(best.assignments)).toBe(most);
        const better = all.filter((p) => placed(p) === most && value(scoreCropPlan(input, p)).total > best.score.total);
        expect(better).toEqual([]);
      }),
      { numRuns: 120 },
    );
  });

  it('finds the optimum the local moves miss and labels it exact', () => {
    // Four squares in a ring, two crops each: the exact search must reach the brute-force best.
    const four: CropPlanInput = {
      beds: [
        { id: 'c1', label: 'Carré 1', history: [{ species: 'tomate', sownOn: '2025-04-01' }] },
        { id: 'c2', label: 'Carré 2', history: [{ species: 'carotte', sownOn: '2025-04-01' }] },
        { id: 'c3', label: 'Carré 3', history: [{ species: 'haricot', sownOn: '2025-04-01' }] },
        { id: 'c4', label: 'Carré 4', history: [{ species: 'poireau', sownOn: '2025-04-01' }] },
      ],
      wishes: ['tomate', 'basilic', 'carotte', 'poireau', 'courge', 'haricot', 'ail', 'pomme-de-terre'].map((cropId) => ({ cropId })),
      neighbours: [['c1', 'c2'], ['c2', 'c3'], ['c3', 'c4'], ['c4', 'c1']],
      cropsPerBed: 2,
      crops: catalog,
      sownOn: '2026-04-01',
    };
    const solved = value(solveCropPlan(four));
    expect(solved.approx).toBe(false);
    const top = Math.max(...allPlans(four).filter((p) => placed(p) === 8).map((p) => value(scoreCropPlan(four, p)).total));
    expect(solved.options[0]!.score.total).toBe(top);
    for (const o of solved.options) expect(['priority', 'constrained', 'companions', 'exact']).toContain(o.strategy);
  });

  it('flags a plan too large for the exact search as approximate', () => {
    const solved = plan({ beds: beds(7), wishes: ids.slice(0, 7).map((cropId) => ({ cropId })) });
    expect(solved.approx).toBe(true);
  });

  it('flags 3 beds of 4 crops as exact and 4 beds of 4 crops as approximate', () => {
    const wishes = ids.map((cropId) => ({ cropId }));
    expect(plan({ beds: beds(3), wishes: wishes.slice(0, 12), cropsPerBed: 4 }).approx).toBe(false);
    expect(plan({ beds: beds(4), wishes, cropsPerBed: 4 }).approx).toBe(true);
  });

  it('stops the exact search at its work budget, keeps the best plan found and says approx', () => {
    // 6 beds of 2 crops with many candidates: too many combinations to prove within the budget.
    const many = beds(6);
    const crops = [...catalog, ...Array.from({ length: 60 }, (_, i) => ({ ...catalog[i % catalog.length]!, id: `x${i}`, aliases: [], name: `X${i}` }))];
    const input: CropPlanInput = { beds: many, crops, sownOn: '2026-04-01', neighbours: line(many), cropsPerBed: 2, wishes: crops.map((c) => ({ cropId: c.id })) };
    const started = performance.now();
    const { plan: solved, exactWork } = value(solveCropPlanWithWork(input));
    // About 1 s plain; the bound leaves room for coverage instrumentation.
    expect(performance.now() - started).toBeLessThan(15000);
    expect(exactWork).toBeLessThanOrEqual(MAX_EXACT_WORK * 1.01);
    expect(solved.approx).toBe(true);
    expect(placed(solved.options[0]!.assignments)).toBe(12);
    expect(solveCropPlan(input)).toEqual(solveCropPlan(input));
  }, 60000);
});

describe('solveCropPlan: relocate move', () => {
  it('no single crop moved to a bed with room improves the best option (large plans too)', () => {
    const moved = (p: CropPlanAssignment[], a: number, i: number, b: number) =>
      p.map((bed, k) => {
        if (k === a) return { ...bed, cropIds: bed.cropIds.filter((_, j) => j !== i) };
        if (k === b) return { ...bed, cropIds: [...bed.cropIds, p[a]!.cropIds[i]!] };
        return bed;
      });
    fc.assert(
      fc.property(
        fc.integer({ min: 7, max: 9 }),
        fc.integer({ min: 2, max: 3 }),
        fc.integer({ min: 0, max: 1000 }),
        (n, cropsPerBed, seed) => {
          const many = beds(n);
          const count = Math.min(ids.length, n * cropsPerBed - 1 - (seed % 3));
          const wishes = Array.from({ length: count }, (_, k) => ({ cropId: ids[(k + seed) % ids.length]! }));
          const input: CropPlanInput = { beds: many, wishes, crops: catalog, sownOn: '2026-04-01', neighbours: line(many), cropsPerBed };
          const best = value(solveCropPlan(input)).options[0]!;
          const p = best.assignments;
          for (let a = 0; a < p.length; a++)
            for (let b = 0; b < p.length; b++) {
              if (a === b || p[b]!.cropIds.length >= cropsPerBed) continue;
              p[a]!.cropIds.forEach((c, i) => {
                if (p[b]!.cropIds.includes(c)) return;
                const next = moved(p, a, i, b);
                const loads = next.map((x) => x.cropIds.length);
                if (loads.includes(0) && loads.some((l) => l > 1)) return;
                expect(value(scoreCropPlan(input, next)).total).toBeLessThanOrEqual(best.score.total);
              });
            }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('solveCropPlan: run time at the input caps', () => {
  it('stays bounded with 500 beds, 500 history entries each, 100 wishes and 5000 neighbour pairs', () => {
    const n = 500;
    const many: CropPlanBed[] = beds(n).map((b, i) => ({
      ...b,
      history: Array.from({ length: 500 }, (_, k) => ({ species: ids[(i + k) % ids.length]!, sownOn: `${2020 + (k % 7)}-04-01` })),
    }));
    const neighbours: [string, string][] = [];
    for (let a = 1; a <= n && neighbours.length < 5000; a++) for (let d = 1; d <= 10 && a + d <= n && neighbours.length < 5000; d++) neighbours.push([`planche-${a}`, `planche-${a + d}`]);
    const wishes = Array.from({ length: 100 }, (_, k) => ({ cropId: k < ids.length ? ids[k]! : `libre-${k}`, name: `Libre ${k}`, beds: 5 }));
    const started = performance.now();
    const solved = value(solveCropPlan({ beds: many, wishes, crops: catalog, sownOn: '2027-04-01', neighbours, cropsPerBed: 4 }));
    // Plain runs take about 1.5 s; the bound leaves room for coverage instrumentation.
    expect(performance.now() - started).toBeLessThan(15000);
    expect(solved.approx).toBe(true);
  }, 30000);
});

describe('solveCropPlan: approx on every plan', () => {
  it('says exact for the two-bed example', () => {
    const solved = plan({ beds: beds(2), wishes: [{ cropId: 'tomate' }, { cropId: 'carotte' }] });
    expect(solved.approx).toBe(false);
    expect(byBed(solved.options[0]!)).toBeDefined();
  });
});
