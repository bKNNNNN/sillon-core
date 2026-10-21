import { FAMILY_LABELS, isShortCrop, rotationAdvice, type RotationAdvice } from '../rotation.js';
import { CROP_PLAN_WEIGHTS, type PlanModel } from './crop-plan-input.js';
import type { ScoreBreakdown, ScoreItem } from './crop-plan-types.js';

/** Crop indexes per bed index, each list sorted. */
export type PlanState = number[][];

const W = {
  rotation: CROP_PLAN_WEIGHTS.rotationConflict.value,
  good: CROP_PLAN_WEIGHTS.goodCompanions.value,
  bad: CROP_PLAN_WEIGHTS.badCompanions.value,
  family: CROP_PLAN_WEIGHTS.extraFamily.value,
  unplaced: CROP_PLAN_WEIGHTS.unplacedBed.value,
};

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Scores plans on one model. Rotation advice and companion relations are computed once per pair
 * and kept, so the solver can try thousands of placements cheaply.
 */
export class PlanScorer {
  /** Per bed and crop: 0 not computed yet, 1 no conflict, 2 conflict (advice kept in `advice`). */
  private readonly rotation: Uint8Array;
  private readonly advice = new Map<number, RotationAdvice>();
  /** Per crop pair: points plus 128, 255 when not computed yet. */
  private readonly relation: Uint8Array;
  private readonly cropCount: number;

  constructor(readonly model: PlanModel) {
    this.cropCount = model.crops.length;
    this.rotation = new Uint8Array(model.beds.length * this.cropCount);
    this.relation = new Uint8Array(this.cropCount * this.cropCount).fill(255);
  }

  rotationOf(bed: number, crop: number): RotationAdvice | null {
    const key = bed * this.cropCount + crop;
    if (this.rotation[key] === 0) {
      const c = this.model.crops[crop]!;
      const found = rotationAdvice([...this.model.beds[bed]!.history], c.crop.id, c.sownOn, this.model.catalog);
      if (found) this.advice.set(key, found);
      this.rotation[key] = found ? 2 : 1;
    }
    return this.rotation[key] === 2 ? this.advice.get(key)! : null;
  }

  /** Points between two different crops: a bad pair in either list wins over a good one. */
  relationOf(a: number, b: number): number {
    const key = a * this.cropCount + b;
    const known = this.relation[key]!;
    if (known !== 255) return known - 128;
    const x = this.model.crops[a]!;
    const y = this.model.crops[b]!;
    let points = 0;
    if (x.bad.has(y.crop.id) || y.bad.has(x.crop.id)) points = W.bad;
    else if (x.good.has(y.crop.id) || y.good.has(x.crop.id)) points = W.good;
    this.relation[key] = points + 128;
    this.relation[b * this.cropCount + a] = points + 128;
    return points;
  }

  /** Families on the bed beyond the first; short crops slip between others and free crops have none. */
  extraFamilies(list: readonly number[]): number {
    if (list.length < 2) return 0;
    const counted = list.map((c) => this.model.crops[c]!).filter((c) => !c.free && !isShortCrop(c.crop));
    const families = new Set(counted.map((c) => c.crop.family));
    return Math.max(0, families.size - 1);
  }

  /** Rotation, families and same-bed companions of one bed holding `list`. */
  bedPoints(bed: number, list: readonly number[]): number {
    let points = this.extraFamilies(list) * W.family;
    for (let i = 0; i < list.length; i++) {
      if (this.rotationOf(bed, list[i]!)) points += W.rotation;
      for (let j = i + 1; j < list.length; j++) points += this.relationOf(list[i]!, list[j]!);
    }
    return points;
  }

  /** Companions across two neighbouring beds. The same crop on both counts nothing. */
  edgePoints(u: readonly number[], v: readonly number[]): number {
    let points = 0;
    for (const c of u) for (const d of v) if (c !== d) points += this.relationOf(c, d);
    return points;
  }

  /** Every term that involves bed `a` or bed `b`: what a swap between them can change. */
  localPoints(state: PlanState, a: number, b: number): number {
    let points = this.bedPoints(a, state[a]!) + this.bedPoints(b, state[b]!);
    for (const v of this.model.adjacency[a]!) points += this.edgePoints(state[a]!, state[v]!);
    for (const v of this.model.adjacency[b]!) if (v !== a) points += this.edgePoints(state[b]!, state[v]!);
    return points;
  }

