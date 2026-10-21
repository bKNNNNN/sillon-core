import type { Result } from '../result.js';
import { fail, ok } from '../result.js';
import { checkPoints, turn, type Point } from './types.js';

export const TOO_FEW_CORNERS = 'Il faut au moins trois coins.';
export const FLAT_OUTLINE = 'Le contour est plat.';
export const SELF_CROSSING = 'Le contour se croise.';

/** Drops the closing point of a ring that repeats its first corner. */
function openRing(points: readonly Point[]): readonly Point[] {
  const first = points[0];
  const last = points[points.length - 1];
  const closed = points.length > 3 && first!.x === last!.x && first!.y === last!.y;
  return closed ? points.slice(0, -1) : points;
}

function shoelace(ring: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

function sideOf(a: Point, b: Point, c: Point, eps: number): number {
  const t = turn(a, b, c);
  return Math.abs(t) <= eps ? 0 : Math.sign(t);
}

/** Closed segments ab and cd share a point (touching counts). */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point, eps: number): boolean {
  const d1 = sideOf(c, d, a, eps);
  const d2 = sideOf(c, d, b, eps);
  const d3 = sideOf(a, b, c, eps);
  const d4 = sideOf(a, b, d, eps);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  const within = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) - eps <= r.x && r.x <= Math.max(p.x, q.x) + eps &&
    Math.min(p.y, q.y) - eps <= r.y && r.y <= Math.max(p.y, q.y) + eps;
  return (
    (d1 === 0 && within(c, d, a)) ||
    (d2 === 0 && within(c, d, b)) ||
    (d3 === 0 && within(a, b, c)) ||
    (d4 === 0 && within(a, b, d))
  );
}

function crossesItself(ring: readonly Point[], eps: number): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsMeet(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!, eps)) return true;
    }
  }
  return false;
}

/** Validates a simple polygon and returns its open ring. */
function simpleRing(points: readonly Point[]): Result<readonly Point[]> {
  if (!Array.isArray(points)) return fail(TOO_FEW_CORNERS);
  const checked = checkPoints(points);
  if (!checked.ok) return checked;
  const ring = openRing(points);
  if (ring.length < 3) return fail(TOO_FEW_CORNERS);
  const span = Math.max(...ring.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))), 1);
  const eps = span * span * 1e-12;
  if (crossesItself(ring, eps)) return fail(SELF_CROSSING);
  if (Math.abs(shoelace(ring)) <= eps) return fail(FLAT_OUTLINE);
  return ok(ring);
}

/** Shoelace area, positive for a counter-clockwise outline when y points up. */
export function signedPolygonArea(points: readonly Point[]): Result<number> {
  const ring = simpleRing(points);
  return ring.ok ? ok(shoelace(ring.value)) : ring;
}

/** Area of a simple polygon (convex or not), in the square of its unit. */
export function polygonArea(points: readonly Point[]): Result<number> {
  const signed = signedPolygonArea(points);
  return signed.ok ? ok(Math.abs(signed.value)) : signed;
}

/** Length of the closed outline of a simple polygon. */
export function polygonPerimeter(points: readonly Point[]): Result<number> {
  const ring = simpleRing(points);
  if (!ring.ok) return ring;
  const r = ring.value;
  let length = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return ok(length);
}
