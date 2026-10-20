import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { germinationOutlook, seedLotOutlook, type Crop } from '../src/index.js';

const carrot = { seedLifespanYears: { value: 3, source: 's' } } as Crop;
const estimated = { seedLifespanYears: { value: 3, estimate: true } } as Crop;

describe('seedLotOutlook', () => {
  it('a lot within its lifespan is good until harvest year plus lifespan', () => {
    expect(seedLotOutlook({ harvestYear: 2024 }, carrot, 2026)).toEqual({
      status: 'good',
      goodUntil: 2027,
      lastSafeSeason: false,
      lifespanEstimate: false,
    });
  });

  it('flags the last safe season when the age equals the lifespan', () => {
    expect(seedLotOutlook({ harvestYear: 2023 }, carrot, 2026)).toMatchObject({
      status: 'good',
      goodUntil: 2026,
      lastSafeSeason: true,
    });
  });

  it('keeps goodUntil on reduced and poor lots', () => {
    expect(seedLotOutlook({ harvestYear: 2021 }, carrot, 2026)).toMatchObject({ status: 'reduced', goodUntil: 2024 });
    expect(seedLotOutlook({ harvestYear: 2019 }, carrot, 2026)).toMatchObject({ status: 'poor', goodUntil: 2022 });
  });

  it('a 2021 carrot lot is never reported with an unknown age', () => {
    expect(seedLotOutlook({ harvestYear: 2021 }, carrot, 2026).status).not.toBe('no-year');
  });

  it('distinguishes a missing year from a missing lifespan', () => {
    expect(seedLotOutlook({ harvestYear: null }, carrot, 2026)).toEqual({
      status: 'no-year',
      goodUntil: null,
      lastSafeSeason: false,
      lifespanEstimate: false,
    });
    expect(seedLotOutlook({ harvestYear: 2024 }, {} as Crop, 2026)).toMatchObject({ status: 'no-lifespan', goodUntil: null });
    expect(seedLotOutlook({ harvestYear: 2024 }, undefined, 2026).status).toBe('no-lifespan');
    expect(seedLotOutlook({}, undefined, 2026).status).toBe('no-year');
  });

  it('treats a harvest year after the current year as unknown, never as good', () => {
    expect(seedLotOutlook({ harvestYear: 2027 }, carrot, 2026)).toMatchObject({ status: 'no-year', goodUntil: null });
  });

  it('reports an estimated lifespan', () => {
    expect(seedLotOutlook({ harvestYear: 2024 }, estimated, 2026).lifespanEstimate).toBe(true);
    expect(seedLotOutlook({ harvestYear: null }, estimated, 2026).lifespanEstimate).toBe(false);
  });

  it('property: goodUntil is harvest year plus lifespan and the status follows the age', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1990, max: 2040 }), fc.integer({ min: 0, max: 30 }), fc.integer({ min: 1, max: 10 }), (year, age, life) => {
        const crop = { seedLifespanYears: { value: life, source: 's' } } as Crop;
        const r = seedLotOutlook({ harvestYear: year }, crop, year + age);
        expect(r.goodUntil).toBe(year + life);
        expect(r.lastSafeSeason).toBe(age === life);
        const expected = age <= life ? 'good' : age <= life + 2 ? 'reduced' : 'poor';
        expect(r.status).toBe(expected);
      }),
    );
  });
});

describe('germinationOutlook (compatible form)', () => {
  it('answers no-year for a lot without a year, unknown without a lifespan', () => {
    expect(germinationOutlook({ harvestYear: null }, carrot, 2026)).toBe('no-year');
    expect(germinationOutlook({ harvestYear: 2024 }, {} as Crop, 2026)).toBe('unknown');
    expect(germinationOutlook({ harvestYear: 2023 }, carrot, 2026)).toBe('good');
  });
});
