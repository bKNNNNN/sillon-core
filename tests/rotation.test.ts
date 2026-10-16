import { describe, expect, it } from 'vitest';
import { rotationWarning } from '../src/index.js';
import { cropFixtures as crops } from './fixtures.js';

describe('rotationWarning', () => {
  it('warns when same family on same bed within 3 years', () => {
    expect(rotationWarning([{ species: 'tomate', sownOn: '2024-04-15' }], 'pomme-de-terre', '2026-04-01', crops))
      .toBe('Solanacées déjà sur cette planche en 2024 : pense à faire tourner.');
  });
  it('no warning after 3 full years', () => {
    expect(rotationWarning([{ species: 'tomate', sownOn: '2022-04-15' }], 'tomate', '2026-04-01', crops)).toBeNull();
  });
  it('no warning at 2023 vs 2026', () => {
    expect(rotationWarning([{ species: 'tomate', sownOn: '2023-04-15' }], 'tomate', '2026-04-01', crops)).toBeNull();
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
    const odd: typeof crops = [{ ...crops[0]!, id: 'a', family: 'inconnue' }];
    expect(rotationWarning([{ species: 'a', sownOn: '2025-01-01' }], 'a', '2026-01-01', odd))
      .toBe('inconnue déjà sur cette planche en 2025 : pense à faire tourner.');
  });
});
