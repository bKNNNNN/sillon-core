import type { ParamSet } from '../alerts/types.js';
import { getCrop } from '../crops/parse.js';
import type { Crop } from '../crops/schema.js';
import { isValidCivilDate } from '../dates.js';
import { fail, ok, type Result } from '../result.js';
import { MAX_BEDS } from './params.js';
import type { CropPlanAssignment, CropPlanInput } from './crop-plan-types.js';

/**
 * Ranking weights of the crop plan score, in points. They order options; they are not agronomy
 * values. Rotation weighs most (advice from sourced rules), a bad companion twice a good one
 * (avoiding harm first), companions themselves are gardener lore without a source (agronomy 10.2.9).
 */
export const CROP_PLAN_WEIGHTS = {
  rotationConflict: { value: -10, unit: 'points', estimate: true },
  goodCompanions: { value: 1, unit: 'points', estimate: true },
  badCompanions: { value: -2, unit: 'points', estimate: true },
  extraFamily: { value: -1, unit: 'points', estimate: true },
  unplacedBed: { value: -5, unit: 'points', estimate: true },
} satisfies ParamSet;

export const MAX_CROPS_PER_BED = 4;
export const MAX_WISHES = 100;
/** Wished beds summed over every wish. */
export const MAX_PLAN_SLOTS = 500;
export const MAX_HISTORY_PER_BED = 500;
export const MAX_NEIGHBOUR_PAIRS = 5_000;
export const MAX_CROP_ID_LENGTH = 80;

export const NO_BED = 'Aucune planche libre.';
export const NO_WISH = 'Aucune culture demandée.';
export const BED_WITHOUT_ID = 'Planche sans identifiant.';
export const INVALID_BED_COUNT = 'Nombre de planches invalide.';
export const INVALID_CROPS_PER_BED = 'Nombre de cultures par planche invalide.';
export const INVALID_OPTIONS = "Nombre d'options invalide.";
export const SELF_NEIGHBOUR = 'Une planche ne peut pas être sa propre voisine.';
export const PLAN_TOO_LARGE = 'Plan trop grand : réduis le nombre de planches ou de cultures.';
export const unknownBed = (id: string) => `Planche inconnue : ${id}.`;
export const duplicateBed = (id: string) => `Planche en double : ${id}.`;
export const INVALID_CROP_ID = 'Culture sans nom.';
export const duplicateWish = (id: string) => `Culture demandée deux fois : ${id}.`;
export const invalidDate = (d: string) => `Date invalide : ${d}.`;
export const bedOverfilled = (id: string) => `Trop de cultures sur ${id}.`;
export const cropTwiceOnBed = (id: string) => `Une culture apparaît deux fois sur ${id}.`;

/**
 * A crop as the scorer reads it, resolved once. `wanted` is 0 for a crop added by hand. A `free`
 * crop is outside the catalog: no family, no companions, so no rotation or companion term.
 */
export type PlanCrop = { crop: Crop; sownOn: string; wanted: number; free: boolean; good: ReadonlySet<string>; bad: ReadonlySet<string> };
export type PlanBed = { id: string; label: string; history: NonNullable<CropPlanInput['beds'][number]['history']> };

/** Everything the scorer needs, ids replaced by indexes. */
export type PlanModel = {
  beds: PlanBed[];
  crops: PlanCrop[];
  catalog: Crop[];
  /** Neighbour bed indexes for each bed, sorted, without duplicates. */
  adjacency: number[][];
  /** Each neighbour pair once, lower index first, sorted. */
  edges: [number, number][];
  cropsPerBed: number;
  maxOptions: number;
  /** The plan date, used for crops placed by hand without a wish. */
  sownOn: string;
};

const isCount = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;

function resolveIds(catalog: Crop[], ids: readonly string[]): Set<string> {
  return new Set(ids.map((id) => getCrop(catalog, id)?.id ?? id));
}

function planCrop(catalog: Crop[], crop: Crop, sownOn: string, wanted: number): PlanCrop {
  return { crop, sownOn, wanted, free: false, good: resolveIds(catalog, crop.goodCompanions), bad: resolveIds(catalog, crop.badCompanions) };
}

function freeCrop(id: string, name: string | undefined, sownOn: string, wanted: number): PlanCrop {
  const crop: Crop = { id, name: name?.trim() || id, family: '', frostSensitive: false, goodCompanions: [], badCompanions: [] };
  return { crop, sownOn, wanted, free: true, good: new Set(), bad: new Set() };
}

const validId = (id: string) => id.trim().length > 0 && id.length <= MAX_CROP_ID_LENGTH;

/** The catalog crop for `id`, or a free-name crop when the catalog does not know it. */
function lookUp(catalog: Crop[], id: string, name: string | undefined, sownOn: string, wanted: number): PlanCrop {
  const crop = getCrop(catalog, id);
  return crop ? planCrop(catalog, crop, sownOn, wanted) : freeCrop(id, name, sownOn, wanted);
}

function readBeds(input: CropPlanInput): Result<PlanBed[]> {
  if (input.beds.length === 0) return fail(NO_BED);
  if (input.beds.length > MAX_BEDS) return fail(PLAN_TOO_LARGE);
  const seen = new Set<string>();
  const beds: PlanBed[] = [];
  for (const b of input.beds) {
    if (!b.id) return fail(BED_WITHOUT_ID);
    if (seen.has(b.id)) return fail(duplicateBed(b.id));
    seen.add(b.id);
    const history = b.history ?? [];
    if (history.length > MAX_HISTORY_PER_BED) return fail(PLAN_TOO_LARGE);
    const wrong = history.find((h) => !isValidCivilDate(h.sownOn) || (h.harvestedOn && !isValidCivilDate(h.harvestedOn)));
    if (wrong) return fail(invalidDate(isValidCivilDate(wrong.sownOn) ? String(wrong.harvestedOn) : wrong.sownOn));
    beds.push({ id: b.id, label: b.label || b.id, history });
  }
  return ok(beds);
}

