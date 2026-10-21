import { describe, expect, it } from 'vitest';
import {
  bedCapacity,
  exposureNote,
  generateLayout,
  EXPOSURE_SOURCE,
  type LayoutBed,
  type LayoutCrop,
  type LayoutInput,
  type Point,
} from '../src/index.js';

const value = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

const rect = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

const tomate: LayoutCrop = { id: 'tomate', name: 'Tomate', spacingCm: { value: { inRow: 50, betweenRows: 70 }, estimate: true } };
const radis: LayoutCrop = {
  id: 'radis',
  name: 'Radis',
  spacingCm: { value: { inRow: 3, betweenRows: 15 }, source: 'Sachet' },
};
const courge: LayoutCrop = { id: 'courge', name: 'Courge', spacingCm: { value: { inRow: 100, betweenRows: 150 }, estimate: true } };
const mystere: LayoutCrop = { id: 'mystere', name: 'Mystère' };

const run = (input: Partial<LayoutInput>) =>
  value(generateLayout({ area: rect(600, 400), style: 'rows', aisles: { aisleCm: 40 }, ...input }));

describe('layout stats', () => {
  it('splits the area into cultivated and aisle surface', () => {
    const s = run({}).stats;
    expect(s.totalAreaCm2).toBe(240_000);
    expect(s.cultivatedAreaCm2).toBeCloseTo(124_800);
    expect(s.aisleAreaCm2).toBeCloseTo(115_200);
    expect(s.cultivatedShare).toBeCloseTo(0.52);
    expect(s.bedCount).toBe(2);
  });

  it('counts plants per bed from the cultures spacing', () => {
    const s = run({ crops: [tomate, radis, mystere] }).stats;
    const [t, r, m] = s.crops;
    expect(t).toMatchObject({ cropId: 'tomate', name: 'Tomate', totalPlants: 20 });
    expect(t!.perBed).toEqual([
      { bedId: 'planche-1', rows: 1, plants: 10 },
      { bedId: 'planche-2', rows: 1, plants: 10 },
    ]);
    expect(t!.spacing).toEqual(tomate.spacingCm);
    expect(r!.perBed![0]).toEqual({ bedId: 'planche-1', rows: 8, plants: 8 * 173 });
    expect(m).toEqual({ cropId: 'mystere', name: 'Mystère', perBed: null, totalPlants: null, spacing: null });
  });
});

describe('bedCapacity', () => {
  const bed = (shape: 'rect' | 'mound', widthCm: number, lengthCm: number): LayoutBed => ({
    id: 'x',
    label: 'x',
    shape,
    polygonCm: [],
    centerCm: { x: 0, y: 0 },
    widthCm,
    lengthCm,
    areaCm2: 0,
  });

  it('keeps one row when the bed is narrower than the row spacing', () => {
    expect(bedCapacity(bed('rect', 120, 300), courge.spacingCm!.value)).toEqual({ rows: 1, plants: 3 });
  });

  it('gives nothing when the bed is shorter than one plant', () => {
    expect(bedCapacity(bed('rect', 120, 40), tomate.spacingCm!.value)).toEqual({ rows: 1, plants: 0 });
  });

  it('counts a mound row by row along its chords', () => {
    // 100 cm mound, radish rows 15 cm apart: 6 rows at -37.5, -22.5, -7.5, 7.5, 22.5, 37.5 cm.
    const chords = [-37.5, -22.5, -7.5, 7.5, 22.5, 37.5].map((o) => Math.floor((2 * Math.sqrt(50 * 50 - o * o)) / 3));
    expect(bedCapacity(bed('mound', 100, 100), radis.spacingCm!.value)).toEqual({
      rows: 6,
      plants: chords.reduce((a, b) => a + b, 0),
    });
    expect(bedCapacity(bed('mound', 100, 100), courge.spacingCm!.value)).toEqual({ rows: 1, plants: 1 });
  });
});

describe('exposureNote', () => {
  it('says north is unknown when no north was given', () => {
    expect(exposureNote({ style: 'rows', bedAxisDeg: 0 })).toEqual({
      axis: 'unknown',
      text: 'Nord non indiqué : ajoute-le pour savoir où mettre les cultures hautes.',
      estimate: false,
    });
  });

  it('advises tall crops at the north end of north-south beds', () => {
    const n = exposureNote({ style: 'rows', bedAxisDeg: 90, northDeg: 90 });
    expect(n.axis).toBe('north-south');
    expect(n.text).toBe('Planches nord-sud : mets les cultures hautes au bout nord, elles ne font pas d’ombre au reste.');
    expect(n.source).toBe(EXPOSURE_SOURCE);
    expect(n.estimate).toBe(false);
    expect(exposureNote({ style: 'rows', bedAxisDeg: 280, northDeg: 90 }).axis).toBe('north-south');
  });

  it('warns that tall crops shade the north side of east-west beds', () => {
    const n = exposureNote({ style: 'rows', bedAxisDeg: 0, northDeg: 90 });
    expect(n.axis).toBe('east-west');
    expect(n.text).toBe('Planches est-ouest : les cultures hautes font de l’ombre au nord, mets-les sur la planche la plus au nord.');
    expect(n.estimate).toBe(false);
  });

  it('flags the diagonal case as an estimate', () => {
    const n = exposureNote({ style: 'rows', bedAxisDeg: 45, northDeg: 90 });
    expect(n.axis).toBe('diagonal');
    expect(n.estimate).toBe(true);
    expect(n.text).toBe('Planches en biais : garde les cultures hautes côté nord pour limiter l’ombre.');
  });

  it('gives the square and mound advice, flagged as an estimate', () => {
    const c = exposureNote({ style: 'squares', bedAxisDeg: 0, northDeg: 90 });
    expect(c.text).toBe('Carrés : mets les cultures hautes côté nord de chaque carré.');
    expect(c.estimate).toBe(true);
    const b = exposureNote({ style: 'mounds', bedAxisDeg: 0, northDeg: 90 });
    expect(b.text).toBe('Buttes : mets les cultures hautes côté nord de chaque butte.');
    expect(b.estimate).toBe(true);
  });

  it('carries no em dash in any text', () => {
    const texts = (['rows', 'squares', 'mounds'] as const).flatMap((style) =>
      [undefined, 0, 45, 90].map((northDeg) => exposureNote({ style, bedAxisDeg: 0, northDeg }).text),
    );
    for (const t of texts) expect(t).not.toMatch(/—/);
  });
});

describe('layout stats with the cultures data', () => {
  it('takes crops straight from parseCrops and keeps each spacing source', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseCrops } = await import('../src/index.js');
    const crops = parseCrops(readFileSync(new URL('./fixtures/cultures-v0.2.0.yaml', import.meta.url), 'utf8'));
    const s = run({ crops }).stats;
    expect(s.crops).toHaveLength(crops.length);
    for (const [i, c] of s.crops.entries()) {
      const crop = crops[i]!;
      expect(c.cropId).toBe(crop.id);
      if (crop.spacingCm === undefined) {
        expect(c.perBed).toBeNull();
        continue;
      }
      expect(c.spacing).toEqual(crop.spacingCm);
      expect(Boolean(c.spacing!.source) || c.spacing!.estimate === true).toBe(true);
      expect(c.totalPlants).toBeGreaterThan(0);
    }
  });
});
