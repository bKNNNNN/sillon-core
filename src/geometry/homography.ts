import type { Result } from '../result.js';
import { fail, ok } from '../result.js';
import { INVALID_COORDINATE, isFinitePoint, turn, type Homography, type Point, type Quad } from './types.js';

export const NOT_FOUR_CORNERS = 'Il faut exactement quatre coins.';
export const NOT_CONVEX = 'Les quatre coins doivent former un quadrilatère convexe, pris dans l’ordre du tour.';
export const NOT_INVERTIBLE = 'Transformation impossible à inverser.';
export const AT_HORIZON = 'Point à l’horizon, hors du sol.';

type Matrix3 = Homography;

/** Below this, a value is zero relative to the scale it was computed from (doubles keep ~16 digits). */
const EPS = 1e-12;
/** Normalised corners sit at about distance sqrt(2) from 0; a turn below this is a straight line. */
const TURN_EPS = 1e-9;

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const m = (r: number, c: number) => a[3 * r]! * b[c]! + a[3 * r + 1]! * b[3 + c]! + a[3 * r + 2]! * b[6 + c]!;
  return [m(0, 0), m(0, 1), m(0, 2), m(1, 0), m(1, 1), m(1, 2), m(2, 0), m(2, 1), m(2, 2)];
}

function norm(h: readonly number[]): number {
  return Math.hypot(...h);
}

/**
 * Scales |h33| to 1 when it is not zero, otherwise to unit Frobenius norm. The factor is always
 * positive: the sign of w = h31·x + h32·y + h33 tells the ground side of the vanishing line from the
 * sky side, so it must survive normalisation.
 */
function normalise(h: Matrix3): Result<Matrix3> {
  const n = norm(h);
  if (!(n > 0) || !h.every(Number.isFinite)) return fail(NOT_INVERTIBLE);
  const k = Math.abs(h[8]) > EPS * n ? Math.abs(h[8]) : n;
  return ok(h.map((v) => v / k) as unknown as Matrix3);
}

/** Flips the whole matrix when needed so that w > 0 at `inside`, a point known to have a ground image. */
function orient(h: Matrix3, inside: Point): Matrix3 {
  const w = h[6] * inside.x + h[7] * inside.y + h[8];
  return w < 0 ? (h.map((v) => -v) as unknown as Matrix3) : h;
}

function centroid(q: Quad): Point {
  return { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
}

/**
 * Hartley conditioning: moves the centroid to 0 and the mean distance to sqrt(2), so photo pixels
 * (thousands) and centimetres solve with the same precision.
 */
function conditioner(q: Quad): { points: Point[]; forward: Matrix3; backward: Matrix3 } {
  const { x: cx, y: cy } = centroid(q);
  const mean = q.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / 4;
  const s = Math.SQRT2 / mean;
  return {
    points: q.map((p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) })),
    forward: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1],
    backward: [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1],
  };
}

/** Strictly convex in tour order, either winding. Also rejects repeated and aligned corners. */
function isConvex(points: readonly Point[]): boolean {
  const turns = points.map((p, i) => turn(p, points[(i + 1) % 4]!, points[(i + 2) % 4]!));
  return turns.every((t) => t > TURN_EPS) || turns.every((t) => t < -TURN_EPS);
}

/** Gaussian elimination with partial pivoting on an n x (n + 1) augmented matrix. */
function solve(rows: number[][]): number[] | null {
  const n = rows.length;
  const a = rows.map((r) => [...r]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < EPS) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c <= n; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = a[r]![n]!;
    for (let c = r + 1; c < n; c++) sum -= a[r]![c]! * x[c]!;
    x[r] = sum / a[r]![r]!;
  }
  return x;
}

function checkQuad(q: Quad): Result<Quad> {
  if (!Array.isArray(q) || q.length !== 4) return fail(NOT_FOUR_CORNERS);
  if (!q.every(isFinitePoint)) return fail(INVALID_COORDINATE);
  return ok(q);
}

