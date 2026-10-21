import type { Param } from '../alerts/types.js';
import type { Crop } from '../crops/schema.js';
import type { PlantingLike } from '../plantings/types.js';

/** A past or current planting on a bed, read for rotation (same shape `rotationAdvice` takes). */
export type CropPlanPast = Pick<PlantingLike, 'species' | 'sownOn'> & Partial<Pick<PlantingLike, 'status' | 'harvestedOn'>>;

export type CropPlanBed = {
  /** Stable id, a stored bed id or a `LayoutBed` id (`planche-1`). */
  id: string;
  /** French label shown in the explanations; defaults to the id. */
  label?: string;
  /** What grew on this bed before, any season. Empty or absent for new land. */
  history?: readonly CropPlanPast[];
};

/** A crop the owner wants this season. */
export type CropPlanWish = {
  /**
   * A catalog id or alias (custom crops included when the caller merges them into `crops`). Any
   * other id is a free-name crop: placed, but with no rotation or companion data (`withoutData`).
   */
  cropId: string;
  /** Beds this crop should take, 1 by default. Two beds of one crop are always two different beds. */
  beds?: number;
  /** Planned sowing date (YYYY-MM-DD); defaults to the plan date. Rotation reads its season. */
  sownOn?: string;
  /** French name of a crop outside the catalog (a free-name crop); ignored for catalog crops. */
  name?: string;
};

export type CropPlanInput = {
  /** Beds free for this season, in the order the owner reads them. */
  beds: readonly CropPlanBed[];
  /** Wanted crops, most wanted first. */
  wishes: readonly CropPlanWish[];
  /** The catalog: families, companions and harvest delays come from here. */
  crops: readonly Crop[];
  /** Planned sowing date of the season (YYYY-MM-DD). */
  sownOn: string;
  /** Pairs of bed ids side by side (see `neighbouringBeds`). Companions also count across them. */
  neighbours?: readonly (readonly [string, string])[];
  /** Crops one bed may hold, 1 (default) to `MAX_CROPS_PER_BED`. Beds fill one crop each before any is shared. */
  cropsPerBed?: number;
  /** Options returned, 1 to 3 (default 3). Identical options are merged, so fewer may come back. */
  maxOptions?: number;
};

/**
 * How one option was built: wishes in the owner's order, hardest to place first, best-connected
 * companions first, or found by the exact search (`exact`, only when it beats every other option;
 * proven best when the plan says `approx: false`).
 */
export type CropPlanStrategy = 'priority' | 'constrained' | 'companions' | 'exact';

export type ScoreKind = 'rotation' | 'companions' | 'families' | 'unplaced';

/** One reason the score moved, in French, with the beds and crops it is about. */
export type ScoreItem = {
  kind: ScoreKind;
  points: number;
  bedIds: string[];
  cropIds: string[];
  text: string;
};

export type ScoreBreakdown = {
  total: number;
  rotation: number;
  companions: number;
  families: number;
  unplaced: number;
  /** Every non-zero term, rotation first, then companions, families and unplaced. */
  items: ScoreItem[];
};

export type CropPlanAssignment = {
  bedId: string;
  label: string;
  /** Catalog ids (aliases resolved), in placing order. Empty when the bed stays free. */
  cropIds: string[];
};

export type CropPlanUnplaced = { cropId: string; name: string; beds: number };

export type CropPlanOption = {
  strategy: CropPlanStrategy;
  /** One entry per input bed, in input order. */
  assignments: CropPlanAssignment[];
  unplaced: CropPlanUnplaced[];
  score: ScoreBreakdown;
};

export type CropPlan = {
  /** Best total first; ties keep the strategy order priority, constrained, companions. */
  options: CropPlanOption[];
  /**
   * false when the first option is proven best among every plan that fills as many places (the
   * exact search finished); true when the garden is too large for the exact search
   * (`MAX_EXACT_BEDS` beds, `MAX_EXACT_SLOTS` places) or its work budget ran out first. Then the
   * options are the best found, not proven best.
   */
  approx: boolean;
  /** Every weight used, flagged as estimates, so the UI can say so. */
  params: Record<string, Param>;
  /** Wished crops outside the catalog, in wish order, with the « pas de donnée » sentence to show. */
  withoutData: CropPlanFreeCrop[];
};

export type CropPlanFreeCrop = { cropId: string; name: string; text: string };
