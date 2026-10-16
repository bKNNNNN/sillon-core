export type PlantingMethod = 'direct' | 'pot' | 'bought';
export type PlantingStatus = 'active' | 'done' | 'failed';

/**
 * The planting fields the engine reads. Structurally compatible with a stored
 * planting row: extra fields (id, bedId, note, ...) are accepted and ignored.
 */
export type PlantingLike = {
  species: string;
  sownOn: string;
  method: PlantingMethod;
  status: PlantingStatus;
  transplantedOn?: string | null;
  harvestedOn?: string | null;
};

/** A planting about to be saved: only its dates are validated. */
export type PlantingInput = Pick<PlantingLike, 'sownOn' | 'transplantedOn' | 'harvestedOn'>;
