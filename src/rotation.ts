import { getCrop } from './crops/parse.js';
import { firstHarvestsOf, type Crop, type Sourced } from './crops/schema.js';
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
  valerianacees: 'Valérianacées',
};

type Rule = Readonly<Sourced<number>>;

/** Rotation rules. A family returns to a bed only once `years` seasons have passed (2022 then 2026 for 4 years). */
export const ROTATION_RULES: Readonly<{
  defaultYears: Rule;
  familyYears: Readonly<Record<string, Rule>>;
  shortCropMaxDays: Rule;
}> = {
  defaultYears: { value: 3, estimate: true },
  familyYears: {
    solanacees: {
      value: 4,
      estimate: true,
      source:
        "BSV Maraichage Nord Nouvelle-Aquitaine n. 5, 28/05/2024, p. 3, https://draaf.nouvelle-aquitaine.agriculture.gouv.fr/IMG/pdf/bsv_maraichage_nord_na_05_20240528.pdf ('Faire des rotations sur 3 a 4 ans sans d'autres solanacees', lu le 2026-10-20) ; borne haute retenue",
    },
    brassicacees: {
      value: 4,
      estimate: true,
      source:
        "CETIOM, 'Hernie des cruciferes', Oleoscope 2005, https://ecophytopic.fr/sites/default/files/2021-06/PIherniedescrucif%C3%A8res_oleoscope_2005.pdf ('80 % des parcelles a fort pouvoir infectieux ont un pH inferieur a 6', lu le 2026-10-20) ; la duree de 4 ans est une estimation",
    },
  },
  /** A crop whose every first harvest comes within this many days neither gets nor causes a warning. */
  shortCropMaxDays: { value: 45, estimate: true },
};

/** Families whose warning comes with the one-time soil pH advice (clubroot on acidic sand). */
const SOIL_PH_FAMILIES: ReadonlySet<string> = new Set(['brassicacees']);

export type RotationAdvice = {
  warning: string;
  family: string;
  /** The latest season the family grew on this bed: a previous one, or this one for a different crop sown earlier. */
  lastYear: number;
  rotationYears: number;
  /** Show the soil pH advice card next to the warning. */
  soilPhAdvice: boolean;
};

type History = Pick<PlantingLike, 'species' | 'sownOn'>[];

/** A season is the calendar year of the sowing date. */
const seasonOf = (date: string): number => Number(date.slice(0, 4));

/**
 * A past planting counts against the new one when it grew in a previous season within the rotation,
 * or earlier in the same season as a different crop (summer cabbage then winter cabbage).
 * A resowing or succession of the same crop in one season never counts.
 */
function counts(past: Crop, sownOn: string, crop: Crop, newSownOn: string, years: number): boolean {
  const season = seasonOf(newSownOn);
  const year = seasonOf(sownOn);
  if (year === season) return past.id !== crop.id && sownOn < newSownOn;
  return year < season && year > season - years;
}

function isShortCrop(crop: Crop): boolean {
  const delays = crop.firstHarvestDays?.value;
  if (!delays) return false;
  return firstHarvestsOf(delays).every((d) => d.days <= ROTATION_RULES.shortCropMaxDays.value);
}

function rotationYears(family: string): number {
  return (ROTATION_RULES.familyYears[family] ?? ROTATION_RULES.defaultYears).value;
}

export function rotationAdvice(history: History, species: string, sownOn: string, crops: Crop[]): RotationAdvice | null {
  const crop = getCrop(crops, species);
  if (!crop || isShortCrop(crop)) return null;
  const { family } = crop;
  const years = rotationYears(family);
  const seasons = history
    .filter((h) => {
      const past = getCrop(crops, h.species);
      return past?.family === family && !isShortCrop(past) && counts(past, h.sownOn, crop, sownOn, years);
    })
    .map((h) => seasonOf(h.sownOn));
  if (seasons.length === 0) return null;
  const lastYear = Math.max(...seasons);
  const label = FAMILY_LABELS[family] ?? family;
  return {
    warning: `${label} déjà sur cette planche en ${lastYear} : pense à faire tourner.`,
    family,
    lastYear,
    rotationYears: years,
    soilPhAdvice: SOIL_PH_FAMILIES.has(family),
  };
}

/** The warning text alone, or null. Two sowings of the same crop in one season never warn. */
export function rotationWarning(history: History, species: string, sownOn: string, crops: Crop[]): string | null {
  return rotationAdvice(history, species, sownOn, crops)?.warning ?? null;
}
