import type { Crop, DailyWeather, PlantingLike, PlantingMethod, PlantingStatus } from '../src/index.js';

function crop(id: string, family: string): Crop {
  return { id, name: id, family, frostSensitive: false, goodCompanions: [], badCompanions: [] };
}

export const cropFixtures: Crop[] = [
  crop('tomate', 'solanacees'),
  crop('pomme-de-terre', 'solanacees'),
  crop('carotte', 'apiacees'),
];

/** Shaped like a stored planting row, extra fields included, to prove structural compatibility. */
export const basePlanting = {
  id: 'p1',
  species: 'radis',
  variety: null,
  seedLotId: null,
  bedId: 'b1',
  zone: null,
  method: 'direct' as PlantingMethod,
  sownOn: '2026-06-01',
  transplantedOn: null as string | null,
  harvestedOn: null as string | null,
  status: 'active' as PlantingStatus,
  note: null,
  createdAt: '2026-06-01T00:00:00.000Z',
};
basePlanting satisfies PlantingLike;

export const baseCrop: Crop = {
  id: 'radis',
  name: 'Radis',
  family: 'brassicacees',
  frostSensitive: false,
  goodCompanions: [],
  badCompanions: [],
};

export function dayRange(from: string, count: number, tmin: number, tmax: number): DailyWeather[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      tmin,
      tmax,
      precipMm: 0,
      et0Mm: 0,
      source: 'archive' as const,
    };
  });
}
