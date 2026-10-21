import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { polygonArea, polygonPerimeter, signedPolygonArea, type Point } from '../src/index.js';

const value = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const pts = (...xy: number[]): Point[] =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i]!, y: xy[2 * i + 1]! }));

describe('polygon area', () => {
  it('measures a 120 x 80 cm bed', () => {
    expect(value(polygonArea(pts(0, 0, 120, 0, 120, 80, 0, 80)))).toBe(9600);
  });

  it('is positive whatever the winding, while the signed area keeps it', () => {
    const ccw = pts(0, 0, 4, 0, 4, 3, 0, 3);
    const cw = [...ccw].reverse();
    expect(value(polygonArea(cw))).toBe(12);
    expect(value(signedPolygonArea(ccw))).toBe(12);
    expect(value(signedPolygonArea(cw))).toBe(-12);
  });

  it('handles a non-convex L-shaped plot', () => {
    // 3 x 3 square minus its 2 x 2 top-right corner.
    expect(value(polygonArea(pts(0, 0, 3, 0, 3, 1, 1, 1, 1, 3, 0, 3)))).toBe(5);
  });

  it('accepts a closed ring that repeats its first point', () => {
    expect(value(polygonArea(pts(0, 0, 2, 0, 2, 2, 0, 2, 0, 0)))).toBe(4);
    expect(value(polygonPerimeter(pts(0, 0, 2, 0, 2, 2, 0, 2, 0, 0)))).toBe(8);
  });

  it('refuses fewer than three corners', () => {
    expect(polygonArea(pts(0, 0, 1, 1))).toEqual({ ok: false, error: 'Il faut au moins trois coins.' });
    expect(polygonArea([])).toEqual({ ok: false, error: 'Il faut au moins trois coins.' });
  });

  it('refuses a corner that is not a finite number', () => {
    const bad = pts(0, 0, 1, 0, Number.NaN, 1);
    expect(polygonArea(bad)).toEqual({ ok: false, error: 'Coordonnée invalide.' });
    expect(polygonPerimeter(pts(0, 0, Infinity, 0, 1, 1))).toEqual({ ok: false, error: 'Coordonnée invalide.' });
  });

  it('refuses a flat outline', () => {
    expect(polygonArea(pts(0, 0, 1, 1, 2, 2))).toEqual({ ok: false, error: 'Le contour est plat.' });
  });

  it('refuses an outline that crosses itself', () => {
    const bowTie = pts(0, 0, 2, 2, 2, 0, 0, 2);
    expect(polygonArea(bowTie)).toEqual({ ok: false, error: 'Le contour se croise.' });
    expect(polygonPerimeter(bowTie)).toEqual({ ok: false, error: 'Le contour se croise.' });
  });

  it('does not mutate its input', () => {
    const square = Object.freeze(pts(0, 0, 1, 0, 1, 1, 0, 1).map((p) => Object.freeze(p)));
    expect(value(polygonArea(square))).toBe(1);
  });
});

describe('polygon perimeter', () => {
  it('closes the outline', () => {
    expect(value(polygonPerimeter(pts(0, 0, 3, 0, 0, 4)))).toBe(12);
    expect(value(polygonPerimeter(pts(0, 0, 120, 0, 120, 80, 0, 80)))).toBe(400);
  });

  it('refuses fewer than three corners', () => {
    expect(polygonPerimeter(pts(0, 0, 3, 4))).toEqual({ ok: false, error: 'Il faut au moins trois coins.' });
  });
});

describe('polygon properties', () => {
  const coord = fc.double({ min: -1e4, max: 1e4, noNaN: true });
  const side = fc.double({ min: 1, max: 5000, noNaN: true });

  it('a rectangle has area w x h and perimeter 2(w + h), anywhere', () => {
    fc.assert(
      fc.property(coord, coord, side, side, (x, y, w, h) => {
        const rect = pts(x, y, x + w, y, x + w, y + h, x, y + h);
        expect(value(polygonArea(rect))).toBeCloseTo(w * h, 6 - Math.ceil(Math.log10(w * h + 1)));
        expect(Math.abs(value(polygonPerimeter(rect)) - 2 * (w + h))).toBeLessThan(1e-6 * (w + h + 1e4));
      }),
    );
  });

  it('scaling by k multiplies the area by k squared and the perimeter by k', () => {
    fc.assert(
      fc.property(side, side, fc.double({ min: 0.1, max: 10, noNaN: true }), (w, h, k) => {
        const tri = pts(0, 0, w, 0, w / 3, h);
        const big = tri.map((p) => ({ x: p.x * k, y: p.y * k }));
        const a = value(polygonArea(tri));
        const p = value(polygonPerimeter(tri));
        expect(Math.abs(value(polygonArea(big)) - a * k * k) / (a * k * k)).toBeLessThan(1e-9);
        expect(Math.abs(value(polygonPerimeter(big)) - p * k) / (p * k)).toBeLessThan(1e-9);
      }),
    );
  });
});
