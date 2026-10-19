import { addDays } from '../dates.js';
import type { Crop } from '../crops/schema.js';
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
  const start = origin(planting, delay.value.from);
  if (!start) return null;
  return { expected: addDays(start, delay.value.days), estimate: !!delay.estimate };
}
