import { describe, expect, it } from 'vitest';
import {
  generateLayout,
  LAYOUT_PARAMS,
  INVALID_AISLE,
  INVALID_SIZE,
  INVALID_ANGLE,
  INVALID_STYLE,
  AREA_TOO_SMALL,
  AREA_TOO_LARGE,
  TOO_MANY_CORNERS,
  TOO_MANY_BEDS,
  SELF_CROSSING,
  TOO_FEW_CORNERS,
  INVALID_COORDINATE,
  type Layout,
  type LayoutBed,
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

/** Axis-aligned bounds of a bed, rounded to 0.001 cm so float noise from rotation does not matter. */
function bounds(bed: LayoutBed) {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const xs = bed.polygonCm.map((p) => p.x);
  const ys = bed.polygonCm.map((p) => p.y);
  return { x0: r(Math.min(...xs)), x1: r(Math.max(...xs)), y0: r(Math.min(...ys)), y1: r(Math.max(...ys)) };
}

function layout(input: Partial<LayoutInput>): Layout {
  return value(generateLayout({ area: rect(600, 400), style: 'rows', aisles: { aisleCm: 40 }, ...input }));
}

describe('generateLayout, rows', () => {
  it('traces planches along the longest side, centred across, with the border kept', () => {
    const l = layout({});
    expect(l.bedAxisDeg).toBe(0);
    expect(l.beds.map((b) => b.id)).toEqual(['planche-1', 'planche-2']);
    expect(l.beds.map((b) => b.label)).toEqual(['Planche 1', 'Planche 2']);
    expect(l.beds.map(bounds)).toEqual([
      { x0: 40, x1: 560, y0: 220, y1: 340 },
      { x0: 40, x1: 560, y0: 60, y1: 180 },
    ]);
    for (const b of l.beds) {
      expect(b.shape).toBe('rect');
      expect(b.widthCm).toBeCloseTo(120);
      expect(b.lengthCm).toBeCloseTo(520);
      expect(b.areaCm2).toBeCloseTo(62_400);
    }
  });

  it('follows an explicit bed axis, numbering beds from left to right', () => {
    const l = layout({ orientation: { bedAxisDeg: 90 } });
    expect(l.bedAxisDeg).toBe(90);
    expect(l.beds.map(bounds)).toEqual([
      { x0: 80, x1: 200, y0: 40, y1: 360 },
      { x0: 240, x1: 360, y0: 40, y1: 360 },
      { x0: 400, x1: 520, y0: 40, y1: 360 },
    ]);
  });

  it('gives every outline counter-clockwise, even for a clockwise area', () => {
    const l = layout({ area: [...rect(600, 400)].reverse() });
    for (const b of l.beds) {
      let twice = 0;
      b.polygonCm.forEach((p, i) => {
        const q = b.polygonCm[(i + 1) % b.polygonCm.length]!;
        twice += p.x * q.y - q.x * p.y;
      });
      expect(twice).toBeGreaterThan(0);
    }
  });

  it('keeps beds out of the notch of an L-shaped plot', () => {
    const area = [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 600 },
      { x: 0, y: 600 },
    ];
    const l = layout({ area });
    expect(l.bedAxisDeg).toBe(0);
    expect(l.beds.map(bounds)).toEqual([
      { x0: 40, x1: 160, y0: 400, y1: 520 },
      { x0: 40, x1: 160, y0: 240, y1: 360 },
      { x0: 40, x1: 160, y0: 80, y1: 200 },
    ]);
  });

  it('cuts long beds with a cross aisle', () => {
    const l = layout({ sizes: { bedMaxLengthCm: 240 }, aisles: { aisleCm: 40, crossAisleCm: 40 } });
    expect(l.beds.map(bounds)).toEqual([
      { x0: 40, x1: 280, y0: 220, y1: 340 },
      { x0: 320, x1: 560, y0: 220, y1: 340 },
      { x0: 40, x1: 280, y0: 60, y1: 180 },
      { x0: 320, x1: 560, y0: 60, y1: 180 },
    ]);
  });

  it('splits a long bed into equal parts', () => {
    const l = layout({ area: rect(700, 400), sizes: { bedMaxLengthCm: 400 } });
    const lengths = l.beds.map((b) => Math.round(b.lengthCm * 1000) / 1000);
    expect(lengths).toEqual([290, 290, 290, 290]);
  });

  it('drops leftovers shorter than the minimum bed length', () => {
    const area = [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 250 },
      { x: 170, y: 250 },
      { x: 170, y: 400 },
      { x: 0, y: 400 },
    ];
    const l = layout({ area, orientation: { bedAxisDeg: 0 }, sizes: { bedMinLengthCm: 100 } });
    expect(l.beds.map(bounds)).toEqual([{ x0: 40, x1: 560, y0: 60, y1: 180 }]);
  });

  it('uses the border and bed width given', () => {
    const l = layout({ aisles: { aisleCm: 30, borderCm: 0 }, sizes: { bedWidthCm: 80 } });
    expect(l.beds.map(bounds)[2]).toEqual({ x0: 0, x1: 600, y0: 50, y1: 130 });
    expect(l.beds).toHaveLength(3);
  });

  it('works on a rotated plot and returns beds in the plan frame', () => {
    const a = (30 * Math.PI) / 180;
    const rot = (p: Point): Point => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
    const l = layout({ area: rect(600, 400).map(rot) });
    expect(l.bedAxisDeg).toBeCloseTo(30);
    expect(l.beds).toHaveLength(2);
    expect(l.beds[0]!.lengthCm).toBeCloseTo(520);
    const c = l.beds[0]!.centerCm;
    const expected = rot({ x: 300, y: 280 });
    expect(c.x).toBeCloseTo(expected.x);
    expect(c.y).toBeCloseTo(expected.y);
  });

  it('numbers beds left to right whatever the axis direction given', () => {
    const a = layout({ orientation: { bedAxisDeg: 0 } });
    const b = layout({ orientation: { bedAxisDeg: 180 } });
    const c = layout({ orientation: { bedAxisDeg: -90 } });
    expect(b.bedAxisDeg).toBe(0);
    expect(c.bedAxisDeg).toBe(90);
    expect(b.beds.map(bounds)).toEqual(a.beds.map(bounds));
    expect(bounds(c.beds[0]!).x0).toBeCloseTo(80);
  });

  it('is deterministic', () => {
    expect(layout({})).toEqual(layout({}));
  });

  it('records the parameters it used, with estimates flagged', () => {
    const l = layout({});
    expect(l.params.bedWidthCm).toEqual(LAYOUT_PARAMS.bedWidthCm);
    expect(l.params.aisleCm).toEqual({ value: 40, unit: 'cm', estimate: false, source: 'saisie' });
    expect(l.params.borderCm!.value).toBe(40);
  });
});

