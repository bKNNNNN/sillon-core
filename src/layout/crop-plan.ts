import { ok, type Result } from '../result.js';
import { CROP_PLAN_WEIGHTS, readAssignments, readPlanInput, type PlanModel } from './crop-plan-input.js';
import { PlanScorer, type PlanState } from './crop-plan-score.js';
import type {
  CropPlan,
  CropPlanAssignment,
  CropPlanInput,
  CropPlanOption,
  CropPlanStrategy,
  ScoreBreakdown,
} from './crop-plan-types.js';

/** Swap passes are cut here; each pass that changes something raises the integer score. */
const MAX_SWAP_PASSES = 50;
const STRATEGIES: readonly CropPlanStrategy[] = ['priority', 'constrained', 'companions'];

const byKeyDesc = (key: (c: number) => number) => (a: number, b: number) => key(b) - key(a) || a - b;

/** Wish indexes in the order each strategy places them. Ties keep the owner's order. */
function orderFor(strategy: CropPlanStrategy, scorer: PlanScorer): number[] {
  const { model } = scorer;
  const wishes = model.crops.map((_, i) => i);
  if (strategy === 'priority') return wishes;
  if (strategy === 'constrained') {
    const conflicts = wishes.map((c) => model.beds.filter((_, b) => scorer.rotationOf(b, c)).length);
    return [...wishes].sort(byKeyDesc((c) => conflicts[c]!));
  }
  const degree = wishes.map((c) => wishes.filter((d) => d !== c && scorer.relationOf(c, d) !== 0).length);
  return [...wishes].sort(byKeyDesc((c) => degree[c]!));
}

/**
 * Places each wished bed in turn. Only the least loaded beds that do not hold the crop yet are
 * candidates, so every bed gets a crop before one is shared; among them the best gain wins, then
 * the first bed. Placing a crop's beds one after the other this way never strands a placeable bed.
 */
function greedy(scorer: PlanScorer, order: readonly number[]): PlanState {
  const { model } = scorer;
  const state: PlanState = model.beds.map(() => []);
  for (const c of order) {
    for (let k = 0; k < model.crops[c]!.wanted; k++) {
      let best = -1;
      let bestLoad = Infinity;
      let bestGain = -Infinity;
      state.forEach((list, b) => {
        if (list.length >= model.cropsPerBed || list.includes(c) || list.length > bestLoad) return;
        const gain = scorer.placeGain(state, b, c);
        if (list.length < bestLoad || gain > bestGain) {
          best = b;
          bestLoad = list.length;
          bestGain = gain;
        }
      });
      if (best < 0) break;
      state[best] = [...state[best]!, c].sort((x, y) => x - y);
    }
  }
  return state;
}

function trySwap(scorer: PlanScorer, state: PlanState, a: number, i: number, b: number, j: number): boolean {
  const ca = state[a]![i]!;
  const cb = state[b]![j]!;
  if (ca === cb || state[a]!.includes(cb) || state[b]!.includes(ca)) return false;
  const before = scorer.localPoints(state, a, b);
  const oldA = state[a]!;
  const oldB = state[b]!;
  state[a] = oldA.map((c) => (c === ca ? cb : c)).sort((x, y) => x - y);
  state[b] = oldB.map((c) => (c === cb ? ca : c)).sort((x, y) => x - y);
  if (scorer.localPoints(state, a, b) > before) return true;
  state[a] = oldA;
  state[b] = oldB;
  return false;
}

/** Exchanges two crops between two beds while that raises the score, until no exchange does. */
function improve(scorer: PlanScorer, start: PlanState): PlanState {
  const state = start.map((list) => [...list]);
  for (let pass = 0; pass < MAX_SWAP_PASSES; pass++) {
    let changed = false;
    for (let a = 0; a < state.length; a++)
      for (let b = a + 1; b < state.length; b++)
        for (let i = 0; i < state[a]!.length; i++)
          for (let j = 0; j < state[b]!.length; j++) if (trySwap(scorer, state, a, i, b, j)) changed = true;
    if (!changed) break;
  }
  return state;
}

function toOption(scorer: PlanScorer, strategy: CropPlanStrategy, state: PlanState): CropPlanOption {
  const { model } = scorer;
  const assignments: CropPlanAssignment[] = model.beds.map((bed, b) => ({
    bedId: bed.id,
    label: bed.label,
    cropIds: state[b]!.map((c) => model.crops[c]!.crop.id),
  }));
  const unplaced = scorer
    .missing(state)
    .flatMap((n, c) => (n > 0 ? [{ cropId: model.crops[c]!.crop.id, name: model.crops[c]!.crop.name, beds: n }] : []));
  return { strategy, assignments, unplaced, score: scorer.breakdown(state) };
}

function solve(model: PlanModel): CropPlan {
  const scorer = new PlanScorer(model);
  const seen = new Set<string>();
  const options: CropPlanOption[] = [];
  for (const strategy of STRATEGIES) {
    const state = improve(scorer, greedy(scorer, orderFor(strategy, scorer)));
    const key = JSON.stringify(state);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(toOption(scorer, strategy, state));
  }
  const ranked = options
    .map((o, i) => ({ o, i }))
    .sort((x, y) => y.o.score.total - x.o.score.total || x.i - y.i)
    .map((x) => x.o);
  return { options: ranked.slice(0, model.maxOptions), params: { ...CROP_PLAN_WEIGHTS } };
}

/**
 * First crop plan for free beds: a greedy placement of the wished crops followed by pairwise
 * swaps, scored on rotation history, companions (same bed and neighbouring beds) and families
 * sharing a bed. Up to three distinct options, each with a French score breakdown. Rotation is
 * advice, never a ban: a crop is placed even when every bed breaks it. Pure and deterministic.
 */
export function solveCropPlan(input: CropPlanInput): Result<CropPlan> {
  const model = readPlanInput(input);
  return model.ok ? ok(solve(model.value)) : model;
}

/** Scores a plan the owner edited by hand, with the solver's rules; crops he added unasked are scored too. */
export function scoreCropPlan(
  input: CropPlanInput,
  plan: readonly Pick<CropPlanAssignment, 'bedId' | 'cropIds'>[],
): Result<ScoreBreakdown> {
  const model = readPlanInput(input);
  if (!model.ok) return model;
  const read = readAssignments(model.value, plan);
  if (!read.ok) return read;
  return ok(new PlanScorer(read.value.model).breakdown(read.value.state));
}
