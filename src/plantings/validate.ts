import { isTooFarInFuture, isValidCivilDate } from '../dates.js';
import type { PlantingInput } from './types.js';

export function validatePlanting(input: PlantingInput, today: string): string | null {
  if (!isValidCivilDate(input.sownOn)) return 'La date de semis est invalide.';
  if (input.transplantedOn && !isValidCivilDate(input.transplantedOn)) return 'La date de repiquage est invalide.';
  if (input.harvestedOn && !isValidCivilDate(input.harvestedOn)) return 'La date de récolte est invalide.';
  if (isTooFarInFuture(input.sownOn, today)) return 'La date de semis est dans le futur.';
  if (input.transplantedOn && input.transplantedOn < input.sownOn) {
    return 'La date de repiquage est avant la date de semis.';
  }
  if (input.harvestedOn && input.harvestedOn < input.sownOn) {
    return 'La date de récolte est avant la date de semis.';
  }
  return null;
}
