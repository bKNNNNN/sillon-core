import type { Point } from '../geometry/types.js';
import type { Sourced } from '../crops/schema.js';
import type { Param } from '../alerts/types.js';

/**
 * Plan frame shared by every layout module: ground centimetres, x to the right, y up (the frame of
 * `polygonArea`, counter-clockwise outlines have a positive signed area). Angles are in degrees,
 * counter-clockwise from +x.
 */
export type LayoutStyle = 'rows' | 'squares' | 'mounds';

export type LayoutOrientation = {
  /** Direction of the beds' long axis. Default: along the longest side of the area. */
  bedAxisDeg?: number;
  /** Direction of geographic north in the plan. Without it, the exposure note says it is unknown. */
  northDeg?: number;
};

/** Widths in cm. `borderCm` and `crossAisleCm` default to `aisleCm`. */
export type LayoutAisles = {
  /** Path between two beds side by side (or two squares, two mounds). */
  aisleCm: number;
  /** Free strip kept between the area outline and every bed. */
  borderCm?: number;
  /** Path that cuts a long row bed in two when it would pass `bedMaxLengthCm`. */
  crossAisleCm?: number;
};

/** Bed sizes in cm. Missing values come from `LAYOUT_PARAMS` (estimates). */
export type LayoutSizes = {
  /** Width of a row bed (planche). */
  bedWidthCm?: number;
  /** Shortest row bed worth tracing; shorter leftovers are dropped. */
  bedMinLengthCm?: number;
  /** Longest row bed before a cross aisle; no limit when absent. */
  bedMaxLengthCm?: number;
  /** Side of a square bed (carré). */
  squareCm?: number;
  /** Diameter of a round mound (butte). */
  moundCm?: number;
};

/** A crop as the layout reads it: the cultures `spacingCm`, if any. */
export type LayoutCrop = {
  id: string;
  name: string;
  spacingCm?: Sourced<{ inRow: number; betweenRows: number }>;
};

export type LayoutInput = {
  /** Outline of the land, simple polygon (convex or not), in cm, 3 to `MAX_AREA_CORNERS` corners. */
  area: readonly Point[];
  style: LayoutStyle;
  aisles: LayoutAisles;
  orientation?: LayoutOrientation;
  sizes?: LayoutSizes;
  crops?: readonly LayoutCrop[];
};

export type BedShape = 'rect' | 'mound';

export type LayoutBed = {
  /** Stable within one layout: `planche-1`, `carre-1`, `butte-1`, in tracing order. */
  id: string;
  /** French label shown to the user: « Planche 1 », « Carré 1 », « Butte 1 ». */
  label: string;
  shape: BedShape;
  /** Outline in the plan frame, counter-clockwise. A mound is a regular polygon of `MOUND_SIDES` sides. */
  polygonCm: Point[];
  /** Centre of the bed in the plan frame. */
  centerCm: Point;
  /** Across the bed (the mound diameter for a mound). */
  widthCm: number;
  /** Along the bed axis (the mound diameter for a mound). */
  lengthCm: number;
  /** Area of `polygonCm`. */
  areaCm2: number;
};

export type CropCapacity = {
  cropId: string;
  name: string;
  /** Plants that fit in one bed of each size, `null` when the crop has no spacing data. */
  perBed: { bedId: string; rows: number; plants: number }[] | null;
  /** Plants if every bed held this crop alone; `null` without spacing data. */
  totalPlants: number | null;
  /** The spacing used and where it came from, or `null` (« pas de donnée »). */
  spacing: Sourced<{ inRow: number; betweenRows: number }> | null;
};

export type ExposureNote = {
  /** `north-south`, `east-west`, `diagonal`, or `unknown` when no north was given. */
  axis: 'north-south' | 'east-west' | 'diagonal' | 'unknown';
  /** French advice, one or two sentences. */
  text: string;
  source?: string;
  estimate: boolean;
};

export type LayoutStats = {
  totalAreaCm2: number;
  cultivatedAreaCm2: number;
  /** Everything that is not a bed: aisles, border, leftovers. */
  aisleAreaCm2: number;
  /** cultivated / total, between 0 and 1. */
  cultivatedShare: number;
  bedCount: number;
  exposure: ExposureNote;
  crops: CropCapacity[];
};

export type Layout = {
  style: LayoutStyle;
  bedAxisDeg: number;
  beds: LayoutBed[];
  stats: LayoutStats;
  /** Every size and aisle used, with its origin, so the UI can say which values are estimates. */
  params: Record<string, Param>;
};