  /** Points gained by adding `crop` to `bed`. */
  placeGain(state: PlanState, bed: number, crop: number): number {
    const list = state[bed]!;
    let gain = this.bedPoints(bed, [...list, crop]) - this.bedPoints(bed, list);
    for (const v of this.model.adjacency[bed]!) for (const d of state[v]!) if (d !== crop) gain += this.relationOf(crop, d);
    return gain;
  }

  /** Wished beds left without a place, per crop index. */
  missing(state: PlanState): number[] {
    const placed = this.model.crops.map(() => 0);
    for (const list of state) for (const c of list) placed[c]!++;
    return this.model.crops.map((c, i) => Math.max(0, c.wanted - placed[i]!));
  }

  breakdown(state: PlanState): ScoreBreakdown {
    const items = [...this.rotationItems(state), ...this.companionItems(state), ...this.familyItems(state), ...this.unplacedItems(state)];
    const sum = (kind: ScoreItem['kind']) => items.filter((i) => i.kind === kind).reduce((s, i) => s + i.points, 0);
    const parts = { rotation: sum('rotation'), companions: sum('companions'), families: sum('families'), unplaced: sum('unplaced') };
    return { total: parts.rotation + parts.companions + parts.families + parts.unplaced, ...parts, items };
  }

  private name(c: number): string {
    return this.model.crops[c]!.crop.name;
  }

  private rotationItems(state: PlanState): ScoreItem[] {
    return state.flatMap((list, b) =>
      list.flatMap((c) => {
        const advice = this.rotationOf(b, c);
        if (!advice) return [];
        const family = (FAMILY_LABELS[advice.family] ?? advice.family).toLowerCase();
        const text = `${this.name(c)} sur ${this.model.beds[b]!.label} : déjà des ${family} en ${advice.lastYear}, mieux vaut ${advice.rotationYears} ans entre deux.`;
        return [{ kind: 'rotation' as const, points: W.rotation, bedIds: [this.model.beds[b]!.id], cropIds: [this.model.crops[c]!.crop.id], text }];
      }),
    );
  }

  private companionItem(c: number, d: number, beds: number[]): ScoreItem[] {
    const points = this.relationOf(c, d);
    if (points === 0) return [];
    const labels = beds.map((b) => this.model.beds[b]!.label);
    const where = labels.length === 1 ? labels[0] : `${labels[0]} à côté de ${labels[1]}`;
    const pair = `${this.name(c)} et ${this.name(d)}`;
    const text = points > 0 ? `${pair} vont bien ensemble (${where}).` : `${pair} se gênent (${where}) : éloigne-les si tu peux.`;
    return [
      {
        kind: 'companions',
        points,
        bedIds: beds.map((b) => this.model.beds[b]!.id),
        cropIds: [this.model.crops[c]!.crop.id, this.model.crops[d]!.crop.id],
        text,
      },
    ];
  }

  /** Same-bed pairs of each bed, then the pairs across each neighbour edge, in bed order. */
  private companionItems(state: PlanState): ScoreItem[] {
    const items: { first: number; second: number; item: ScoreItem }[] = [];
    state.forEach((list, b) =>
      list.forEach((c, i) => list.slice(i + 1).forEach((d) => this.companionItem(c, d, [b]).forEach((item) => items.push({ first: b, second: b, item })))),
    );
    for (const [u, v] of this.model.edges)
      for (const c of state[u]!) for (const d of state[v]!) if (c !== d) this.companionItem(c, d, [u, v]).forEach((item) => items.push({ first: u, second: v, item }));
    return items.sort((x, y) => x.first - y.first || x.second - y.second).map((x) => x.item);
  }

  private familyItems(state: PlanState): ScoreItem[] {
    return state.flatMap((list, b) => {
      const extra = this.extraFamilies(list);
      if (extra === 0) return [];
      const bed = this.model.beds[b]!;
      const text = `${bed.label} mélange ${extra + 1} familles : la rotation sera plus dure à suivre.`;
      return [{ kind: 'families' as const, points: extra * W.family, bedIds: [bed.id], cropIds: list.map((c) => this.model.crops[c]!.crop.id), text }];
    });
  }

  private unplacedItems(state: PlanState): ScoreItem[] {
    return this.missing(state).flatMap((n, c) => {
      if (n === 0) return [];
      const text = `${this.name(c)} : il manque ${plural(n, 'emplacement')}.`;
      return [{ kind: 'unplaced' as const, points: n * W.unplaced, bedIds: [], cropIds: [this.model.crops[c]!.crop.id], text }];
    });
  }
}
