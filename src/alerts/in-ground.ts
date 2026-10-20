import { getCrop } from '../crops/parse.js';
import type { Crop } from '../crops/schema.js';
import type { PlantingLike } from '../plantings/types.js';
import type { AlertCrop } from './types.js';
import { inGroundOn } from './frost.js';

/**
 * A crop in open ground on a date. `since` is the most recent date one of its plantings went in
 * (the youngest batch, for rules about young plants); `oldest` is the earliest one (the most
 * advanced batch, for rules about a growth stage such as flowering).
 */
export type InGround = { crop: Crop; since: string; oldest: string };

function inGroundOnDate(planting: PlantingLike, date: string): boolean {
  if (planting.status !== 'active') return false;
  if (planting.harvestedOn && planting.harvestedOn <= date) return false;
  const since = inGroundOn(planting);
  return since !== null && since <= date;
}

/** The crops with an active planting in open ground on `date`, once each, in the order first met, with their newest and oldest dates. */
export function cropsInGround(plantings: readonly PlantingLike[], crops: readonly Crop[], date: string): InGround[] {
  const byId = new Map<string, InGround>();
  for (const p of plantings) {
    const crop = getCrop([...crops], p.species);
    if (!crop || !inGroundOnDate(p, date)) continue;
    const since = inGroundOn(p)!;
    const previous = byId.get(crop.id);
    byId.set(
      crop.id,
      previous
        ? { crop, since: since > previous.since ? since : previous.since, oldest: since < previous.oldest ? since : previous.oldest }
        : { crop, since, oldest: since },
    );
  }
  return [...byId.values()];
}

/** True when the crop id, or one of its former ids, is in `ids`. */
export function cropIn(crop: Crop, ids: readonly string[]): boolean {
  return ids.includes(crop.id) || (crop.aliases?.some((a) => ids.includes(a)) ?? false);
}

export const toAlertCrop = (crop: Crop): AlertCrop => ({ species: crop.id, name: crop.name });

/** "tomate, haricot" from crop names. */
export const cropList = (crops: readonly Crop[]) => crops.map((c) => c.name.charAt(0).toLowerCase() + c.name.slice(1)).join(', ');
