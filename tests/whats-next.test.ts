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
    expect(r).toContainEqual(expect.objectContaining({ cropId: 'radis', action: 'sow_direct', estimate: false }));
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

  it('proposes nothing when sown more recently than successionDays', () => {
    expect(whatsNext(crops, [{ ...basePlanting, sownOn: '2026-04-01' }], '2026-04-08')).toEqual([]);
  });

  it('uses the most recent planting and ignores inactive or other crops', () => {
    const ps = [
      { ...basePlanting, sownOn: '2026-03-01' },
      { ...basePlanting, sownOn: '2026-04-05' },
      { ...basePlanting, sownOn: '2026-01-01', status: 'done' as const },
      { ...basePlanting, species: 'autre', sownOn: '2026-04-07' },
    ];
    expect(whatsNext(crops, ps, '2026-04-08')).toEqual([]);
  });

  it('without successionDays, a sowing inside the current window suppresses re-proposal', () => {
    const c = [{ ...radis, successionDays: undefined }];
    expect(whatsNext(c, [{ ...basePlanting, sownOn: '2026-04-06' }], '2026-04-08')).toEqual([]);
    expect(whatsNext(c, [{ ...basePlanting, sownOn: '2026-03-20' }], '2026-04-08')).toEqual([]);
  });

  it('suppression is scoped per window occurrence', () => {
    const c = [
      { ...radis, successionDays: undefined, sowUnderCover: { value: { from: 14, to: 30 }, source: 's' } },
    ];
    const r = whatsNext(c, [{ ...basePlanting, sownOn: '2026-03-20' }], '2026-04-08');
    expect(r.map((a) => a.action)).toEqual(['sow_under_cover']);
  });

  it('ignores plantings from before the current window occurrence', () => {
    const r = whatsNext(crops, [{ ...basePlanting, sownOn: '2025-06-01' }], '2026-04-08');
    expect(r).toEqual([expect.objectContaining({ action: 'sow_direct' })]);
  });

  it('wrapped window: sowing in the previous year part suppresses, older season does not', () => {
    const garlic: Crop = { ...baseCrop, id: 'ail', sowDirect: { value: { from: 44, to: 6 }, source: 's' } };
    const p = { ...basePlanting, species: 'ail' };
    expect(whatsNext([garlic], [{ ...p, sownOn: '2025-11-12' }], '2026-01-07')).toEqual([]);
    expect(whatsNext([garlic], [{ ...p, sownOn: '2025-03-01' }], '2026-01-07')).toHaveLength(1);
  });

  it('emits one succession max when both windows are open', () => {
    const c = [{ ...radis, sowUnderCover: { value: { from: 10, to: 30 }, estimate: true } }];
    const r = whatsNext(c, [{ ...basePlanting, sownOn: '2026-03-03' }], '2026-04-08');
    expect(r.map((a) => a.action)).toEqual(['succession']);
    expect(r[0].estimate).toBe(true);
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
      expect.objectContaining({ action: 'transplant', reason: 'Fenêtre de plantation : semaines 15 à 20.' }),
    ]);
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
});
