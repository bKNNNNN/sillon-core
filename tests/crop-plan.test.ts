import { describe, expect, it } from 'vitest';
import {
  CROP_PLAN_WEIGHTS,
  scoreCropPlan,
  solveCropPlan,
  type CropPlanBed,
  type CropPlanInput,
} from '../src/index.js';
import { beds, byBed, catalog, line, plan, value } from './crop-plan-fixtures.js';

const W = {
  rotation: CROP_PLAN_WEIGHTS.rotationConflict.value,
  good: CROP_PLAN_WEIGHTS.goodCompanions.value,
  bad: CROP_PLAN_WEIGHTS.badCompanions.value,
  family: CROP_PLAN_WEIGHTS.extraFamily.value,
  unplaced: CROP_PLAN_WEIGHTS.unplacedBed.value,
};

describe('solveCropPlan: rotation history', () => {
  const history: CropPlanBed[] = [
    { id: 'a', label: 'Carré 1', history: [{ species: 'tomate', sownOn: '2025-04-20', status: 'done', harvestedOn: '2025-09-30' }] },
    { id: 'b', label: 'Carré 2', history: [{ species: 'carotte', sownOn: '2025-03-15' }] },
  ];

  it('moves each family off the bed it grew on last season', () => {
    const [best] = plan({ beds: history, wishes: [{ cropId: 'tomate' }, { cropId: 'carotte' }] }).options;
    expect(byBed(best!)).toEqual({ a: ['carotte'], b: ['tomate'] });
    expect(best!.score.rotation).toBe(0);
  });

  it('places a crop anyway when every bed breaks the rotation, and says why', () => {
    const [best] = plan({ beds: [history[0]!], wishes: [{ cropId: 'pomme-de-terre' }] }).options;
    expect(byBed(best!)).toEqual({ a: ['pomme-de-terre'] });
    expect(best!.score.rotation).toBe(W.rotation);
    expect(best!.score.items).toEqual([
      {
        kind: 'rotation',
        points: W.rotation,
        bedIds: ['a'],
        cropIds: ['pomme-de-terre'],
        text: 'Pomme de terre sur Carré 1 : déjà des solanacées en 2025, mieux vaut 4 ans entre deux.',
      },
    ]);
  });

  it('never counts short crops against a bed (radish after cabbage)', () => {
    const bed: CropPlanBed = { id: 'a', history: [{ species: 'chou', sownOn: '2025-03-01' }] };
    const [best] = plan({ beds: [bed], wishes: [{ cropId: 'radis' }] }).options;
    expect(best!.score.total).toBe(0);
  });

  it('reads the season of the wish own sowing date', () => {
    const bed: CropPlanBed = { id: 'a', history: [{ species: 'tomate', sownOn: '2022-04-01' }] };
    const late = plan({ beds: [bed], wishes: [{ cropId: 'tomate', sownOn: '2026-04-01' }] }).options[0]!;
    const soon = plan({ beds: [bed], wishes: [{ cropId: 'tomate', sownOn: '2025-04-01' }] }).options[0]!;
    expect(late.score.rotation).toBe(0);
    expect(soon.score.rotation).toBe(W.rotation);
  });
});

describe('solveCropPlan: companions', () => {
  const row = beds(3);

  it('keeps bad neighbours apart and good ones together across neighbouring beds', () => {
    const [best] = plan({
      beds: row,
      neighbours: line(row),
      wishes: [{ cropId: 'pomme-de-terre' }, { cropId: 'tomate' }, { cropId: 'basilic' }],
    }).options;
    const at = byBed(best!);
    expect(at['planche-2']).toEqual(['basilic']);
    expect(best!.score.companions).toBe(W.good);
    expect(best!.score.items).toEqual([
      expect.objectContaining({
        kind: 'companions',
        points: W.good,
        text: expect.stringMatching(/^(Tomate et Basilic|Basilic et Tomate) vont bien ensemble \(Planche \d à côté de Planche \d\)\.$/),
      }),
    ]);
  });

  it('says when bad companions could not be kept apart', () => {
    const two = beds(2);
    const [best] = plan({ beds: two, neighbours: line(two), wishes: [{ cropId: 'tomate' }, { cropId: 'pomme-de-terre' }] }).options;
    expect(best!.score.companions).toBe(W.bad);
    expect(best!.score.items[0]!.text).toBe('Tomate et Pomme de terre se gênent (Planche 1 à côté de Planche 2) : éloigne-les si tu peux.');
  });

  it('ignores beds that are not neighbours', () => {
    const [best] = plan({ beds: beds(2), wishes: [{ cropId: 'tomate' }, { cropId: 'pomme-de-terre' }] }).options;
    expect(best!.score.total).toBe(0);
  });

  it('resolves aliases in companion lists and wishes', () => {
    const [best] = plan({ beds: beds(1), cropsPerBed: 2, wishes: [{ cropId: 'chou' }, { cropId: 'celeri' }] }).options;
    expect(byBed(best!)).toEqual({ 'planche-1': ['chou-ete', 'celeri'] });
    expect(best!.score.companions).toBe(W.good);
    expect(best!.score.items[0]!.text).toBe("Chou d'été et Céleri vont bien ensemble (Planche 1).");
  });
});