describe('generateLayout, squares', () => {
  it('lays carrés on a grid centred in the plot', () => {
    const l = layout({ style: 'squares' });
    expect(l.beds.map((b) => b.label)).toEqual(['Carré 1', 'Carré 2', 'Carré 3', 'Carré 4', 'Carré 5', 'Carré 6']);
    expect(l.beds.map(bounds)).toEqual([
      { x0: 80, x1: 200, y0: 220, y1: 340 },
      { x0: 240, x1: 360, y0: 220, y1: 340 },
      { x0: 400, x1: 520, y0: 220, y1: 340 },
      { x0: 80, x1: 200, y0: 60, y1: 180 },
      { x0: 240, x1: 360, y0: 60, y1: 180 },
      { x0: 400, x1: 520, y0: 60, y1: 180 },
    ]);
    expect(l.beds[0]!.id).toBe('carre-1');
  });
});

describe('generateLayout, mounds', () => {
  it('packs buttes in staggered rows without touching', () => {
    const l = layout({ style: 'mounds', sizes: { moundCm: 100 } });
    expect(l.beds).toHaveLength(7);
    expect(l.beds[0]!.label).toBe('Butte 1');
    expect(l.beds[0]!.id).toBe('butte-1');
    for (const b of l.beds) {
      expect(b.shape).toBe('mound');
      expect(b.widthCm).toBe(100);
      expect(b.polygonCm.length).toBeGreaterThanOrEqual(24);
      const bb = bounds(b);
      expect(bb.x0).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(bb.x1).toBeLessThanOrEqual(560 + 1e-9);
    }
    for (let i = 0; i < l.beds.length; i++) {
      for (let j = i + 1; j < l.beds.length; j++) {
        const a = l.beds[i]!.centerCm;
        const b = l.beds[j]!.centerCm;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(140 - 1e-6);
      }
    }
  });
});

