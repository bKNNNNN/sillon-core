import type { Point } from '../geometry/types.js';
import { boundsOf, centred, CM_EPS, fitsIn, stripIntervals } from './frame.js';
import { MAX_BEDS, MOUND_SIDES } from './params.js';

/** A bed in the bed frame, before it is turned back into the plan. */
export type LocalBed = { shape: 'rect' | 'mound'; u0: number; u1: number; v0: number; v1: number };

export type RowsOptions = { width: number; aisle: number; border: number; cross: number; minLength: number; maxLength?: number };
export type GridOptions = { size: number; aisle: number; border: number };

export const TOO_MANY = Symbol('too many beds');
type Placed = LocalBed[] | typeof TOO_MANY;

/** Cuts a run of length `length` into equal parts no longer than `max`, separated by `cross`. */
function split(from: number, to: number, opts: RowsOptions): [number, number][] {
  const length = to - from;
  const max = opts.maxLength;
  const parts = max === undefined || length <= max + CM_EPS ? 1 : Math.ceil((length + opts.cross) / (max + opts.cross) - CM_EPS);
  const part = (length - (parts - 1) * opts.cross) / parts;
  if (part + CM_EPS < opts.minLength) return [];
  return Array.from({ length: parts }, (_, k): [number, number] => {
    const start = from + k * (part + opts.cross);
    return [start, start + part];
  });
}

/** Row beds (planches): strips across the axis, each cut where the outline narrows. */
export function placeRows(ring: readonly Point[], o: RowsOptions): Placed {
  const b = boundsOf(ring);
  const { count, start } = centred(b.minY + o.border, b.maxY - b.minY - 2 * o.border, o.width, o.aisle);
  if (count > MAX_BEDS) return TOO_MANY;
  const beds: LocalBed[] = [];
  for (let i = 0; i < count; i++) {
    const v0 = start + i * (o.width + o.aisle);
    const v1 = v0 + o.width;
    for (const run of stripIntervals(ring, v0 - o.border, v1 + o.border)) {
      for (const [u0, u1] of split(run.from + o.border, run.to - o.border, o)) {
        beds.push({ shape: 'rect', u0, u1, v0, v1 });
        if (beds.length > MAX_BEDS) return TOO_MANY;
      }
    }
  }
  return beds;
}

/** Square beds (carrés) on one grid centred on the plot; a square is kept when it fits with its border. */
export function placeSquares(ring: readonly Point[], o: GridOptions): Placed {
  const b = boundsOf(ring);
  const across = centred(b.minY + o.border, b.maxY - b.minY - 2 * o.border, o.size, o.aisle);
  const along = centred(b.minX + o.border, b.maxX - b.minX - 2 * o.border, o.size, o.aisle);
  if (across.count > MAX_BEDS || along.count > MAX_BEDS) return TOO_MANY;
  const beds: LocalBed[] = [];
  for (let i = 0; i < across.count; i++) {
    const v0 = across.start + i * (o.size + o.aisle);
    const runs = stripIntervals(ring, v0 - o.border, v0 + o.size + o.border);
    for (let k = 0; k < along.count; k++) {
      const u0 = along.start + k * (o.size + o.aisle);
      if (!fitsIn(runs, u0 - o.border, u0 + o.size + o.border)) continue;
      beds.push({ shape: 'rect', u0, u1: u0 + o.size, v0, v1: v0 + o.size });
      if (beds.length > MAX_BEDS) return TOO_MANY;
    }
  }
  return beds;
}

/**
 * Round mounds (buttes) in staggered rows: centres 'size + aisle' apart in every direction, rows
 * shifted by half a pitch. A mound is kept when its bounding square fits with its border, which keeps
 * at least the border around the circle (a little more at the diagonals). Both staggers are tried
 * (first row shifted or not) and the one holding more mounds wins, the unshifted one on a tie.
 */
export function placeMounds(ring: readonly Point[], o: GridOptions): Placed {
  const b = boundsOf(ring);
  const r = o.size / 2;
  const pitch = o.size + o.aisle;
  const rowPitch = (pitch * Math.sqrt(3)) / 2;
  const reach = o.border + r;
  const spanU = b.maxX - b.minX - 2 * reach;
  const spanV = b.maxY - b.minY - 2 * reach;
  if (spanU < -CM_EPS || spanV < -CM_EPS) return [];
  const rows = Math.floor(spanV / rowPitch + CM_EPS) + 1;
  const perRow = Math.floor(spanU / pitch + CM_EPS) + 1;
  if (rows > MAX_BEDS || perRow > MAX_BEDS) return TOO_MANY;
  const v = b.minY + reach + (spanV - (rows - 1) * rowPitch) / 2;
  const u = b.minX + reach + (spanU - (perRow - 1) * pitch) / 2;
  const runs = Array.from({ length: rows }, (_, i) => stripIntervals(ring, v + i * rowPitch - reach, v + i * rowPitch + reach));
  const pattern = (shifted: 0 | 1): Placed => {
    const beds: LocalBed[] = [];
    for (let i = 0; i < rows; i++) {
      const cv = v + i * rowPitch;
      const odd = i % 2 !== shifted;
      for (let k = odd ? -1 : 0; k < perRow; k++) {
        const cu = u + (odd ? pitch / 2 : 0) + k * pitch;
        if (!fitsIn(runs[i]!, cu - reach, cu + reach)) continue;
        beds.push({ shape: 'mound', u0: cu - r, u1: cu + r, v0: cv - r, v1: cv + r });
        if (beds.length > MAX_BEDS) return TOO_MANY;
      }
    }
    return beds;
  };
  const first = pattern(0);
  const second = pattern(1);
  if (first === TOO_MANY || second === TOO_MANY) return TOO_MANY;
  return second.length > first.length ? second : first;
}

/** Outline of a local bed in the bed frame, counter-clockwise. */
export function localOutline(bed: LocalBed): Point[] {
  if (bed.shape === 'rect') {
    return [
      { x: bed.u0, y: bed.v0 },
      { x: bed.u1, y: bed.v0 },
      { x: bed.u1, y: bed.v1 },
      { x: bed.u0, y: bed.v1 },
    ];
  }
  const cu = (bed.u0 + bed.u1) / 2;
  const cv = (bed.v0 + bed.v1) / 2;
  const r = (bed.u1 - bed.u0) / 2;
  return Array.from({ length: MOUND_SIDES }, (_, k) => {
    const a = (2 * Math.PI * k) / MOUND_SIDES;
    return { x: cu + r * Math.cos(a), y: cv + r * Math.sin(a) };
  });
}