function readWishes(input: CropPlanInput, catalog: Crop[]): Result<PlanCrop[]> {
  if (input.wishes.length === 0) return fail(NO_WISH);
  if (input.wishes.length > MAX_WISHES) return fail(PLAN_TOO_LARGE);
  const seen = new Set<string>();
  const crops: PlanCrop[] = [];
  let slots = 0;
  for (const w of input.wishes) {
    if (!validId(w.cropId) || (w.name !== undefined && w.name.length > MAX_CROP_ID_LENGTH)) return fail(INVALID_CROP_ID);
    const id = getCrop(catalog, w.cropId)?.id ?? w.cropId;
    if (seen.has(id)) return fail(duplicateWish(id));
    seen.add(id);
    const beds = w.beds ?? 1;
    if (!Number.isInteger(beds) || beds < 1) return fail(INVALID_BED_COUNT);
    slots += beds;
    if (slots > MAX_PLAN_SLOTS) return fail(PLAN_TOO_LARGE);
    const sownOn = w.sownOn ?? input.sownOn;
    if (!isValidCivilDate(sownOn)) return fail(invalidDate(sownOn));
    crops.push(lookUp(catalog, w.cropId, w.name, sownOn, beds));
  }
  return ok(crops);
}

function readNeighbours(input: CropPlanInput, beds: PlanBed[]): Result<[number, number][]> {
  const pairs = input.neighbours ?? [];
  if (pairs.length > MAX_NEIGHBOUR_PAIRS) return fail(PLAN_TOO_LARGE);
  const index = new Map(beds.map((b, i) => [b.id, i]));
  const keys = new Set<string>();
  const edges: [number, number][] = [];
  for (const [a, b] of pairs) {
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia === undefined) return fail(unknownBed(a));
    if (ib === undefined) return fail(unknownBed(b));
    if (ia === ib) return fail(SELF_NEIGHBOUR);
    const edge: [number, number] = ia < ib ? [ia, ib] : [ib, ia];
    const key = `${edge[0]},${edge[1]}`;
    if (keys.has(key)) continue;
    keys.add(key);
    edges.push(edge);
  }
  return ok(edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]));
}

/** Validates the input and builds the model; every refusal is a French sentence. */
export function readPlanInput(input: CropPlanInput): Result<PlanModel> {
  if (!isValidCivilDate(input.sownOn)) return fail(invalidDate(input.sownOn));
  const cropsPerBed = input.cropsPerBed ?? 1;
  if (!isCount(cropsPerBed, MAX_CROPS_PER_BED)) return fail(INVALID_CROPS_PER_BED);
  const maxOptions = input.maxOptions ?? 3;
  if (!isCount(maxOptions, 3)) return fail(INVALID_OPTIONS);
  const beds = readBeds(input);
  if (!beds.ok) return beds;
  const catalog = [...input.crops];
  const crops = readWishes(input, catalog);
  if (!crops.ok) return crops;
  const edges = readNeighbours(input, beds.value);
  if (!edges.ok) return edges;
  const adjacency: number[][] = beds.value.map(() => []);
  for (const [a, b] of edges.value) {
    adjacency[a]!.push(b);
    adjacency[b]!.push(a);
  }
  return ok({ beds: beds.value, crops: crops.value, catalog, adjacency, edges: edges.value, cropsPerBed, maxOptions, sownOn: input.sownOn });
}

/**
 * Turns a hand-edited plan into crop indexes per bed. Crops the owner placed without wishing them
 * join a copy of the model. Each bed's crops are sorted by crop index so one plan has one form.
 */
export function readAssignments(
  model: PlanModel,
  plan: readonly Pick<CropPlanAssignment, 'bedId' | 'cropIds'>[],
): Result<{ model: PlanModel; state: number[][] }> {
  const bedIndex = new Map(model.beds.map((b, i) => [b.id, i]));
  const crops = [...model.crops];
  const cropIndex = new Map(crops.map((c, i) => [c.crop.id, i]));
  const state: number[][] = model.beds.map(() => []);
  const seen = new Set<number>();
  for (const a of plan) {
    const b = bedIndex.get(a.bedId);
    if (b === undefined) return fail(unknownBed(a.bedId));
    if (seen.has(b)) return fail(duplicateBed(a.bedId));
    seen.add(b);
    if (a.cropIds.length > model.cropsPerBed) return fail(bedOverfilled(model.beds[b]!.label));
    for (const id of a.cropIds) {
      if (!validId(id)) return fail(INVALID_CROP_ID);
      const resolved = getCrop(model.catalog, id)?.id ?? id;
      let c = cropIndex.get(resolved);
      if (c === undefined) {
        c = crops.length;
        crops.push(lookUp(model.catalog, id, undefined, model.sownOn, 0));
        cropIndex.set(resolved, c);
      }
      if (state[b]!.includes(c)) return fail(cropTwiceOnBed(model.beds[b]!.label));
      state[b]!.push(c);
    }
  }
  return ok({ model: { ...model, crops }, state: state.map((list) => [...list].sort((x, y) => x - y)) });
}
