import { describe, expect, it } from 'vitest';
import { forecastFirstHarvest, type Crop } from '../src/index.js';
import { baseCrop, basePlanting } from './fixtures.js';

const fromSowing: Crop = { ...baseCrop, firstHarvestDays: { value: { days: 28, from: 'sowing' }, estimate: true } };
const fromTransplant: Crop = { ...baseCrop, firstHarvestDays: { value: { days: 60, from: 'transplant' }, source: 's' } };

describe('forecastFirstHarvest', () => {
  it('returns null without firstHarvestDays', () => {
    expect(forecastFirstHarvest({ ...basePlanting, sownOn: '2026-04-01' }, baseCrop)).toBeNull();
  });

  it('counts from the sowing date', () => {
    expect(forecastFirstHarvest({ ...basePlanting, method: 'direct', sownOn: '2026-04-01' }, fromSowing)).toEqual({
      expected: '2026-04-29',
      estimate: true,
    });
  });

  it('returns null for a bought plant when the delay counts from sowing', () => {
    expect(forecastFirstHarvest({ ...basePlanting, method: 'bought', sownOn: '2026-04-01' }, fromSowing)).toBeNull();
  });

  it('counts from the transplant date', () => {
    const p = { ...basePlanting, method: 'pot' as const, sownOn: '2026-03-01', transplantedOn: '2026-05-01' };
    expect(forecastFirstHarvest(p, fromTransplant)).toEqual({ expected: '2026-06-30', estimate: false });
  });

  it('uses the planting date of a bought plant when the delay counts from transplant', () => {
    expect(forecastFirstHarvest({ ...basePlanting, method: 'bought', sownOn: '2026-05-01' }, fromTransplant)).toEqual({
      expected: '2026-06-30',
      estimate: false,
    });
  });

  it('returns null for a pot not yet transplanted when the delay counts from transplant', () => {
    expect(forecastFirstHarvest({ ...basePlanting, method: 'pot', sownOn: '2026-03-01' }, fromTransplant)).toBeNull();
  });

  it('returns null for a direct sowing when the delay counts from transplant', () => {
    expect(forecastFirstHarvest({ ...basePlanting, method: 'direct', sownOn: '2026-03-01' }, fromTransplant)).toBeNull();
  });
});
