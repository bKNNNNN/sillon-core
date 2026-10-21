import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AREA_TOO_SMALL, TOO_MANY_BEDS, generateLayout, MAX_BEDS, type LayoutInput, type LayoutStyle, type Point } from '../src/index.js';

const EPS = 1e-6;

/** A random star-shaped outline: corners at increasing angles around a centre, so it never crosses itself. */
const starArb = fc
  .record({
    n: fc.integer({ min: 3, max: 12 }),
    radii: fc.array(fc.double({ min: 150, max: 2500, noNaN: true }), { minLength: 12, maxLength: 12 }),
    jitter: fc.array(fc.double({ min: 0.1, max: 0.9, noNaN: true }), { minLength: 12, maxLength: 12 }),
    cx: fc.double({ min: -5000, max: 5000, noNaN: true }),
    cy: fc.double({ min: -5000, max: 5000, noNaN: true }),
  })
  .map(({ n, radii, jitter, cx, cy }): Point[] =>
    Array.from({ length: n }, (_, i) => {
      const a = ((i + jitter[i]!) / n) * 2 * Math.PI;
      return { x: cx + radii[i]! * Math.cos(a), y: cy + radii[i]! * Math.sin(a) };
    }),
  );

const inputArb = fc.record({
  area: starArb,
  style: fc.constantFrom<LayoutStyle>('rows', 'squares', 'mounds'),
  aisleCm: fc.double({ min: 20, max: 120, noNaN: true }),
  borderCm: fc.double({ min: 0, max: 120, noNaN: true }),
  crossAisleCm: fc.double({ min: 20, max: 120, noNaN: true }),
  bedWidthCm: fc.double({ min: 60, max: 200, noNaN: true }),
  bedMaxLengthCm: fc.option(fc.double({ min: 200, max: 1500, noNaN: true }), { nil: undefined }),
  sizeCm: fc.double({ min: 60, max: 200, noNaN: true }),
  bedAxisDeg: fc.option(fc.double({ min: -360, max: 360, noNaN: true }), { nil: undefined }),
});

type Drawn = typeof inputArb extends fc.Arbitrary<infer T> ? T : never;

function toInput(r: Drawn): LayoutInput {
  return {
    area: r.area,
    style: r.style,
    aisles: { aisleCm: r.aisleCm, borderCm: r.borderCm, crossAisleCm: r.crossAisleCm },
    sizes: { bedWidthCm: r.bedWidthCm, bedMaxLengthCm: r.bedMaxLengthCm, squareCm: r.sizeCm, moundCm: r.sizeCm },
    orientation: { bedAxisDeg: r.bedAxisDeg },
  };
}

const edges = (ring: readonly Point[]): [Point, Point][] => ring.map((p, i) => [p, ring[(i + 1) % ring.length]!]);
const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function segmentDistance([a, b]: [Point, Point], [c, d]: [Point, Point]): number {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

function outlineDistance(p: readonly Point[], q: readonly Point[]): number {
  let best = Infinity;
  for (const e of edges(p)) for (const f of edges(q)) best = Math.min(best, segmentDistance(e, f));
  return best;
}

function inside(ring: readonly Point[], p: Point): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
}

const rotate = (deg: number) => (p: Point): Point => {
  const a = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};

