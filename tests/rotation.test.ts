import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROTATION_RULES, rotationAdvice, rotationWarning, type Crop } from '../src/index.js';
import { baseCrop, cropFixtures } from './fixtures.js';

const short = (id: string, family: string, days: number): Crop => ({
  ...baseCrop,
  id,
  name: id,
  family,
  firstHarvestDays: { value: { days, from: 'sowing' }, estimate: true },
});
const chou: Crop = { ...short('chou', 'brassicacees', 150), firstHarvestDays: { value: [{ days: 150, from: 'sowing' }, { days: 60, from: 'transplant' }], estimate: true } };
const crops: Crop[] = [
  ...cropFixtures,
  { ...baseCrop, id: 'ail', name: 'Ail', family: 'amaryllidacees' },
  { ...baseCrop, id: 'poireau', name: 'Poireau', family: 'amaryllidacees' },
  short('epinard', 'amaranthacees', 42),
  short('blette', 'amaranthacees', 60),
  short('radis', 'brassicacees', 18),
  chou,
];

describe('rotationWarning', () => {
  it('warns when the same family grew on the bed in a previous season', () => {
    expect(rotationWarning([{ species: 'tomate', sownOn: '2024-04-15' }], 'pomme-de-terre', '2026-04-01', crops))
      .toBe('Solanacées déjà sur cette planche en 2024 : pense à faire tourner.');
  });

  it('never warns against the same season', () => {
    expect(rotationWarning([{ species: 'ail', sownOn: '2026-02-10' }], 'poireau', '2026-04-01', crops)).toBeNull();
    expect(rotationWarning([{ species: 'blette', sownOn: '2026-03-01' }], 'blette', '2026-09-01', crops)).toBeNull();
  });

  it('two spinach sowings in the same season give no warning', () => {
    expect(rotationWarning([{ species: 'epinard', sownOn: '2026-03-01' }], 'epinard', '2026-09-10', crops)).toBeNull();
  });

  it('ignores history dated after the new planting', () => {
    expect(rotationWarning([{ species: 'tomate', sownOn: '2026-04-15' }], 'tomate', '2025-04-01', crops)).toBeNull();
  });

  it('keeps Solanacées and Brassicacées off the bed for 4 years', () => {
    expect(rotationWarning([{ species: 'tomate', sownOn: '2023-04-15' }], 'tomate', '2026-04-01', crops))
      .toBe('Solanacées déjà sur cette planche en 2023 : pense à faire tourner.');
    expect(rotationWarning([{ species: 'tomate', sownOn: '2022-04-15' }], 'tomate', '2026-04-01', crops)).toBeNull();
    expect(rotationWarning([{ species: 'chou', sownOn: '2023-04-15' }], 'chou', '2026-04-01', crops)).not.toBeNull();
  });

  it('other families keep the 3-year default', () => {
    expect(rotationWarning([{ species: 'carotte', sownOn: '2024-04-15' }], 'carotte', '2026-04-01', crops)).not.toBeNull();
    expect(rotationWarning([{ species: 'carotte', sownOn: '2023-04-15' }], 'carotte', '2026-04-01', crops)).toBeNull();
  });

  it('a short crop never triggers a warning, for itself or for the next crop', () => {
    expect(rotationWarning([{ species: 'chou', sownOn: '2025-04-15' }], 'radis', '2026-04-01', crops)).toBeNull();
    expect(rotationWarning([{ species: 'radis', sownOn: '2025-04-15' }], 'chou', '2026-04-01', crops)).toBeNull();
  });

  it('a crop is short only when every origin is within the threshold', () => {
    expect(rotationWarning([{ species: 'chou', sownOn: '2025-04-15' }], 'chou', '2026-04-01', crops)).not.toBeNull();
  });

  it('no warning for another family', () => {
    expect(rotationWarning([{ species: 'carotte', sownOn: '2025-04-15' }], 'tomate', '2026-04-01', crops)).toBeNull();
  });

  it('uses the most recent conflicting year', () => {
    const history = [
      { species: 'tomate', sownOn: '2024-04-15' },
      { species: 'pomme-de-terre', sownOn: '2025-04-15' },
    ];
    expect(rotationWarning(history, 'tomate', '2026-04-01', crops))
      .toBe('Solanacées déjà sur cette planche en 2025 : pense à faire tourner.');
  });

  it('ignores unknown species', () => {
    expect(rotationWarning([{ species: 'x', sownOn: '2025-04-15' }], 'tomate', '2026-04-01', crops)).toBeNull();
    expect(rotationWarning([{ species: 'tomate', sownOn: '2025-04-15' }], 'x', '2026-04-01', crops)).toBeNull();
  });

  it('falls back to the raw family id when unlabeled', () => {
    const odd: Crop[] = [{ ...crops[0]!, id: 'a', family: 'inconnue' }];
    expect(rotationWarning([{ species: 'a', sownOn: '2025-01-01' }], 'a', '2026-01-01', odd))
      .toBe('inconnue déjà sur cette planche en 2025 : pense à faire tourner.');
  });
});

describe('rotationAdvice', () => {
  it('describes the conflict and attaches the soil pH advice to Brassicacées', () => {
    expect(rotationAdvice([{ species: 'chou', sownOn: '2024-05-01' }], 'chou', '2026-04-01', crops)).toEqual({
      warning: 'Brassicacées déjà sur cette planche en 2024 : pense à faire tourner.',
      family: 'brassicacees',
      lastYear: 2024,
      rotationYears: 4,
      soilPhAdvice: true,
    });
    expect(rotationAdvice([{ species: 'tomate', sownOn: '2025-05-01' }], 'tomate', '2026-04-01', crops)?.soilPhAdvice).toBe(false);
  });

  it('every rule value carries a source or an estimate flag', () => {
    const values = [ROTATION_RULES.defaultYears, ROTATION_RULES.shortCropMaxDays, ...Object.values(ROTATION_RULES.familyYears)];
    for (const v of values) expect(Boolean(v.source) || v.estimate === true).toBe(true);
  });
});

describe('rotation properties', () => {
  const day = fc.record({ month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) });
  const iso = (y: number, d: { month: number; day: number }) =>
    `${y}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

  it('warns exactly when the gap in seasons is between 1 and the family rule minus 1', () => {
    const cases: [string, number][] = [['carotte', 3], ['tomate', 4], ['chou', 4]];
    fc.assert(
      fc.property(fc.constantFrom(...cases), fc.integer({ min: 2000, max: 2040 }), fc.integer({ min: -3, max: 8 }), day, day, ([species, years], y, gap, a, b) => {
        const warning = rotationWarning([{ species, sownOn: iso(y - gap, a) }], species, iso(y, b), crops);
        expect(warning !== null).toBe(gap >= 1 && gap <= years - 1);
      }),
    );
  });

  it('the season changes on 1 January: 31 December then 1 January is a previous season', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2040 }), (y) => {
        expect(rotationWarning([{ species: 'tomate', sownOn: `${y}-12-31` }], 'tomate', `${y + 1}-01-01`, crops)).not.toBeNull();
        expect(rotationWarning([{ species: 'tomate', sownOn: `${y}-01-01` }], 'tomate', `${y}-12-31`, crops)).toBeNull();
      }),
    );
  });
});