describe('solveCropPlan: shared beds and families', () => {
  it('fills every bed with one crop before sharing one', () => {
    const [best] = plan({ beds: beds(3), cropsPerBed: 2, wishes: [{ cropId: 'tomate' }, { cropId: 'basilic' }, { cropId: 'carotte' }] }).options;
    expect(best!.assignments.every((a) => a.cropIds.length === 1)).toBe(true);
  });

  it('groups each family on one bed so the rotation stays simple', () => {
    const [best] = plan({
      beds: beds(2),
      cropsPerBed: 2,
      wishes: [{ cropId: 'tomate' }, { cropId: 'carotte' }, { cropId: 'aubergine' }, { cropId: 'panais' }],
    }).options;
    const sets = best!.assignments.map((a) => [...a.cropIds].sort().join('+')).sort();
    expect(sets).toEqual(['aubergine+tomate', 'carotte+panais']);
    expect(best!.score.families).toBe(0);
  });

  it('counts each extra family on a bed', () => {
    const score = value(
      scoreCropPlan(
        { beds: beds(1), crops: catalog, sownOn: '2026-04-01', cropsPerBed: 3, wishes: [{ cropId: 'tomate' }, { cropId: 'carotte' }, { cropId: 'poireau' }] },
        [{ bedId: 'planche-1', cropIds: ['tomate', 'carotte', 'poireau'] }],
      ),
    );
    expect(score.families).toBe(2 * W.family);
    expect(score.items.find((i) => i.kind === 'families')!.text).toBe('Planche 1 mélange 3 familles : la rotation sera plus dure à suivre.');
  });

  it('does not count a short crop as a family of its own', () => {
    const score = value(
      scoreCropPlan(
        { beds: beds(1), crops: catalog, sownOn: '2026-04-01', cropsPerBed: 2, wishes: [{ cropId: 'carotte' }, { cropId: 'radis' }] },
        [{ bedId: 'planche-1', cropIds: ['carotte', 'radis'] }],
      ),
    );
    expect(score.families).toBe(0);
  });
});

describe('solveCropPlan: not enough room', () => {
  it('lists what does not fit', () => {
    const [best] = plan({ beds: beds(1), wishes: [{ cropId: 'tomate' }, { cropId: 'courge', beds: 2 }] }).options;
    expect(best!.unplaced).toEqual([{ cropId: 'courge', name: 'Courge', beds: 2 }]);
    expect(best!.score.unplaced).toBe(2 * W.unplaced);
    expect(best!.score.items.at(-1)!.text).toBe('Courge : il manque 2 emplacements.');
  });

  it('never puts one crop twice on the same bed', () => {
    const [best] = plan({ beds: beds(1), cropsPerBed: 2, wishes: [{ cropId: 'tomate', beds: 2 }] }).options;
    expect(byBed(best!)).toEqual({ 'planche-1': ['tomate'] });
    expect(best!.unplaced).toEqual([{ cropId: 'tomate', name: 'Tomate', beds: 1 }]);
    expect(best!.score.items.at(-1)!.text).toBe('Tomate : il manque 1 emplacement.');
  });

  it('keeps every bed in the answer, free ones empty', () => {
    const [best] = plan({ beds: beds(3), wishes: [{ cropId: 'tomate' }] }).options;
    expect(best!.assignments.map((a) => [a.label, a.cropIds.length])).toEqual([
      ['Planche 1', 1],
      ['Planche 2', 0],
      ['Planche 3', 0],
    ]);
  });
});

