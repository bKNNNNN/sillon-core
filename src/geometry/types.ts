import type { Result } from '../result.js';
import { fail, ok } from '../result.js';

/** A point in any plane: photo pixels (y down) or ground centimetres. */
export type Point = { readonly x: number; readonly y: number };

/** Four corners in order around the outline (either winding). */
export type Quad = readonly [Point, Point, Point, Point];

/** A 3 x 3 projective matrix, row-major: [h11, h12, h13, h21, h22, h23, h31, h32, h33]. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

export const INVALID_COORDINATE = 'Coordonnée invalide.';

export function isFinitePoint(p: Point | undefined): p is Point {
  return p !== undefined && p !== null && Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function checkPoints(points: readonly Point[]): Result<readonly Point[]> {
  return points.every(isFinitePoint) ? ok(points) : fail(INVALID_COORDINATE);
}

/** z of (b - a) x (c - b): positive for a left turn when y points up. */
export function turn(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}
