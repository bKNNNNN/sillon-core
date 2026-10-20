import { describe, expect, it } from 'vitest';
import { whatsNext } from '../src/index.js';
import type { Crop } from '../src/index.js';
import { baseCrop, basePlanting } from './fixtures.js';

const radis: Crop = {
  ...baseCrop,
  sowDirect: { value: { from: 10, to: 30 }, source: 's' },
  successionDays: { value: 14, source: 's' },
};
const crops = [radis];

describe('whatsNext', () => {
  it('proposes direct sowing of radish in week 15', () => {
    const r = whatsNext(crops, [], '2026-04-08');
    expect(r).toContainEqual(expect.objectContaining({ cropId: 'radis', action: 'sow_direct', estimate: false, doneOn: [] }));
    expect(r[0].reason).toBe('Fenêtre de semis direct : semaines 10 à 30.');
  });

  it('proposes succession when last sowing is older than successionDays', () => {
    const a = whatsNext(crops, [{ ...basePlanting, sownOn: '2026-03-20' }], '2026-04-08');
    expect(a).toEqual([
      expect.objectContaining({
        action: 'succession',
        reason: 'Dernier semis il y a 19 jours, à renouveler tous les 14 jours.',
      }),
    ]);
  });

  it('keeps the window visible with its date when sown more recently than successionDays', () => {
    expect(whatsNext(crops, [{ ...basePlanting, sownOn: '2026-04-01' }], '2026-04-08')).toEqual([
      expect.objectContaining({
        action: 'sow_direct',
        doneOn: ['2026-04-01'],
        reason: 'Fenêtre de semis direct : semaines 10 à 30. Déjà semé le 1er avr.',
      }),
    ]);
  });

  it('uses the most recent planting and ignores inactive or other crops', () => {
    const ps = [
      { ...basePlanting, sownOn: '2026-03-04' },
      { ...basePlanting, sownOn: '2026-04-05' },
      { ...basePlanting, sownOn: '2026-01-01', status: 'done' as const },
      { ...basePlanting, species: 'autre', sownOn: '2026-04-07' },
    ];
    expect(whatsNext(crops, ps, '2026-04-08')).toEqual([
      expect.objectContaining({
        action: 'sow_direct',
        doneOn: ['2026-03-04', '2026-04-05'],
        reason: 'Fenêtre de semis direct : semaines 10 à 30. Déjà semé le 4 mars et le 5 avr.',
      }),
    ]);
  });

  it('without successionDays, a sowing inside the current window stays visible as done', () => {
    const c = [{ ...radis, successionDays: undefined }];
    expect(whatsNext(c, [{ ...basePlanting, sownOn: '2026-04-06' }], '2026-04-08')).toEqual([
      expect.objectContaining({ action: 'sow_direct', doneOn: ['2026-04-06'] }),
    ]);
    expect(whatsNext(c, [{ ...basePlanting, sownOn: '2026-03-20' }], '2026-04-08')).toEqual([
      expect.objectContaining({ action: 'sow_direct', doneOn: ['2026-03-20'] }),
    ]);
  });

  it('done dates are scoped per window occurrence', () => {
    const c = [
      { ...radis, successionDays: undefined, sowUnderCover: { value: { from: 14, to: 30 }, source: 's' } },
    ];
    const r = whatsNext(c, [{ ...basePlanting, sownOn: '2026-03-20' }], '2026-04-08');
    expect(r.map((a) => [a.action, a.doneOn])).toEqual([
      ['sow_under_cover', []],
      ['sow_direct', ['2026-03-20']],
    ]);
  });

  it('attributes a done date to the window that matches the method', () => {
    const c = [{ ...radis, successionDays: undefined, sowUnderCover: { value: { from: 10, to: 30 }, source: 's' } }];
    const r = whatsNext(c, [{ ...basePlanting, method: 'pot' as const, sownOn: '2026-04-01' }], '2026-04-08');
    expect(r.map((a) => [a.action, a.doneOn])).toEqual([
      ['sow_under_cover', ['2026-04-01']],
      ['sow_direct', []],
    ]);
    expect(r[1]!.reason).toBe('Fenêtre de semis direct : semaines 10 à 30.');
  });

  it('a planting without a method counts for every sowing window', () => {
    const c = [{ ...radis, successionDays: undefined, sowUnderCover: { value: { from: 10, to: 30 }, source: 's' } }];
    const bare = { species: 'radis', sownOn: '2026-04-01', status: 'active' as const };
    expect(whatsNext(c, [bare], '2026-04-08').map((a) => a.doneOn)).toEqual([['2026-04-01'], ['2026-04-01']]);
  });

  it('counts several sowings when there are more than two', () => {
    const ps = ['2026-03-10', '2026-03-20', '2026-04-05'].map((sownOn) => ({ ...basePlanting, sownOn }));
    const r = whatsNext([{ ...radis, successionDays: undefined }], ps, '2026-04-08');
    expect(r[0]!.reason).toBe('Fenêtre de semis direct : semaines 10 à 30. Déjà semé 3 fois, le dernier le 5 avr.');
  });

  it('keeps the garlic window with the planting of 18 October', () => {
    const ail: Crop = { ...baseCrop, id: 'ail', name: 'Ail', sowDirect: { value: [{ from: 41, to: 49 }, { from: 5, to: 9 }], estimate: true } };
    const r = whatsNext([ail], [{ ...basePlanting, species: 'ail', sownOn: '2026-10-18' }], '2026-10-20');
    expect(r).toEqual([
      {
        cropId: 'ail',
        cropName: 'Ail',
        action: 'sow_direct',
        estimate: true,
        doneOn: ['2026-10-18'],
        reason: 'Fenêtre de semis direct : semaines 41 à 49. Déjà semé le 18 oct.',
      },
    ]);
  });

  it('ignores plantings from before the current window occurrence', () => {
    const r = whatsNext(crops, [{ ...basePlanting, sownOn: '2025-06-01' }], '2026-04-08');
    expect(r).toEqual([expect.objectContaining({ action: 'sow_direct' })]);
  });

  it('wrapped window: a sowing in the previous year part is done, an older season is not', () => {
    const garlic: Crop = { ...baseCrop, id: 'ail', sowDirect: { value: { from: 44, to: 6 }, source: 's' } };
    const p = { ...basePlanting, species: 'ail' };
    expect(whatsNext([garlic], [{ ...p, sownOn: '2025-11-12' }], '2026-01-07')).toEqual([
      expect.objectContaining({ doneOn: ['2025-11-12'], reason: 'Fenêtre de semis direct : semaines 44 à 6. Déjà semé le 12 nov.' }),
    ]);
    expect(whatsNext([garlic], [{ ...p, sownOn: '2025-03-01' }], '2026-01-07')).toEqual([
      expect.objectContaining({ doneOn: [] }),
    ]);
  });

  it('emits one succession max when both windows are open', () => {
    const c = [{ ...radis, sowUnderCover: { value: { from: 10, to: 30 }, estimate: true } }];
    const r = whatsNext(c, [{ ...basePlanting, sownOn: '2026-03-03' }], '2026-04-08');
    expect(r.map((a) => a.action)).toEqual(['succession']);
    expect(r[0].estimate).toBe(true);
    expect(r[0].doneOn).toEqual(['2026-03-03']);
  });

  it('proposes both sowings without planting, with estimate flag and under-cover reason', () => {
    const c = [{ ...radis, sowUnderCover: { value: { from: 10, to: 30 }, estimate: true } }];
    const r = whatsNext(c, [], '2026-04-08');
    expect(r.map((a) => a.action)).toEqual(['sow_under_cover', 'sow_direct']);
    expect(r[0]).toMatchObject({ estimate: true, reason: 'Fenêtre de semis sous abri : semaines 10 à 30.' });
  });

  it('proposes transplant regardless of plantings', () => {
    const c = [{ ...baseCrop, transplant: { value: { from: 15, to: 20 }, source: 's' } }];
    const r = whatsNext(c, [basePlanting], '2026-04-08');
    expect(r).toEqual([
      expect.objectContaining({ action: 'transplant', doneOn: [], reason: 'Fenêtre de plantation : semaines 15 à 20.' }),
    ]);
  });

  it('marks the transplant window done for a transplanted or bought plant', () => {
    const c = [{ ...baseCrop, transplant: { value: { from: 15, to: 20 }, source: 's' } }];
    const ps = [
      { ...basePlanting, method: 'pot' as const, sownOn: '2026-02-20', transplantedOn: '2026-04-12' },
      { ...basePlanting, method: 'bought' as const, sownOn: '2026-04-14' },
      { ...basePlanting, method: 'pot' as const, sownOn: '2026-03-01', transplantedOn: '2025-04-30' },
    ];
    const r = whatsNext(c, ps, '2026-04-15');
    expect(r).toEqual([
      expect.objectContaining({
        action: 'transplant',
        doneOn: ['2026-04-12', '2026-04-14'],
        reason: 'Fenêtre de plantation : semaines 15 à 20. Déjà planté le 12 avr. et le 14 avr.',
      }),
    ]);
  });

  it('a bought plant does not count as a sowing', () => {
    const r = whatsNext([{ ...radis, successionDays: undefined }], [{ ...basePlanting, method: 'bought' as const, sownOn: '2026-04-01' }], '2026-04-08');
    expect(r).toEqual([expect.objectContaining({ action: 'sow_direct', doneOn: [] })]);
  });

  it('proposes nothing out of season', () => {
    expect(whatsNext(crops, [], '2026-12-01')).toEqual([]);
  });

  it('handles winter windows that wrap the year end', () => {
    const garlic: Crop = { ...baseCrop, id: 'ail', sowDirect: { value: { from: 44, to: 6 }, source: 's' } };
    expect(whatsNext([garlic], [], '2026-01-07').map((a) => a.cropId)).toContain('ail');
    expect(whatsNext([garlic], [], '2026-11-10').map((a) => a.cropId)).toContain('ail');
    expect(whatsNext([garlic], [], '2026-06-10')).toEqual([]);
  });

  describe('with two windows in one field', () => {
    const twoSeasons: Crop = {
      ...baseCrop,
      sowDirect: { value: [{ from: 6, to: 18 }, { from: 32, to: 44 }], estimate: true },
    };

    it('proposes sowing in the second window and names it', () => {
      const r = whatsNext([twoSeasons], [], '2026-09-02');
      expect(r).toEqual([expect.objectContaining({ action: 'sow_direct', estimate: true, reason: 'Fenêtre de semis direct : semaines 32 à 44.' })]);
    });

    it('proposes nothing between the two windows', () => {
      expect(whatsNext([twoSeasons], [], '2026-06-10')).toEqual([]);
    });

    it('proposes again in autumn after a spring sowing', () => {
      const r = whatsNext([twoSeasons], [{ ...basePlanting, sownOn: '2026-03-15' }], '2026-09-02');
      expect(r).toEqual([expect.objectContaining({ action: 'sow_direct', doneOn: [] })]);
    });
  });
});