describe('solveCropPlan: options', () => {
  const row = beds(4);
  const input = {
    beds: row,
    neighbours: line(row),
    wishes: [{ cropId: 'pomme-de-terre' }, { cropId: 'courge' }, { cropId: 'haricot' }, { cropId: 'tomate' }],
  };

  it('returns at most three distinct options, best first', () => {
    const { options } = plan(input);
    expect(options.length).toBeGreaterThanOrEqual(1);
    expect(options.length).toBeLessThanOrEqual(3);
    const keys = options.map((o) => JSON.stringify(o.assignments));
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < options.length; i++) expect(options[i - 1]!.score.total).toBeGreaterThanOrEqual(options[i]!.score.total);
  });

  it('honours maxOptions', () => {
    expect(plan({ ...input, maxOptions: 1 }).options).toHaveLength(1);
  });

  it('is deterministic', () => {
    expect(plan(input)).toEqual(plan(input));
  });

  it('merges identical options', () => {
    expect(plan({ beds: beds(1), wishes: [{ cropId: 'tomate' }] }).options).toHaveLength(1);
  });

  it('names the strategy of each option', () => {
    for (const o of plan(input).options) expect(['priority', 'constrained', 'companions']).toContain(o.strategy);
  });

  it('copies every weight, all flagged as estimates', () => {
    const { params } = plan(input);
    expect(params).toEqual(CROP_PLAN_WEIGHTS);
    for (const p of Object.values(params)) expect(p.estimate).toBe(true);
  });

  it('writes French without an em dash', () => {
    for (const o of plan(input).options) for (const i of o.score.items) expect(i.text).not.toMatch(/—/);
  });
});

describe('scoreCropPlan', () => {
  const base: CropPlanInput = { beds: beds(2), crops: catalog, sownOn: '2026-04-01', wishes: [{ cropId: 'tomate' }, { cropId: 'basilic' }] };

  it('rescores a plan edited by hand, the same way the solver does', () => {
    const [best] = plan({ beds: base.beds, wishes: base.wishes, neighbours: [['planche-1', 'planche-2']] }).options;
    const again = value(scoreCropPlan({ ...base, neighbours: [['planche-1', 'planche-2']] }, best!.assignments));
    expect(again).toEqual(best!.score);
  });

  it('counts wished beds missing from the edited plan as unplaced', () => {
    const score = value(scoreCropPlan(base, [{ bedId: 'planche-1', cropIds: ['tomate'] }]));
    expect(score.unplaced).toBe(W.unplaced);
  });

  it('refuses a plan naming an unknown bed, a nameless crop, or one bed twice', () => {
    expect(scoreCropPlan(base, [{ bedId: 'x', cropIds: ['tomate'] }])).toEqual({ ok: false, error: 'Planche inconnue : x.' });
    expect(scoreCropPlan(base, [{ bedId: 'planche-1', cropIds: [''] }])).toEqual({ ok: false, error: 'Culture sans nom.' });
    expect(
      scoreCropPlan(base, [
        { bedId: 'planche-1', cropIds: ['tomate'] },
        { bedId: 'planche-1', cropIds: ['basilic'] },
      ]),
    ).toEqual({ ok: false, error: 'Planche en double : planche-1.' });
  });

  it('refuses a bed holding more crops than allowed or one crop twice', () => {
    expect(scoreCropPlan(base, [{ bedId: 'planche-1', cropIds: ['tomate', 'basilic'] }]).ok).toBe(false);
    expect(scoreCropPlan({ ...base, cropsPerBed: 2 }, [{ bedId: 'planche-1', cropIds: ['tomate', 'tomate'] }]).ok).toBe(false);
  });

  it('scores a crop the owner added by hand that he did not wish', () => {
    const score = value(scoreCropPlan({ ...base, cropsPerBed: 2 }, [{ bedId: 'planche-1', cropIds: ['tomate', 'pomme-de-terre'] }]));
    expect(score.companions).toBe(W.bad);
  });
});

describe('solveCropPlan: crops outside the catalog', () => {
  it('places a free-name crop with no data, and says so', () => {
    const bed: CropPlanBed = { id: 'a', label: 'Carré 1', history: [{ species: 'ail-des-ours', sownOn: '2025-03-01' }] };
    const result = plan({ beds: [bed, { id: 'b' }], neighbours: [['a', 'b']], wishes: [{ cropId: 'ail-des-ours', name: 'Ail des ours' }, { cropId: 'tomate' }] });
    const [best] = result.options;
    expect(best!.assignments.flatMap((a) => a.cropIds).sort()).toEqual(['ail-des-ours', 'tomate']);
    expect(best!.score.total).toBe(0);
    expect(result.withoutData).toEqual([
      { cropId: 'ail-des-ours', name: 'Ail des ours', text: 'Ail des ours : pas de donnée, placé sans rotation ni compagnonnage.' },
    ]);
  });

  it('names a free crop after its id when no name is given, and never counts it as a family', () => {
    const result = plan({ beds: beds(1), cropsPerBed: 2, wishes: [{ cropId: 'mystere' }, { cropId: 'tomate' }] });
    expect(result.withoutData[0]!.name).toBe('mystere');
    expect(result.options[0]!.score.families).toBe(0);
  });

  it('scores a free crop placed by hand', () => {
    const input: CropPlanInput = { beds: beds(1), crops: catalog, sownOn: '2026-04-01', cropsPerBed: 2, wishes: [{ cropId: 'tomate' }] };
    expect(value(scoreCropPlan(input, [{ bedId: 'planche-1', cropIds: ['tomate', 'mystere'] }])).total).toBe(0);
  });

  it('lists nothing when every crop is in the catalog', () => {
    expect(plan({ beds: beds(1), wishes: [{ cropId: 'tomate' }] }).withoutData).toEqual([]);
  });
});

