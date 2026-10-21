import type { Param, ParamSet } from '../alerts/types.js';

/**
 * Default bed sizes, used when the caller gives none. They are the usual sizes of a hand-worked
 * kitchen garden (a bed you reach to the middle from either side), not measured values: estimates.
 */
export const LAYOUT_PARAMS = {
  bedWidthCm: { value: 120, unit: 'cm', estimate: true },
  bedMinLengthCm: { value: 100, unit: 'cm', estimate: true },
  squareCm: { value: 120, unit: 'cm', estimate: true },
  moundCm: { value: 100, unit: 'cm', estimate: true },
} satisfies ParamSet;

/** Sides of the regular polygon that draws a round mound (area within 0.7 % of the circle). */
export const MOUND_SIDES = 32;
/** Above this, a layout is no longer a garden plan: refuse rather than compute for seconds. */
export const MAX_BEDS = 500;
export const MAX_AREA_CORNERS = 200;
/** 10 km: the span of a plot, in cm. */
export const MAX_SPAN_CM = 1_000_000;
/** 10 m for a path, 100 m for a bed. */
export const MAX_AISLE_CM = 1_000;
export const MAX_SIZE_CM = 10_000;

/** A value typed by the user, recorded next to the defaults so the UI can tell them apart. */
export function entered(value: number): Param {
  return { value, unit: 'cm', estimate: false, source: 'saisie' };
}
