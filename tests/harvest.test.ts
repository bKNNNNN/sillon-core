import { describe, expect, it } from 'vitest';
import { forecastHarvest, type Crop, type HarvestInput } from '../src/index.js';
import { baseCrop, basePlanting, dayRange } from './fixtures.js';

const gddCrop = (target: number, extra: Partial<Crop> = {}): Crop => ({
  ...baseCrop,
  tBaseC: { value: 10, source: 's' },
  gdd: { value: target, source: 's' },
  ...extra,
});

// 20 GDD per day: tmin 20, tmax 30, base 10 -> 15 ; use tmin 15 tmax 35 -> 15 ... pick 25 avg => 15. Use 20/40 => 20.
const hot = (from: string, n: number) => dayRange(from, n, 20, 40);

const ctx: HarvestInput = {
  planting: basePlanting,
  crop: baseCrop,
  observed: [],
  forecast: [],
  climatology: {},
  today: '2026-06-10',
  weatherStale: false,
};

describe('forecastHarvest', () => {
  it('returns no-data without gdd nor daysToMaturity', () => {
    expect(forecastHarvest(ctx)).toEqual({ kind: 'no-data' });
  });

  it('falls back to daysToMaturity', () => {
    const crop: Crop = { ...baseCrop, daysToMaturity: { value: 28, source: 's' } };
    expect(forecastHarvest({ ...ctx, crop, planting: { ...basePlanting, sownOn: '2026-04-01' } })).toEqual({
      kind: 'days',
      expected: '2026-04-29',
      estimate: false,
      fromSowing: false,
    });
  });

  it('flags a pot not yet transplanted as counted from sowing', () => {
    const crop: Crop = { ...baseCrop, daysToMaturity: { value: 28, source: 's' } };
    const planting = { ...basePlanting, method: 'pot' as const, sownOn: '2026-04-01' };
    expect(forecastHarvest({ ...ctx, crop, planting })).toMatchObject({ kind: 'days', expected: '2026-04-29', fromSowing: true });
    const transplanted = { ...planting, transplantedOn: '2026-05-01' };
    expect(forecastHarvest({ ...ctx, crop, planting: transplanted })).toMatchObject({ expected: '2026-05-29', fromSowing: false });
  });

  it('flags days estimate and ignores gdd without tBaseC', () => {
    const crop: Crop = {
      ...baseCrop,
      gdd: { value: 100, source: 's' },
      daysToMaturity: { value: 10, estimate: true },
    };
    expect(forecastHarvest({ ...ctx, crop })).toMatchObject({ kind: 'days', estimate: true });
  });

  it('reaches target within observed weather', () => {
    const r = forecastHarvest({ ...ctx, crop: gddCrop(100), observed: hot('2026-06-01', 10) });
    expect(r).toMatchObject({ kind: 'gdd', expected: '2026-06-05', earliest: '2026-06-05', latest: '2026-06-05', progressPct: 100 });
  });

  it('starts at transplant date when present', () => {
    const planting = { ...basePlanting, transplantedOn: '2026-06-04' };
    const r = forecastHarvest({ ...ctx, planting, crop: gddCrop(40), observed: hot('2026-06-01', 10) });
    expect(r).toMatchObject({ expected: '2026-06-05' });
  });

  it('uses the forecast with a plus/minus 2 day spread', () => {
    const r = forecastHarvest({
      ...ctx,
      crop: gddCrop(200),
      observed: hot('2026-06-01', 3),
      forecast: hot('2026-06-04', 16),
    });
    expect(r).toMatchObject({ kind: 'gdd', expected: '2026-06-10', earliest: '2026-06-08', latest: '2026-06-12', progressPct: 30 });
  });

  it('uses climatology percentiles beyond the forecast', () => {
    const climatology = {
      2022: dayRange('2022-01-01', 730, 20, 30),
      2023: dayRange('2023-01-01', 730, 20, 40),
      2024: dayRange('2024-01-01', 730, 15, 25),
    };
    const r = forecastHarvest({
      ...ctx,
      crop: gddCrop(1000),
      observed: hot('2026-06-01', 3),
      forecast: hot('2026-06-04', 16),
      climatology,
    });
    expect(r.kind).toBe('gdd');
    if (r.kind === 'gdd') {
      expect(r.earliest <= r.expected && r.expected <= r.latest).toBe(true);
      expect(r.earliest < r.latest).toBe(true);
      expect(r.expected > '2026-06-19').toBe(true);
    }
  });

  it('maps Feb 29 to Feb 28 and skips years missing days', () => {
    const full = dayRange('2025-01-01', 365 * 2, 20, 30); // no leap day
    const short = dayRange('2025-01-01', 10, 20, 30);
    const r = forecastHarvest({
      ...ctx,
      planting: { ...basePlanting, sownOn: '2027-12-01' },
      crop: gddCrop(300),
      observed: [],
      forecast: dayRange('2027-12-01', 3, 20, 30),
      climatology: { 2025: full, 2026: short },
      today: '2027-12-02',
    });
    expect(r).toMatchObject({ kind: 'gdd' });
  });

  it('falls back to days when no climatology year reaches target', () => {
    const crop = gddCrop(100000, { daysToMaturity: { value: 20, source: 's' } });
    expect(forecastHarvest({ ...ctx, crop, climatology: { 2024: hot('2024-01-01', 700) } })).toMatchObject({
      kind: 'days',
      expected: '2026-06-21',
    });
  });

  it('returns no-data when nothing reaches target and no days data', () => {
    expect(forecastHarvest({ ...ctx, crop: gddCrop(100000) })).toEqual({ kind: 'no-data' });
  });

  it('propagates weatherStale and estimate', () => {
    const crop = gddCrop(100, { tBaseC: { value: 10, estimate: true } });
    const r = forecastHarvest({ ...ctx, crop, observed: hot('2026-06-01', 10), weatherStale: true });
    expect(r).toMatchObject({ kind: 'gdd', weatherStale: true, estimate: true });
  });

  it('does not mutate inputs', () => {
    const observed = hot('2026-06-01', 10);
    const copy = structuredClone(observed);
    forecastHarvest({ ...ctx, crop: gddCrop(100), observed });
    expect(observed).toEqual(copy);
  });
});