describe('solveCropPlan: refusals', () => {
  const ok: CropPlanInput = { beds: beds(2), crops: catalog, sownOn: '2026-04-01', wishes: [{ cropId: 'tomate' }] };
  const cases: [string, Partial<CropPlanInput>, string][] = [
    ['no bed', { beds: [] }, 'Aucune planche libre.'],
    ['duplicate bed', { beds: [{ id: 'a' }, { id: 'a' }] }, 'Planche en double : a.'],
    ['empty bed id', { beds: [{ id: '' }] }, 'Planche sans identifiant.'],
    ['no wish', { wishes: [] }, 'Aucune culture demandée.'],
    ['crop without id', { wishes: [{ cropId: ' ' }] }, 'Culture sans nom.'],
    ['crop id too long', { wishes: [{ cropId: 'x'.repeat(81) }] }, 'Culture sans nom.'],
    ['crop name too long', { wishes: [{ cropId: 'x', name: 'x'.repeat(81) }] }, 'Culture sans nom.'],
    ['wish twice', { wishes: [{ cropId: 'chou' }, { cropId: 'chou-ete' }] }, 'Culture demandée deux fois : chou-ete.'],
    ['zero beds', { wishes: [{ cropId: 'tomate', beds: 0 }] }, 'Nombre de planches invalide.'],
    ['fraction', { wishes: [{ cropId: 'tomate', beds: 1.5 }] }, 'Nombre de planches invalide.'],
    ['bad date', { sownOn: '2026-13-01' }, 'Date invalide : 2026-13-01.'],
    ['bad wish date', { wishes: [{ cropId: 'tomate', sownOn: 'demain' }] }, 'Date invalide : demain.'],
    ['bad history date', { beds: [{ id: 'a', history: [{ species: 'tomate', sownOn: '2025' }] }] }, 'Date invalide : 2025.'],
    ['crops per bed', { cropsPerBed: 0 }, 'Nombre de cultures par planche invalide.'],
    ['crops per bed high', { cropsPerBed: 5 }, 'Nombre de cultures par planche invalide.'],
    ['options', { maxOptions: 4 }, "Nombre d'options invalide."],
    ['neighbour unknown', { neighbours: [['planche-1', 'z']] }, 'Planche inconnue : z.'],
    ['neighbour self', { neighbours: [['planche-1', 'planche-1']] }, 'Une planche ne peut pas être sa propre voisine.'],
  ];

  it.each(cases)('%s', (_name, patch, error) => {
    expect(solveCropPlan({ ...ok, ...patch })).toEqual({ ok: false, error });
  });

  it('refuses inputs too large to stay quick', () => {
    expect(solveCropPlan({ ...ok, beds: beds(501) }).ok).toBe(false);
    expect(solveCropPlan({ ...ok, wishes: [{ cropId: 'tomate', beds: 501 }] }).ok).toBe(false);
    const longHistory = Array.from({ length: 501 }, () => ({ species: 'tomate', sownOn: '2020-04-01' }));
    expect(solveCropPlan({ ...ok, beds: [{ id: 'a', history: longHistory }] }).ok).toBe(false);
    const manyPairs = Array.from({ length: 5001 }, () => ['planche-1', 'planche-2'] as const);
    expect(solveCropPlan({ ...ok, neighbours: manyPairs }).ok).toBe(false);
  });

  it('accepts a duplicated neighbour pair in either order', () => {
    expect(solveCropPlan({ ...ok, neighbours: [['planche-1', 'planche-2'], ['planche-2', 'planche-1']] }).ok).toBe(true);
  });
});

describe('solveCropPlan: size', () => {
  it('plans 500 beds holding up to 480 wished beds within two seconds', () => {
    const many = beds(500);
    const ids = catalog.map((c) => c.id);
    const wishes = ids.map((cropId) => ({ cropId, beds: Math.floor(480 / ids.length) }));
    const started = performance.now();
    const result = solveCropPlan({ beds: many, crops: catalog, sownOn: '2026-04-01', neighbours: line(many), cropsPerBed: 1, wishes });
    expect(result.ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
