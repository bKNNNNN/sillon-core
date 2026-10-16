import { describe, expect, it } from 'vitest';
import { germinationOutlook, type Crop } from '../src/index.js';

describe('germinationOutlook', () => {
  const carrot = { seedLifespanYears: { value: 3, source: 's' } } as Crop;
  it('by age', () => {
    expect(germinationOutlook({ harvestYear: 2024 }, carrot, 2026)).toBe('good');
    expect(germinationOutlook({ harvestYear: 2023 }, carrot, 2026)).toBe('good');
    expect(germinationOutlook({ harvestYear: 2021 }, carrot, 2026)).toBe('reduced');
    expect(germinationOutlook({ harvestYear: 2019 }, carrot, 2026)).toBe('poor');
    expect(germinationOutlook({ harvestYear: 2019 }, undefined, 2026)).toBe('unknown');
  });
  it('unknown without lifespan', () => {
    expect(germinationOutlook({ harvestYear: 2024 }, {} as Crop, 2026)).toBe('unknown');
  });
});
