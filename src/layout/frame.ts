import type { Point } from '../geometry/types.js';

/**
 * The bed frame: `u` runs along the bed axis, `v` across it (90 degrees counter-clockwise from the
 * axis). Every placement is computed in this frame on axis-aligned rectangles, then turned back.
 */
export type Frame = { cos: number; sin: number };
export type Interval = { from: number; to: number };

/** Two values closer than this (in cm) are the same position: far below any garden measurement. */
export const CM_EPS = 1e-7;

export function frameOf(axisDeg: number): Frame {
  const a = (axisDeg * Math.PI) / 180;
  return { cos: Math.cos(a), sin: Math.sin(a) };
}

export function toFrame(f: Frame, p: Point): Point {
  return { x: p.x * f.cos + p.y * f.sin, y: -p.x * f.sin + p.y * f.cos };
}

export function fromFrame(f: Frame, p: Point): Point {
  return { x: p.x * f.cos - p.y * f.sin, y: p.x * f.sin + p.y * f.cos };
}

/** Even-odd ray casting; a point exactly on the outline may go either way, callers never ask for one. */
function inside(ring: readonly Point[], p: Point): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
}

/** u positions where the cross-section of the strip v in [lo, hi] can change. */
function breakpoints(ring: readonly Point[], lo: number, hi: number): number[] {
  const us: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a.y >= lo && a.y <= hi) us.push(a.x);
    for (const v of [lo, hi]) {
      if ((a.y - v) * (b.y - v) < 0) us.push(a.x + ((v - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  us.sort((p, q) => p - q);
  return us.filter((u, i) => i === 0 || u - us[i - 1]! > CM_EPS);
}

/** True when the segment {u} x [lo, hi] lies inside the outline; `u` is never a breakpoint. */
function segmentInside(ring: readonly Point[], u: number, lo: number, hi: number): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if ((a.x - u) * (b.x - u) >= 0) continue;
    const v = a.y + ((u - a.x) * (b.y - a.y)) / (b.x - a.x);
    if (v > lo && v < hi) return false;
  }
  return inside(ring, { x: u, y: (lo + hi) / 2 });
}

/**
 * The closed u intervals over which the whole strip v in [lo, hi] lies inside the outline (given in
 * the bed frame). Exact for any simple polygon: between two breakpoints no corner enters the strip
 * and no edge crosses its sides, so one test segment per gap decides the whole gap.
 */
export function stripIntervals(ring: readonly Point[], lo: number, hi: number): Interval[] {
  const us = breakpoints(ring, lo, hi);
  const out: Interval[] = [];
  for (let i = 0; i + 1 < us.length; i++) {
    const from = us[i]!;
    const to = us[i + 1]!;
    if (!segmentInside(ring, (from + to) / 2, lo, hi)) continue;
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last.to - from) <= CM_EPS) out[out.length - 1] = { from: last.from, to };
    else out.push({ from, to });
  }
  return out;
}

/** True when [from, to] fits in one of the intervals. */
export function fitsIn(intervals: readonly Interval[], from: number, to: number): boolean {
  return intervals.some((i) => i.from <= from + CM_EPS && to <= i.to + CM_EPS);
}

/** Number of items of size `size` separated by `gap` that fit in `span`, and the start that centres them. */
export function centred(min: number, span: number, size: number, gap: number): { count: number; start: number } {
  const count = span + CM_EPS < size ? 0 : Math.floor((span + gap + CM_EPS) / (size + gap));
  const used = count * size + Math.max(0, count - 1) * gap;
  return { count, start: min + (span - used) / 2 };
}

export function boundsOf(points: readonly Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
