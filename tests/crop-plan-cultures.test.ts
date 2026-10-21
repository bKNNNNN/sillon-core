import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  generateLayout,
  INVALID_BED_OUTLINE,
  INVALID_GAP,
  neighbouringBeds,
  parseCrops,
  solveCropPlan,
  type CropPlanBed,
  type Point,
} from '../src/index.js';
import { value } from './crop-plan-fixtures.js';

const crops = parseCrops(readFileSync(new URL('./fixtures/cultures-v0.2.0.yaml', import.meta.url), 'utf8'));

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('neighbouringBeds', () => {
  const squares = [
    { id: 'c1', polygonCm: rect(0, 0, 120, 120) },
    { id: 'c2', polygonCm: rect(160, 0, 120, 120) },
    { id: 'c3', polygonCm: rect(0, 160, 120, 120) },
    { id: 'c4', polygonCm: rect(160, 160, 120, 120) },
  ];

  it('pairs beds across one aisle, not across the diagonal', () => {
    expect(value(neighbouringBeds(squares, 41))).toEqual([
      ['c1', 'c2'],
      ['c1', 'c3'],
      ['c2', 'c4'],
      ['c3', 'c4'],
    ]);
  });

  it('reaches the diagonal once the gap allows it (40 cm aisles, 56.6 cm corner to corner)', () => {
    expect(value(neighbouringBeds(squares, 57))).toHaveLength(6);
  });

  it('finds nothing with a gap narrower than the aisle', () => {
    expect(value(neighbouringBeds(squares, 39))).toEqual([]);
  });

  it('reads the beds of a generated layout', () => {
    const layout = value(generateLayout({ area: rect(0, 0, 600, 400), style: 'rows', aisles: { aisleCm: 40 } }));
    expect(value(neighbouringBeds(layout.beds, 41))).toEqual([['planche-1', 'planche-2']]);
  });

  it('refuses a bad gap or outline', () => {
    expect(neighbouringBeds(squares, -1)).toEqual({ ok: false, error: INVALID_GAP });
    expect(neighbouringBeds(squares, Number.NaN)).toEqual({ ok: false, error: INVALID_GAP });
    expect(neighbouringBeds([{ id: 'x', polygonCm: [{ x: 0, y: 0 }] }], 10)).toEqual({ ok: false, error: INVALID_BED_OUTLINE });
    expect(neighbouringBeds([{ id: 'x', polygonCm: rect(0, 0, Number.NaN, 1) }], 10)).toEqual({ ok: false, error: INVALID_BED_OUTLINE });
  });
});

describe('solveCropPlan on sillon-cultures', () => {
  // Four squares of 120 cm, 40 cm aisles, as in the owner's garden; 2026 history, plan for 2027.
  const beds: CropPlanBed[] = [
    { id: 'c1', label: 'Carré 1', history: [{ species: 'tomate', sownOn: '2026-03-20', status: 'done', harvestedOn: '2026-09-30' }] },
    { id: 'c2', label: 'Carré 2', history: [{ species: 'haricot', sownOn: '2026-05-10', status: 'done', harvestedOn: '2026-08-15' }] },
    { id: 'c3', label: 'Carré 3', history: [{ species: 'courgette', sownOn: '2026-04-25', status: 'done' }] },
    { id: 'c4', label: 'Carré 4', history: [{ species: 'poireau', sownOn: '2026-03-01', status: 'active' }] },
  ];
  const neighbours = value(
    neighbouringBeds(
      [
        { id: 'c1', polygonCm: rect(0, 0, 120, 120) },
        { id: 'c2', polygonCm: rect(160, 0, 120, 120) },
        { id: 'c3', polygonCm: rect(0, 160, 120, 120) },
        { id: 'c4', polygonCm: rect(160, 160, 120, 120) },
      ],
      41,
    ),
  );

  const result = value(
    solveCropPlan({
      beds,
      crops,
      neighbours,
      sownOn: '2027-04-01',
      wishes: [{ cropId: 'tomate' }, { cropId: 'haricot' }, { cropId: 'courge' }, { cropId: 'oignon' }],
    }),
  );
  const [best] = result.options;

  it('moves every family off last season bed', () => {
    expect(best!.score.rotation).toBe(0);
    const on = Object.fromEntries(best!.assignments.map((a) => [a.bedId, a.cropIds[0]]));
    expect(on.c1).not.toBe('tomate');
    expect(on.c2).not.toBe('haricot');
    expect(on.c3).not.toBe('courge');
    expect(on.c4).not.toBe('oignon');
  });

  it('keeps beans away from onions', () => {
    expect(best!.score.items.some((i) => i.kind === 'companions' && i.points < 0)).toBe(false);
  });

  it('gives a French reason for every point', () => {
    for (const o of result.options) {
      expect(o.score.items.reduce((s, i) => s + i.points, 0)).toBe(o.score.total);
      for (const i of o.score.items) expect(i.text).toMatch(/^[A-ZÀ-Ý].*\.$/);
    }
  });
});