describe('generateLayout properties', () => {
  it('keeps every bed inside the plot, at least the border away from the outline', () => {
    fc.assert(
      fc.property(inputArb, (r) => {
        const out = generateLayout(toInput(r));
        if (!out.ok) {
          expect([AREA_TOO_SMALL, TOO_MANY_BEDS]).toContain(out.error);
          return;
        }
        for (const bed of out.value.beds) {
          expect(inside(r.area, bed.centerCm)).toBe(true);
          expect(outlineDistance(bed.polygonCm, r.area)).toBeGreaterThanOrEqual(r.borderCm - EPS * 1e3);
        }
      }),
      { numRuns: 150 },
    );
  });

  // Two beds on either side of a notch of the outline are kept apart by the notch and by twice the
  // border, not by an aisle: the outline is not walkable ground, so the aisle rule does not apply there.
  it('keeps an aisle between any two beds', () => {
    fc.assert(
      fc.property(inputArb, (r) => {
        const out = generateLayout(toInput(r));
        if (!out.ok) return;
        const aisle = r.style === 'rows' ? Math.min(r.aisleCm, r.crossAisleCm) : r.aisleCm;
        const gap = Math.min(aisle, 2 * r.borderCm);
        const beds = out.value.beds;
        expect(beds.length).toBeLessThanOrEqual(MAX_BEDS);
        for (let i = 0; i < beds.length; i++) {
          for (let j = i + 1; j < beds.length; j++) {
            const reach = (beds[i]!.lengthCm + beds[j]!.lengthCm + beds[i]!.widthCm + beds[j]!.widthCm) / 2 + gap;
            const c = beds[i]!.centerCm;
            const d = beds[j]!.centerCm;
            if (Math.hypot(c.x - d.x, c.y - d.y) > reach) continue;
            expect(inside(beds[j]!.polygonCm, beds[i]!.centerCm)).toBe(false);
            expect(outlineDistance(beds[i]!.polygonCm, beds[j]!.polygonCm)).toBeGreaterThanOrEqual(gap - EPS * 1e3);
          }
        }
      }),
      { numRuns: 80 },
    );
  });

  it('accounts for the whole area and stays deterministic', () => {
    fc.assert(
      fc.property(inputArb, (r) => {
        const out = generateLayout(toInput(r));
        if (!out.ok) return;
        const s = out.value.stats;
        expect(s.cultivatedAreaCm2 + s.aisleAreaCm2).toBeCloseTo(s.totalAreaCm2, 3);
        expect(s.cultivatedShare).toBeGreaterThan(0);
        expect(s.cultivatedShare).toBeLessThanOrEqual(1);
        expect(s.bedCount).toBe(out.value.beds.length);
        expect(generateLayout(toInput(r))).toEqual(out);
      }),
      { numRuns: 100 },
    );
  });

  it('does not depend on how the plot is turned in the plan', () => {
    fc.assert(
      fc.property(inputArb, fc.double({ min: -180, max: 180, noNaN: true }), (r, theta) => {
        const axis = r.bedAxisDeg ?? 17;
        const a = generateLayout(toInput({ ...r, bedAxisDeg: axis }));
        const b = generateLayout(toInput({ ...r, area: r.area.map(rotate(theta)), bedAxisDeg: axis + theta }));
        expect(b.ok).toBe(a.ok);
        if (!a.ok || !b.ok) return;
        // Float noise may flip a bed that fits to within a micrometre; anything more is a real difference.
        expect(Math.abs(a.value.beds.length - b.value.beds.length)).toBeLessThanOrEqual(1);
        expect(b.value.stats.cultivatedAreaCm2 / a.value.stats.cultivatedAreaCm2).toBeCloseTo(1, 1);
      }),
      { numRuns: 100 },
    );
  });
  it('never yields fewer row beds on a longer run when a maximum length is set', () => {
    fc.assert(
      fc.property(
        fc.record({
          border: fc.double({ min: 0, max: 100, noNaN: true }),
          cross: fc.double({ min: 20, max: 120, noNaN: true }),
          min: fc.double({ min: 50, max: 400, noNaN: true }),
          extra: fc.double({ min: 0, max: 200, noNaN: true }),
          short: fc.double({ min: 0, max: 3000, noNaN: true }),
          more: fc.double({ min: 0, max: 600, noNaN: true }),
        }),
        ({ border, cross, min, extra, short, more }) => {
          const max = min + extra;
          const beds = (run: number) => {
            const out = generateLayout({
              area: [
                { x: 0, y: 0 },
                { x: run + 2 * border, y: 0 },
                { x: run + 2 * border, y: 120 + 2 * border },
                { x: 0, y: 120 + 2 * border },
              ],
              style: 'rows',
              orientation: { bedAxisDeg: 0 },
              aisles: { aisleCm: 40, borderCm: border, crossAisleCm: cross },
              sizes: { bedWidthCm: 120, bedMinLengthCm: min, bedMaxLengthCm: max },
            });
            if (!out.ok) {
              expect(out.error).toBe(AREA_TOO_SMALL);
              return [];
            }
            return out.value.beds;
          };
          const shorter = beds(short + 1);
          const longer = beds(short + 1 + more);
          expect(longer.length).toBeGreaterThanOrEqual(shorter.length);
          // Bed lengths come out rounded to 1e-4 cm.
          for (const b of [...shorter, ...longer]) {
            expect(b.lengthCm).toBeGreaterThanOrEqual(min - 1e-4);
            expect(b.lengthCm).toBeLessThanOrEqual(max + 1e-4);
          }
          if (short + 1 >= min) expect(shorter.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});
