import { describe, expect, it } from 'vitest';
import { validatePlanting } from '../src/index.js';

const base = { species: 'tomate', bedId: 'b', method: 'direct' as const, sownOn: '2026-04-01' };

describe('validatePlanting', () => {
  it('rejects transplant before sowing', () => {
    expect(validatePlanting({ ...base, sownOn: '2026-04-10', transplantedOn: '2026-04-01' }, '2026-05-01'))
      .toBe('La date de repiquage est avant la date de semis.');
  });
  it('rejects sowing more than one day in the future', () => {
    expect(validatePlanting({ ...base, sownOn: '2026-05-03' }, '2026-05-01')).toBe('La date de semis est dans le futur.');
  });
  it('accepts sowing tomorrow (late evening entry across midnight)', () => {
    expect(validatePlanting({ ...base, sownOn: '2026-05-02' }, '2026-05-01')).toBeNull();
  });
  it('rejects harvest before sowing', () => {
    expect(validatePlanting({ ...base, sownOn: '2026-04-10', harvestedOn: '2026-04-09' }, '2026-05-01'))
      .toBe('La date de récolte est avant la date de semis.');
  });
  it('accepts a valid planting', () => {
    expect(validatePlanting(base, '2026-05-01')).toBeNull();
  });
  it('rejects a malformed date', () => {
    expect(validatePlanting({ ...base, sownOn: '01/04/2026' }, '2026-05-01')).toBe('La date de semis est invalide.');
  });
});
