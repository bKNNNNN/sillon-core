import type { CropCapacity, ExposureNote, LayoutBed, LayoutCrop, LayoutStats, LayoutStyle } from './types.js';

/** Oregon State University Extension, verbatim sentences behind the row advice. */
export const EXPOSURE_SOURCE =
  "Oregon State University Extension, How do I place my garden rows to promote the best growth?, https://extension.oregonstate.edu/ask-extension/featured/how-do-i-place-my-garden-rows-promote-best-growth ('If the rows run north to south, then tall plants can be planted at the northern end of rows and not shade the rest of the vegetables. If the rows run east to west, tall plants will shade what is north of them.')";

/** Within this many degrees of a cardinal direction, beds count as running along it. */
const AXIS_TOLERANCE_DEG = 22.5;

type Spacing = { inRow: number; betweenRows: number };

/**
 * Plants that fit in one bed: rows `betweenRows` apart across the bed (at least one row, a narrow bed
 * still takes a single row), plants `inRow` apart along each row. On a mound, each row is a chord of
 * the circle, rows centred on the diameter.
 */
export function bedCapacity(bed: LayoutBed, spacing: Spacing): { rows: number; plants: number } {
  const rows = Math.max(1, Math.floor(bed.widthCm / spacing.betweenRows));
  if (bed.shape === 'rect') return { rows, plants: rows * Math.floor(bed.lengthCm / spacing.inRow) };
  const r = bed.widthCm / 2;
  let plants = 0;
  for (let k = 0; k < rows; k++) {
    const offset = (k - (rows - 1) / 2) * spacing.betweenRows;
    plants += Math.floor((2 * Math.sqrt(Math.max(0, r * r - offset * offset))) / spacing.inRow);
  }
  return { rows, plants };
}

function capacity(crop: LayoutCrop, beds: readonly LayoutBed[]): CropCapacity {
  const spacing = crop.spacingCm;
  if (spacing === undefined) return { cropId: crop.id, name: crop.name, perBed: null, totalPlants: null, spacing: null };
  const perBed = beds.map((bed) => ({ bedId: bed.id, ...bedCapacity(bed, spacing.value) }));
  return {
    cropId: crop.id,
    name: crop.name,
    perBed,
    totalPlants: perBed.reduce((sum, b) => sum + b.plants, 0),
    spacing,
  };
}

const GRID_TEXT: Record<Exclude<LayoutStyle, 'rows'>, string> = {
  squares: 'Carrés : mets les cultures hautes côté nord de chaque carré.',
  mounds: 'Buttes : mets les cultures hautes côté nord de chaque butte.',
};

/**
 * Where to put tall crops so they do not shade the others. North-south and east-west row beds follow
 * OSU Extension; the diagonal, square and mound cases extend that rule and are flagged as estimates.
 */
export function exposureNote(o: { style: LayoutStyle; bedAxisDeg: number; northDeg?: number }): ExposureNote {
  if (o.northDeg === undefined) {
    return { axis: 'unknown', text: 'Nord non indiqué : ajoute-le pour savoir où mettre les cultures hautes.', estimate: false };
  }
  const d = (((o.bedAxisDeg - o.northDeg) % 180) + 180) % 180;
  const axis = d <= AXIS_TOLERANCE_DEG || d >= 180 - AXIS_TOLERANCE_DEG ? 'north-south' : Math.abs(d - 90) <= AXIS_TOLERANCE_DEG ? 'east-west' : 'diagonal';
  if (o.style !== 'rows') return { axis, text: GRID_TEXT[o.style], source: EXPOSURE_SOURCE, estimate: true };
  if (axis === 'north-south') {
    return {
      axis,
      text: 'Planches nord-sud : mets les cultures hautes au bout nord, elles ne font pas d’ombre au reste.',
      source: EXPOSURE_SOURCE,
      estimate: false,
    };
  }
  if (axis === 'east-west') {
    return {
      axis,
      text: 'Planches est-ouest : les cultures hautes font de l’ombre au nord, mets-les sur la planche la plus au nord.',
      source: EXPOSURE_SOURCE,
      estimate: false,
    };
  }
  return { axis, text: 'Planches en biais : garde les cultures hautes côté nord pour limiter l’ombre.', source: EXPOSURE_SOURCE, estimate: true };
}

export function layoutStats(o: {
  totalAreaCm2: number;
  beds: readonly LayoutBed[];
  style: LayoutStyle;
  bedAxisDeg: number;
  northDeg?: number;
  crops: readonly LayoutCrop[];
}): LayoutStats {
  const cultivated = o.beds.reduce((sum, b) => sum + b.areaCm2, 0);
  return {
    totalAreaCm2: o.totalAreaCm2,
    cultivatedAreaCm2: cultivated,
    aisleAreaCm2: o.totalAreaCm2 - cultivated,
    cultivatedShare: o.totalAreaCm2 > 0 ? cultivated / o.totalAreaCm2 : 0,
    bedCount: o.beds.length,
    exposure: exposureNote(o),
    crops: o.crops.map((crop) => capacity(crop, o.beds)),
  };
}
