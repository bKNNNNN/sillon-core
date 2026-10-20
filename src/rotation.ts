import { getCrop } from './crops/parse.js';
import type { Crop } from './crops/schema.js';
import type { PlantingLike } from './plantings/types.js';

export const FAMILY_LABELS: Readonly<Record<string, string>> = {
  solanacees: 'Solanacées',
  cucurbitacees: 'Cucurbitacées',
  fabacees: 'Fabacées',
  asteracees: 'Astéracées',
  brassicacees: 'Brassicacées',
  apiacees: 'Apiacées',
  amaryllidacees: 'Amaryllidacées',
  amaranthacees: 'Amaranthacées',
  rosacees: 'Rosacées',
  lamiacees: 'Lamiacées',
};

const ROTATION_YEARS = 3;

const yearOf = (date: string): number => Number(date.slice(0, 4));

export function rotationWarning(
  history: Pick<PlantingLike, 'species' | 'sownOn'>[],
  species: string,
  sownOn: string,
  crops: Crop[],
): string | null {
  const family = getCrop(crops, species)?.family;
  if (!family) return null;
  const earliestYear = yearOf(sownOn) - (ROTATION_YEARS - 1);
  const years = history
    .filter((h) => getCrop(crops, h.species)?.family === family)
    .map((h) => yearOf(h.sownOn))
    .filter((y) => y >= earliestYear);
  if (years.length === 0) return null;
  const label = FAMILY_LABELS[family] ?? family;
  return `${label} déjà sur cette planche en ${Math.max(...years)} : pense à faire tourner.`;
}
