import type { Param } from '../alerts/types.js';
import { polygonArea, signedPolygonArea } from '../geometry/polygon.js';
import { INVALID_COORDINATE, isFinitePoint, type Point } from '../geometry/types.js';
import { fail, ok, type Result } from '../result.js';
import { CM_EPS, frameOf, fromFrame, toFrame, type Frame } from './frame.js';
import {
  entered,
  LAYOUT_PARAMS,
  MAX_AISLE_CM,
  MAX_AREA_CORNERS,
  MAX_SIZE_CM,
  MAX_SPAN_CM,
} from './params.js';
import { localOutline, placeMounds, placeRows, placeSquares, TOO_MANY, type LocalBed } from './place.js';
import { layoutStats } from './stats.js';
import type { Layout, LayoutBed, LayoutInput, LayoutStyle } from './types.js';

export const INVALID_AISLE = 'Largeur d’allée invalide (entre 0 et 10 m, bordure comprise).';
export const INVALID_SIZE = 'Dimension de planche invalide.';
export const INVALID_ANGLE = 'Angle invalide.';
export const INVALID_STYLE = 'Disposition inconnue : planches, carrés ou buttes.';
export const AREA_TOO_SMALL = 'Terrain trop petit pour y tracer une planche avec ces allées.';
export const AREA_TOO_LARGE = 'Terrain trop grand : 10 km de côté au plus.';
export const TOO_MANY_CORNERS = 'Contour trop détaillé : 200 coins au plus.';
export const TOO_MANY_BEDS = 'Trop de planches : agrandis-les ou élargis les allées.';

const STYLES: Record<LayoutStyle, { prefix: string; label: string }> = {
  rows: { prefix: 'planche', label: 'Planche' },
  squares: { prefix: 'carre', label: 'Carré' },
  mounds: { prefix: 'butte', label: 'Butte' },
};

type Resolved = { params: Record<string, Param>; value: (key: string) => number };

const isWidth = (v: unknown, max: number, zeroOk = false): boolean =>
  typeof v === 'number' && Number.isFinite(v) && (zeroOk ? v >= 0 : v > 0) && v <= max;

function resolveParams(input: LayoutInput): Result<Resolved> {
  const { aisleCm, borderCm, crossAisleCm } = input.aisles ?? ({} as LayoutInput['aisles']);
  if (!isWidth(aisleCm, MAX_AISLE_CM)) return fail(INVALID_AISLE);
  if (borderCm !== undefined && !isWidth(borderCm, MAX_AISLE_CM, true)) return fail(INVALID_AISLE);
  if (crossAisleCm !== undefined && !isWidth(crossAisleCm, MAX_AISLE_CM)) return fail(INVALID_AISLE);
  const params: Record<string, Param> = {
    aisleCm: entered(aisleCm),
    borderCm: entered(borderCm ?? aisleCm),
  };
  const sizes = input.sizes ?? {};
  const keys = {
    rows: ['bedWidthCm', 'bedMinLengthCm', 'bedMaxLengthCm'],
    squares: ['squareCm'],
    mounds: ['moundCm'],
  } as const;
  for (const given of Object.values(sizes)) {
    if (given !== undefined && !isWidth(given, MAX_SIZE_CM)) return fail(INVALID_SIZE);
  }
  for (const key of keys[input.style]) {
    const given = sizes[key];
    if (given !== undefined) params[key] = entered(given);
    else if (key in LAYOUT_PARAMS) params[key] = LAYOUT_PARAMS[key as keyof typeof LAYOUT_PARAMS];
  }
  if (input.style === 'rows') {
    params.crossAisleCm = entered(crossAisleCm ?? aisleCm);
    const max = params.bedMaxLengthCm?.value;
    if (max !== undefined && max + CM_EPS < params.bedMinLengthCm!.value) return fail(INVALID_SIZE);
  }
  return ok({ params, value: (key) => params[key]!.value });
}

function checkArea(area: readonly Point[]): Result<number> {
  if (Array.isArray(area) && area.length > MAX_AREA_CORNERS) return fail(TOO_MANY_CORNERS);
  if (Array.isArray(area) && !area.every(isFinitePoint)) return fail(INVALID_COORDINATE);
  const size = polygonArea(area);
  if (!size.ok) return size;
  const span = Math.max(...area.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  return span > MAX_SPAN_CM ? fail(AREA_TOO_LARGE) : size;
}

/** Direction of the longest side, in [0, 180): beds are parallel to the main fence or path. */
function longestSideDeg(ring: readonly Point[]): number {
  let best = { length: -1, deg: 0 };
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best.length + CM_EPS) best = { length, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  });
  return normaliseAxis(best.deg);
}

