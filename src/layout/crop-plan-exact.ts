import { isShortCrop } from '../rotation.js';
import { CROP_PLAN_WEIGHTS } from './crop-plan-input.js';
import type { PlanScorer, PlanState } from './crop-plan-score.js';

/** Gardens up to this many beds get an exact search instead of local moves alone. */
export const MAX_EXACT_BEDS = 6;
/** ... and up to this many places (beds times crops per bed). */
export const MAX_EXACT_SLOTS = 12;
/**
 * Work units the exact search may spend: one per crop read while bounding or scoring a branch.
 * Once spent, the best plan found so far is kept and the plan says `approx: true`.
 */
export const MAX_EXACT_WORK = 150_000_000;

const GOOD = CROP_PLAN_WEIGHTS.goodCompanions.value;
const UNPLACED = CROP_PLAN_WEIGHTS.unplacedBed.value;

export const exactFits = (beds: number, cropsPerBed: number) => beds <= MAX_EXACT_BEDS && beds * cropsPerBed <= MAX_EXACT_SLOTS;

/** Most places a plan can fill: each crop on at most its wished beds, never twice on one bed. */
export function mostPlaced(scorer: PlanScorer): number {
  const { beds, crops, cropsPerBed } = scorer.model;
  const wanted = crops.reduce((s, c) => s + Math.min(c.wanted, beds.length), 0);
  return Math.min(beds.length * cropsPerBed, wanted);
}

export type ExactResult = { state: PlanState; total: number; complete: boolean; work: number };

/**
 * Branch and bound over every plan that fills the most places, bed by bed: at most `cropsPerBed`
 * crops on a bed, a crop once per bed and on no more beds than wished, and no bed left empty while
 * another holds two crops. With that many places the unplaced term is the same for every plan, so
 * only rotation, families and companions decide. A branch is cut when even its optimistic bound
 * (rotation exact, every possible good pair counted, no bad pair, no family cost) cannot beat the
 * best plan so far. Starts from `incumbent` and only keeps a strictly better plan, so ties keep the
 * local search's answer. Deterministic.
 */