/**
 * Direct linear transform from four point pairs: the homography H with H·from[i] = to[i].
 * Typical use: `from` = corners tapped on the photo, `to` = the same corners on the ground in cm.
 * Both quads must be convex and listed in the same tour order; the winding may differ (a photo has y down).
 * The result is oriented so that w > 0 on the side of the vanishing line that holds `from`: convexity
 * of both quads puts all four corners, hence their centroid, on that one side.
 */
export function homographyFromQuad(from: Quad, to: Quad): Result<Homography> {
  const src = checkQuad(from);
  if (!src.ok) return src;
  const dst = checkQuad(to);
  if (!dst.ok) return dst;
  const s = conditioner(src.value);
  const d = conditioner(dst.value);
  if (!isConvex(s.points) || !isConvex(d.points)) return fail(NOT_CONVEX);

  const rows: number[][] = [];
  s.points.forEach(({ x, y }, i) => {
    const { x: u, y: v } = d.points[i]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  const h = solve(rows);
  if (h === null) return fail(NOT_CONVEX);
  const conditioned = [...h, 1] as unknown as Matrix3;
  return normalise(orient(multiply(d.backward, multiply(conditioned, s.forward)), centroid(src.value)));
}

/**
 * |det| can reach at most the product of the row norms, and of the column norms (Hadamard). The smaller
 * of the two is the scale to compare against: a photo homography mixes pixel offsets in its last column
 * with tiny coefficients elsewhere, so a bound built on the whole matrix norm would call it singular.
 */
function hadamardBound(h: Matrix3): number {
  const rows = norm(h.slice(0, 3)) * norm(h.slice(3, 6)) * norm(h.slice(6, 9));
  const cols = norm([h[0], h[3], h[6]]) * norm([h[1], h[4], h[7]]) * norm([h[2], h[5], h[8]]);
  return Math.min(rows, cols);
}

/**
 * The inverse homography (photo to ground becomes ground to photo). It keeps the orientation: if
 * H·p = w·(q, 1) with w > 0, then H⁻¹·(q, 1) = (1/w)·(p, 1), so every ground point that came from the
 * photo's ground side gets w > 0 again. Dividing by the determinant, whatever its sign, is what keeps it.
 */
export function invertHomography(h: Homography): Result<Homography> {
  if (!Array.isArray(h) || h.length !== 9 || !h.every(Number.isFinite)) return fail(NOT_INVERTIBLE);
  const [a, b, c, d, e, f, g, i, j] = h;
  const adj: Matrix3 = [
    e * j - f * i,
    c * i - b * j,
    b * f - c * e,
    f * g - d * j,
    a * j - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ];
  const det = a * adj[0] + b * adj[3] + c * adj[6];
  if (!(Math.abs(det) > EPS * hadamardBound(h))) return fail(NOT_INVERTIBLE);
  return normalise(adj.map((v) => v / det) as unknown as Matrix3);
}

/**
 * Applies H to one point. Fails for a point on the vanishing line or beyond it (w <= 0): such a point
 * (sky, or anything past the horizon) has no image on the ground, only a mirror image behind the camera.
 */
export function projectPoint(h: Homography, p: Point): Result<Point> {
  if (!isFinitePoint(p)) return fail(INVALID_COORDINATE);
  const w = h[6] * p.x + h[7] * p.y + h[8];
  const scale = Math.abs(h[6] * p.x) + Math.abs(h[7] * p.y) + Math.abs(h[8]);
  if (!(w > EPS * scale)) return fail(AT_HORIZON);
  const x = (h[0] * p.x + h[1] * p.y + h[2]) / w;
  const y = (h[3] * p.x + h[4] * p.y + h[5]) / w;
  return Number.isFinite(x) && Number.isFinite(y) ? ok({ x, y }) : fail(AT_HORIZON);
}

/** Applies H to every point of an outline; the first failing point fails the whole outline. */
export function projectPolygon(h: Homography, points: readonly Point[]): Result<Point[]> {
  const out: Point[] = [];
  for (const p of points) {
    const r = projectPoint(h, p);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}
