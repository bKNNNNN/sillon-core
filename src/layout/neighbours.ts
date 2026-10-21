import { isFinitePoint, type Point } from '../geometry/types.js';
import { fail, ok, type Result } from '../result.js';
import { MAX_AISLE_CM, MAX_BEDS } from './params.js';

export const INVALID_GAP = 'Écart entre planches invalide.';
export const INVALID_BED_OUTLINE = 'Contour de planche invalide.';

type Outline = { id: string; polygonCm: readonly Point[] };

function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from any corner of `p` to any side of `q`. */
function cornersToSides(p: readonly Point[], q: readonly Point[]): number {
  let best = Infinity;
  for (const point of p) for (let i = 0; i < q.length; i++) best = Math.min(best, pointToSegment(point, q[i]!, q[(i + 1) % q.length]!));
  return best;
}

/** Gap between two outlines that do not overlap (beds of one layout never do). */
function gap(p: readonly Point[], q: readonly Point[]): number {
  return Math.min(cornersToSides(p, q), cornersToSides(q, p));
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boxOf(points: readonly Point[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

const boxesClose = (a: Box, b: Box, d: number) =>
  a.minX - d <= b.maxX && b.minX - d <= a.maxX && a.minY - d <= b.maxY && b.minY - d <= a.maxY;

/**
 * Pairs of beds whose outlines are at most `maxGapCm` apart (the aisle width, plus a little for
 * rounding): the neighbours the crop plan reads companions across. Pairs come in input order.
 */
export function neighbouringBeds(beds: readonly Outline[], maxGapCm: number): Result<[string, string][]> {
  if (!Number.isFinite(maxGapCm) || maxGapCm < 0 || maxGapCm > MAX_AISLE_CM) return fail(INVALID_GAP);
  if (beds.length > MAX_BEDS) return fail(INVALID_BED_OUTLINE);
  if (beds.some((b) => b.polygonCm.length < 3 || b.polygonCm.length > 64 || !b.polygonCm.every(isFinitePoint))) return fail(INVALID_BED_OUTLINE);
  const boxes = beds.map((b) => boxOf(b.polygonCm));
  const pairs: [string, string][] = [];
  for (let i = 0; i < beds.length; i++)
    for (let j = i + 1; j < beds.length; j++) {
      if (!boxesClose(boxes[i]!, boxes[j]!, maxGapCm)) continue;
      if (gap(beds[i]!.polygonCm, beds[j]!.polygonCm) <= maxGapCm) pairs.push([beds[i]!.id, beds[j]!.id]);
    }
  return ok(pairs);
}