export function exactSearch(scorer: PlanScorer, incumbent: PlanState, incumbentTotal: number, budgetUnits = MAX_EXACT_WORK): ExactResult {
  const { model } = scorer;
  const B = model.beds.length;
  const n = model.crops.length;
  const P = mostPlaced(scorer);
  const lo = P >= B ? 1 : 0;
  const hi = P >= B ? model.cropsPerBed : 1;
  const totalWanted = model.crops.reduce((s, c) => s + c.wanted, 0);
  const constant = (totalWanted - P) * UNPLACED;

  const rot: number[][] = model.beds.map((_, b) => model.crops.map((_, c) => (scorer.rotationOf(b, c) ? CROP_PLAN_WEIGHTS.rotationConflict.value : 0)));
  const left = model.crops.map((c) => Math.min(c.wanted, B));
  const state: PlanState = model.beds.map(() => []);
  let best = { state: incumbent, total: incumbentTotal };
  let budget = budgetUnits;
  let complete = true;

  /** Good pairs of wished crops, each with its points: a pair of single crops scores once at most. */
  const goodPairs: [number, number, number][] = [];
  for (let c = 0; c < n; c++) for (let d = c + 1; d < n; d++) if (scorer.relationOf(c, d) > 0) goodPairs.push([c, d, scorer.relationOf(c, d)]);
  const twin = twins(scorer, rot);

  /**
   * Optimistic points of beds from..B-1, given the beds before `from` as they are in `state`.
   * Per bed: the best crops by rotation plus good pairs with the beds already filled. Pairs among
   * the beds still empty: the smaller of two bounds, each place's share of the good pairs it can
   * still reach (partners with copies left), and every good pair of crops still left counted as often as their copies allow.
   */
  const bound = (from: number): number => {
    const partners = new Array<number>(n).fill(0);
    for (const [c, d] of goodPairs) {
      if (left[c]! > 0) partners[d]! += left[c]!;
      if (left[d]! > 0) partners[c]! += left[d]!;
    }
    let sum = 0;
    let shares = 0;
    const values: number[] = [];
    const halves: number[] = [];
    for (let v = from; v < B; v++) {
      let around = hi - 1;
      let filled = 0;
      for (const w of model.adjacency[v]!) {
        if (w >= from) around += hi;
        else filled += state[w]!.length;
      }
      values.length = 0;
      halves.length = 0;
      for (let c = 0; c < n; c++) {
        if (left[c] === 0) continue;
        let cross = 0;
        for (const u of model.adjacency[v]!) if (u < from) for (const d of state[u]!) if (d !== c) cross += Math.max(0, scorer.relationOf(c, d));
        values.push(rot[v]![c]! + cross);
        halves.push(0.5 * GOOD * Math.min(around, partners[c]!));
      }
      budget -= n * (2 + filled) + 1;
      if (values.length < lo) return -Infinity;
      values.sort((x, y) => y - x);
      halves.sort((x, y) => y - x);
      for (let k = 0; k < Math.min(hi, values.length); k++) {
        if (k < lo || values[k]! > 0) sum += values[k]!;
        shares += halves[k]!;
      }
    }
    let pairs = 0;
    for (const [c, d, points] of goodPairs) pairs += points * Math.min(left[c]!, left[d]!);
    budget -= 2 * goodPairs.length + n;
    return sum + Math.min(shares, pairs);
  };

  /** Free places still fillable on beds from..B-1 with the crops left. */
  const fillable = (from: number) => {
    const beds = B - from;
    let room = 0;
    for (let c = 0; c < n; c++) room += Math.min(left[c]!, beds);
    return Math.min(room, beds * hi);
  };

  const visit = (b: number, slots: number, points: number): void => {
    if (budget <= 0) {
      complete = false;
      return;
    }
    if (b === B) {
      if (slots === 0 && points + constant > best.total) best = { state: state.map((l) => [...l]), total: points + constant };
      return;
    }
    if (fillable(b) < slots) return;
    if (points + bound(b) + constant <= best.total) return;
    const after = B - b - 1;
    for (let k = Math.min(hi, slots); k >= lo; k--) {
      const rest = slots - k;
      if (rest < after * lo || rest > after * hi) continue;
      choose(b, k, 0, [], slots, points);
      if (budget <= 0) return;
    }
  };

  /** Every set of `k` crops for bed `b`, in crop order, each followed by the next beds. */
  const choose = (b: number, k: number, start: number, picked: number[], slots: number, points: number): void => {
    if (picked.length === k) {
      state[b] = picked;
      let gain = scorer.bedPoints(b, picked);
      for (const u of model.adjacency[b]!) if (u < b) gain += scorer.edgePoints(picked, state[u]!);
      budget -= 1 + k * (1 + model.adjacency[b]!.length * hi);
      visit(b + 1, slots - k, points + gain);
      state[b] = [];
      return;
    }
    for (let c = start; c <= n - (k - picked.length); c++) {
      if (left[c] === 0 || (twin[c]! >= 0 && left[twin[c]!]! > 0)) continue;
      left[c]!--;
      choose(b, k, c + 1, [...picked, c], slots, points);
      left[c]!++;
      if (budget <= 0) {
        complete = false;
        return;
      }
    }
  };

  visit(0, P, 0);
  return { state: best.state, total: best.total, complete, work: budgetUnits - budget };
}

/**
 * For each crop wished on one bed, the nearest earlier crop it can trade places with in any plan
 * without changing the score (same wish count, same rotation on every bed, same family role, same
 * relation to every other crop), or -1. The search places such a crop only after its twin, which
 * skips plans that only differ by trading the two.
 */
function twins(scorer: PlanScorer, rot: readonly (readonly number[])[]): number[] {
  const { crops } = scorer.model;
  const role = (c: number) => {
    const { crop, free } = crops[c]!;
    return free ? '' : isShortCrop(crop) ? '*' : crop.family;
  };
  const same = (c: number, d: number) => {
    if (crops[c]!.wanted !== 1 || crops[d]!.wanted !== 1 || role(c) !== role(d)) return false;
    if (rot.some((row) => row[c] !== row[d])) return false;
    for (let x = 0; x < crops.length; x++) if (x !== c && x !== d && scorer.relationOf(c, x) !== scorer.relationOf(d, x)) return false;
    return true;
  };
  return crops.map((_, d) => {
    for (let c = d - 1; c >= 0; c--) if (same(c, d)) return c;
    return -1;
  });
}
