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

/** Move passes are cut here; each pass that changes something raises the integer score. */
const MAX_MOVE_PASSES = 50;
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

/**
 * Work units the moves of one option may spend: one unit per crop pair or rotation term read.
 * It bounds run time whatever the neighbours look like (one bed may touch every other one); once
 * it is spent the best plan so far is kept. Plans of normal size converge long before it.
 */
export const MAX_IMPROVE_WORK = 30_000_000;

type Budget = { left: number };

/** Pair terms a score of `beds` and their neighbours reads, charged twice (before and after the move). */
function charge(scorer: PlanScorer, budget: Budget, state: PlanState, beds: readonly number[]): boolean {
  if (budget.left <= 0) return false;
  let terms = 0;
  for (const b of beds) {
    let around = state[b]!.length;
    for (const v of scorer.model.adjacency[b]!) around += state[v]!.length;
    terms += 1 + state[b]!.length * around;
  }
  budget.left -= 2 * terms;
  return true;
}

const sorted = (list: readonly number[]) => [...list].sort((x, y) => x - y);

/** Lists are scored in any order, so a move is tried in place and only sorted once kept. */
function trySwap(scorer: PlanScorer, budget: Budget, state: PlanState, a: number, i: number, b: number, j: number): boolean {
  budget.left--;
  const listA = state[a]!;
  const listB = state[b]!;
  const ca = listA[i]!;
  const cb = listB[j]!;
  if (ca === cb || listA.includes(cb) || listB.includes(ca)) return false;
  if (!charge(scorer, budget, state, [a, b])) return false;
  const before = scorer.localPoints(state, a, b);
  listA[i] = cb;
  listB[j] = ca;
  if (scorer.localPoints(state, a, b) > before) {
    state[a] = sorted(listA);
    state[b] = sorted(listB);
    return true;
  }
  listA[i] = ca;
  listB[j] = cb;
  return false;
}

/**
 * Gives the place of crop `i` on bed `a` to crop `c`, which still misses beds. Each crop is wished
 * at least as often as it is placed, so the unplaced term does not move (one slot out, one in):
 * only the terms of bed `a` decide.
 */
function tryReplace(scorer: PlanScorer, budget: Budget, state: PlanState, missing: number[], a: number, i: number, c: number): boolean {
  budget.left--;
  const list = state[a]!;
  const out = list[i]!;
  if (missing[c]! === 0 || list.includes(c)) return false;
  if (!charge(scorer, budget, state, [a])) return false;
  const before = scorer.bedLocalPoints(state, a);
  list[i] = c;
  if (scorer.bedLocalPoints(state, a) > before) {
    state[a] = sorted(list);
    missing[c]!--;
    missing[out]!++;
    return true;
  }
  list[i] = out;
  return false;
}

function swapPass(scorer: PlanScorer, budget: Budget, state: PlanState): boolean {
  let changed = false;
  for (let a = 0; a < state.length && budget.left > 0; a++)
    for (let b = a + 1; b < state.length; b++)
      for (let i = 0; i < state[a]!.length; i++)
        for (let j = 0; j < state[b]!.length; j++) if (trySwap(scorer, budget, state, a, i, b, j)) changed = true;
  return changed;
}

function replacePass(scorer: PlanScorer, budget: Budget, state: PlanState): boolean {
  const missing = scorer.missing(state);
  let changed = false;
  for (let a = 0; a < state.length && budget.left > 0; a++)
    for (let i = 0; i < state[a]!.length; i++)
      for (let c = 0; c < missing.length; c++) if (tryReplace(scorer, budget, state, missing, a, i, c)) changed = true;
  return changed;
}

/**
 * Exchanges two placed crops between two beds, or gives a placed crop's place to a wished crop
 * left out, while that raises the score, until no move does or the work budget is spent.
 */
function improve(scorer: PlanScorer, start: PlanState): { state: PlanState; work: number } {
  const state = start.map((list) => [...list]);
  const budget: Budget = { left: MAX_IMPROVE_WORK };
  for (let pass = 0; pass < MAX_MOVE_PASSES && budget.left > 0; pass++) {
    const replaced = replacePass(scorer, budget, state);
    const swapped = swapPass(scorer, budget, state);
    if (!replaced && !swapped) break;
  }
  return { state, work: MAX_IMPROVE_WORK - budget.left };
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

function solve(model: PlanModel): { plan: CropPlan; work: number[] } {
  const scorer = new PlanScorer(model);
  const seen = new Set<string>();
  const options: CropPlanOption[] = [];
  const work: number[] = [];
  for (const strategy of STRATEGIES) {
    const improved = improve(scorer, greedy(scorer, orderFor(strategy, scorer)));
    const { state } = improved;
    work.push(improved.work);
    const key = JSON.stringify(state);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(toOption(scorer, strategy, state));
  }
  const ranked = options
    .map((o, i) => ({ o, i }))
    .sort((x, y) => y.o.score.total - x.o.score.total || x.i - y.i)
    .map((x) => x.o);
  const withoutData = model.crops
    .filter((c) => c.free)
    .map(({ crop }) => ({ cropId: crop.id, name: crop.name, text: `${crop.name} : pas de donnée, placé sans rotation ni compagnonnage.` }));
  return { plan: { options: ranked.slice(0, model.maxOptions), params: { ...CROP_PLAN_WEIGHTS }, withoutData }, work };
}

/** `solveCropPlan` plus the work units each strategy's moves spent, for tests. Not exported from the package root. */
export function solveCropPlanWithWork(input: CropPlanInput): Result<{ plan: CropPlan; work: number[] }> {
  const model = readPlanInput(input);
  return model.ok ? ok(solve(model.value)) : model;
}

/**
 * First crop plan for free beds: a greedy placement of the wished crops followed by swaps and
 * replacements within a fixed work budget, scored on rotation history, companions (same bed and neighbouring beds) and families
 * sharing a bed. Up to three distinct options, each with a French score breakdown. Rotation is
 * advice, never a ban: a crop is placed even when every bed breaks it. Pure and deterministic.
 */
export function solveCropPlan(input: CropPlanInput): Result<CropPlan> {
  const solved = solveCropPlanWithWork(input);
  return solved.ok ? ok(solved.value.plan) : solved;
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