describe('generateLayout, refusals', () => {
  const base: LayoutInput = { area: rect(600, 400), style: 'rows', aisles: { aisleCm: 40 } };
  const err = (input: LayoutInput) => {
    const r = generateLayout(input);
    return r.ok ? 'ok' : r.error;
  };

  it('refuses bad aisles', () => {
    expect(err({ ...base, aisles: { aisleCm: 0 } })).toBe(INVALID_AISLE);
    expect(err({ ...base, aisles: { aisleCm: Number.NaN } })).toBe(INVALID_AISLE);
    expect(err({ ...base, aisles: { aisleCm: 40, borderCm: -1 } })).toBe(INVALID_AISLE);
    expect(err({ ...base, aisles: { aisleCm: 40, crossAisleCm: 0 } })).toBe(INVALID_AISLE);
    expect(err({ ...base, aisles: { aisleCm: 5000 } })).toBe(INVALID_AISLE);
  });

  it('refuses bad sizes', () => {
    expect(err({ ...base, sizes: { bedWidthCm: 0 } })).toBe(INVALID_SIZE);
    expect(err({ ...base, sizes: { squareCm: Infinity } })).toBe(INVALID_SIZE);
    expect(err({ ...base, sizes: { moundCm: -3 } })).toBe(INVALID_SIZE);
    expect(err({ ...base, sizes: { bedMinLengthCm: 300, bedMaxLengthCm: 200 } })).toBe(INVALID_SIZE);
  });

  it('refuses bad angles and styles', () => {
    expect(err({ ...base, orientation: { bedAxisDeg: Number.NaN } })).toBe(INVALID_ANGLE);
    expect(err({ ...base, orientation: { northDeg: Infinity } })).toBe(INVALID_ANGLE);
    expect(err({ ...base, style: 'spiral' as never })).toBe(INVALID_STYLE);
  });

  it('refuses bad outlines', () => {
    expect(err({ ...base, area: rect(600, 400).slice(0, 2) })).toBe(TOO_FEW_CORNERS);
    expect(err({ ...base, area: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] })).toBe(SELF_CROSSING);
    expect(err({ ...base, area: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, { x: 0, y: 1 }] })).toBe(INVALID_COORDINATE);
    expect(err({ ...base, area: 'x' as never })).toBe(TOO_FEW_CORNERS);
    const many = Array.from({ length: 300 }, (_, i) => ({ x: Math.cos(i / 47.7) * 500, y: Math.sin(i / 47.7) * 500 }));
    expect(err({ ...base, area: many })).toBe(TOO_MANY_CORNERS);
    expect(err({ ...base, area: rect(2_000_000, 400) })).toBe(AREA_TOO_LARGE);
  });

  it('refuses a plot with no room for a bed', () => {
    expect(err({ ...base, area: rect(150, 150) })).toBe(AREA_TOO_SMALL);
  });

  it('refuses a layout with too many beds', () => {
    expect(err({ ...base, style: 'squares', area: rect(20_000, 20_000), sizes: { squareCm: 20 }, aisles: { aisleCm: 10 } })).toBe(
      TOO_MANY_BEDS,
    );
  });
});
