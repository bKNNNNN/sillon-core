import { solveCropPlan as solve, type Crop, type CropPlan, type CropPlanBed, type CropPlanInput, type CropPlanOption, type Result } from '../src/index.js';

const crop = (id: string, family: string, extra: Partial<Crop> = {}): Crop => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' '),
  family,
  frostSensitive: false,
  goodCompanions: [],
  badCompanions: [],
  ...extra,
});

/** A small catalog with the companion lists of sillon-cultures for these crops (trimmed). */
export const catalog: Crop[] = [
  crop('tomate', 'solanacees', { goodCompanions: ['basilic', 'carotte'], badCompanions: ['pomme-de-terre'] }),
  crop('pomme-de-terre', 'solanacees', { badCompanions: ['tomate', 'courge'] }),
  crop('aubergine', 'solanacees'),
  crop('basilic', 'lamiacees', { goodCompanions: ['tomate'] }),
  crop('carotte', 'apiacees', { goodCompanions: ['tomate', 'poireau'] }),
  crop('panais', 'apiacees'),
  crop('poireau', 'amaryllidacees', { goodCompanions: ['carotte'] }),
  crop('courge', 'cucurbitacees', { goodCompanions: ['haricot'], badCompanions: ['pomme-de-terre'] }),
  crop('haricot', 'fabacees', { goodCompanions: ['courge'], badCompanions: ['ail'] }),
  crop('ail', 'amaryllidacees', { badCompanions: ['haricot'] }),
  crop('chou-ete', 'brassicacees', { aliases: ['chou'], name: "Chou d'été", goodCompanions: ['celeri'] }),
  crop('celeri', 'apiacees', { name: 'Céleri', goodCompanions: ['chou'] }),
  crop('radis', 'brassicacees', { firstHarvestDays: { value: { days: 25, from: 'sowing' }, estimate: true } }),
];

export const beds = (n: number, prefix = 'planche'): CropPlanBed[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i + 1}`, label: `Planche ${i + 1}` }));

/** Beds in a line, each next to the following one. */
export const line = (list: readonly CropPlanBed[]): [string, string][] =>
  list.slice(1).map((b, i) => [list[i]!.id, b.id]);

export const value = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

export const plan = (input: Partial<CropPlanInput> & Pick<CropPlanInput, 'beds' | 'wishes'>): CropPlan =>
  value(solve({ crops: catalog, sownOn: '2026-04-01', ...input }));

/** bed id to the crops it holds. */
export const byBed = (option: CropPlanOption): Record<string, string[]> =>
  Object.fromEntries(option.assignments.map((a) => [a.bedId, a.cropIds]));