/**
 * Beds have no direction, so the axis is brought into (-90, 90]: the along direction then points
 * right (or straight up), which gives the reading order used for numbering.
 */
function normaliseAxis(deg: number): number {
  const d = ((deg % 180) + 180) % 180;
  const half = d > 90 + 1e-9 ? d - 180 : d;
  return Math.abs(half) < 1e-9 ? 0 : half;
}

/** Reading order: the row furthest across the axis first (top of the plan), then along the axis. */
function readingOrder(beds: readonly LocalBed[]): LocalBed[] {
  const row = (b: LocalBed) => Math.round(((b.v0 + b.v1) / 2) * 1e3);
  return [...beds].sort((a, b) => row(b) - row(a) || a.u0 - b.u0);
}

function place(ring: Point[], style: LayoutStyle, r: Resolved) {
  const aisle = r.value('aisleCm');
  const border = r.value('borderCm');
  if (style === 'squares') return placeSquares(ring, { size: r.value('squareCm'), aisle, border });
  if (style === 'mounds') return placeMounds(ring, { size: r.value('moundCm'), aisle, border });
  return placeRows(ring, {
    width: r.value('bedWidthCm'),
    aisle,
    border,
    cross: r.value('crossAisleCm'),
    minLength: r.value('bedMinLengthCm'),
    maxLength: r.params.bedMaxLengthCm?.value,
  });
}

/** Rounds to the micrometre, so a 100 cm mound reads 100 and not 100.00000000000001. */
const micro = (cm: number) => Math.round(cm * 1e4) / 1e4;

function toPlan(f: Frame, style: LayoutStyle, bed: LocalBed, index: number): LayoutBed {
  const { prefix, label } = STYLES[style];
  const outline = localOutline(bed).map((p) => fromFrame(f, p));
  const area = polygonArea(outline);
  return {
    id: `${prefix}-${index + 1}`,
    label: `${label} ${index + 1}`,
    shape: bed.shape,
    polygonCm: outline,
    centerCm: fromFrame(f, { x: (bed.u0 + bed.u1) / 2, y: (bed.v0 + bed.v1) / 2 }),
    widthCm: micro(bed.v1 - bed.v0),
    lengthCm: micro(bed.u1 - bed.u0),
    areaCm2: area.ok ? area.value : 0,
  };
}

/**
 * Traces beds on a blank plot: row beds (planches), square beds (carrés) or round mounds (buttes),
 * with an aisle between beds and a border along the outline. Deterministic: the same input always
 * gives the same beds, numbered in reading order: rows from the top of the plan down, each from
 * left to right (for beds running up the plan, from left to right). Pure geometry, no agronomy number:
 * sizes come from the caller or from `LAYOUT_PARAMS` (estimates), spacing from the cultures data.
 */
export function generateLayout(input: LayoutInput): Result<Layout> {
  if (!input || !(input.style in STYLES)) return fail(INVALID_STYLE);
  const { bedAxisDeg, northDeg } = input.orientation ?? {};
  for (const angle of [bedAxisDeg, northDeg]) {
    if (angle !== undefined && !(typeof angle === 'number' && Number.isFinite(angle))) return fail(INVALID_ANGLE);
  }
  const resolved = resolveParams(input);
  if (!resolved.ok) return resolved;
  const total = checkArea(input.area);
  if (!total.ok) return total;

  const signed = signedPolygonArea(input.area);
  const ring = signed.ok && signed.value < 0 ? [...input.area].reverse() : [...input.area];
  const axis = bedAxisDeg === undefined ? longestSideDeg(ring) : normaliseAxis(bedAxisDeg);
  const frame = frameOf(axis);
  const placed = place(ring.map((p) => toFrame(frame, p)), input.style, resolved.value);
  if (placed === TOO_MANY) return fail(TOO_MANY_BEDS);
  if (placed.length === 0) return fail(AREA_TOO_SMALL);

  const beds = readingOrder(placed).map((bed, i) => toPlan(frame, input.style, bed, i));
  const stats = layoutStats({
    totalAreaCm2: total.value,
    beds,
    style: input.style,
    bedAxisDeg: axis,
    northDeg,
    crops: input.crops ?? [],
  });
  return ok({ style: input.style, bedAxisDeg: axis, beds, stats, params: resolved.value.params });
}
