import type { Crop } from '../crops/schema.js';

export type GerminationOutlook = 'good' | 'reduced' | 'poor' | 'unknown';

const REDUCED_MARGIN_YEARS = 2;

export function germinationOutlook(
  lot: { harvestYear: number },
  crop: Crop | undefined,
  currentYear: number,
): GerminationOutlook {
  const lifespan = crop?.seedLifespanYears?.value;
  if (lifespan === undefined) return 'unknown';
  const age = currentYear - lot.harvestYear;
  if (age <= lifespan) return 'good';
  if (age <= lifespan + REDUCED_MARGIN_YEARS) return 'reduced';
  return 'poor';
}
