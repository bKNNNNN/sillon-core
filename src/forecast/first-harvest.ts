import { addDays } from '../dates.js';
import { firstHarvestsOf, type Crop } from '../crops/schema.js';
import type { PlantingLike } from '../plantings/types.js';

export type FirstHarvestPlanting = Pick<PlantingLike, 'sownOn' | 'transplantedOn' | 'method'>;
export type FirstHarvest = { expected: string; estimate: boolean };

/** The date the delay counts from, or null when this planting has no such date. */
function origin(planting: FirstHarvestPlanting, from: 'sowing' | 'transplant'): string | null {
  if (from === 'sowing') return planting.method === 'bought' ? null : planting.sownOn;
  if (planting.transplantedOn) return planting.transplantedOn;
  return planting.method === 'bought' ? planting.sownOn : null;
}

/** First harvest date from `firstHarvestDays`, or null when the crop or the planting cannot give one. */
export function forecastFirstHarvest(planting: FirstHarvestPlanting, crop: Crop): FirstHarvest | null {
  const delay = crop.firstHarvestDays;
  if (!delay) return null;
  const planted = Boolean(planting.transplantedOn) || planting.method === 'bought';
  const order: ('sowing' | 'transplant')[] = planted ? ['transplant', 'sowing'] : ['sowing', 'transplant'];
  const entries = firstHarvestsOf(delay.value);
  for (const from of order) {
    const entry = entries.find((e) => e.from === from);
    const start = entry && origin(planting, from);
    if (entry && start) return { expected: addDays(start, entry.days), estimate: !!delay.estimate };
  }
  return null;
}
