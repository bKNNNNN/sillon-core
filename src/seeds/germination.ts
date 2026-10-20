import type { Crop } from '../crops/schema.js';

/** Compatible form: `unknown` means the crop has no seed lifespan, `no-year` that the lot has no year. */
export type GerminationOutlook = 'good' | 'reduced' | 'poor' | 'unknown' | 'no-year';

export type SeedLotStatus = 'good' | 'reduced' | 'poor' | 'no-year' | 'no-lifespan';

export type SeedLotOutlook = {
  status: SeedLotStatus;
  /** Last year the lot germinates well (harvest year plus lifespan). Null when either is unknown. */
  goodUntil: number | null;
  /** True during the year the lot reaches its lifespan ("Dernière saison sûre"). */
  lastSafeSeason: boolean;
  /** The lifespan behind `goodUntil` is an estimate. */
  lifespanEstimate: boolean;
};

export type SeedLotYear = { harvestYear?: number | null };

const REDUCED_MARGIN_YEARS = 2;

function unknown(status: 'no-year' | 'no-lifespan'): SeedLotOutlook {
  return { status, goodUntil: null, lastSafeSeason: false, lifespanEstimate: false };
}

function knownYear(lot: SeedLotYear, currentYear: number): number | null {
  const year = lot.harvestYear;
  if (year === null || year === undefined || !Number.isInteger(year)) return null;
  // A harvest year after the current year is a typo, not fresh seed.
  return year > currentYear ? null : year;
}

export function seedLotOutlook(lot: SeedLotYear, crop: Crop | undefined, currentYear: number): SeedLotOutlook {
  const year = knownYear(lot, currentYear);
  if (year === null) return unknown('no-year');
  const lifespan = crop?.seedLifespanYears;
  if (lifespan === undefined) return unknown('no-lifespan');
  const age = currentYear - year;
  const status = age <= lifespan.value ? 'good' : age <= lifespan.value + REDUCED_MARGIN_YEARS ? 'reduced' : 'poor';
  return {
    status,
    goodUntil: year + lifespan.value,
    lastSafeSeason: age === lifespan.value,
    lifespanEstimate: Boolean(lifespan.estimate),
  };
}

/** Kept for existing callers. Prefer `seedLotOutlook`, which also gives `goodUntil` and `lastSafeSeason`. */
export function germinationOutlook(lot: SeedLotYear, crop: Crop | undefined, currentYear: number): GerminationOutlook {
  const { status } = seedLotOutlook(lot, crop, currentYear);
  return status === 'no-lifespan' ? 'unknown' : status;
}
