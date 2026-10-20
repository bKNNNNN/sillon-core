import { describe, expect, it } from 'vitest';
import { firstHarvestsOf, forecastFirstHarvest, getCrop, parseCrops, rotationWarning, whatsNext } from '../src/index.js';
import type { Crop } from '../src/index.js';
import { baseCrop, basePlanting } from './fixtures.js';

const BASE = '- id: x\n  name: X\n  family: f\n  frostSensitive: false\n  goodCompanions: []\n  badCompanions: []\n';

describe('window notes', () => {
  it('accepts a short note on a window', () => {
    const crops = parseCrops(BASE + '  sowDirect: { value: [{ from: 6, to: 10, note: sous voile }, { from: 11, to: 17 }], estimate: true }\n');
    expect(crops[0].sowDirect?.value).toEqual([{ from: 6, to: 10, note: 'sous voile' }, { from: 11, to: 17 }]);
  });

  it('rejects an empty or overlong note', () => {
    expect(() => parseCrops(BASE + '  sowDirect: { value: { from: 6, to: 10, note: "" }, estimate: true }\n')).toThrow(/sowDirect/);
    const long = 'a'.repeat(41);
    expect(() => parseCrops(BASE + `  sowDirect: { value: { from: 6, to: 10, note: ${long} }, estimate: true }\n`)).toThrow(/sowDirect/);
  });

  it('names the note in the weekly reason', () => {
    const c: Crop = { ...baseCrop, sowDirect: { value: [{ from: 6, to: 10, note: 'sous voile' }], estimate: true } };
    const r = whatsNext([c], [], '2026-02-10');
    expect(r).toEqual([expect.objectContaining({ action: 'sow_direct', reason: 'Fenêtre de semis direct (sous voile) : semaines 6 à 10.' })]);
  });
});

describe('aliases', () => {
  const yaml =
    BASE.replace('id: x', 'id: chou-ete').replace('family: f', 'family: brassicacees') + '  aliases: [chou]\n' +
    BASE.replace('id: x', 'id: chou-hiver').replace('family: f', 'family: brassicacees');

  it('getCrop resolves an alias to its crop', () => {
    const crops = parseCrops(yaml);
    expect(getCrop(crops, 'chou')?.id).toBe('chou-ete');
    expect(getCrop(crops, 'chou-hiver')?.id).toBe('chou-hiver');
  });

  it('rejects an alias that is also an id', () => {
    expect(() => parseCrops(yaml.replace('aliases: [chou]', 'aliases: [chou-hiver]'))).toThrow(/alias/);
  });

  it('rejects an alias used by two crops', () => {
    expect(() => parseCrops(yaml + '  aliases: [chou]\n')).toThrow(/alias/);
  });

  it('rejects a malformed alias', () => {
    expect(() => parseCrops(yaml.replace('aliases: [chou]', 'aliases: [Chou]'))).toThrow(/aliases/);
  });

  it('counts a planting stored under the alias for the weekly plan', () => {
    const c: Crop = { ...baseCrop, id: 'chou-ete', aliases: ['chou'], transplant: undefined, sowDirect: { value: { from: 10, to: 20 }, estimate: true } };
    const stored = { ...basePlanting, species: 'chou', sownOn: '2026-04-01' };
    expect(whatsNext([c], [stored], '2026-04-08')).toEqual([]);
  });

  it('warns on rotation when history uses the alias', () => {
    const crops = parseCrops(yaml);
    const history = [{ species: 'chou', sownOn: '2025-04-01' }];
    expect(rotationWarning(history, 'chou-hiver', '2026-09-01', crops)).toMatch(/Brassicacées/);
    expect(rotationWarning([{ species: 'chou-hiver', sownOn: '2025-09-01' }], 'chou', '2026-04-01', crops)).toMatch(/Brassicacées/);
  });
});

describe('firstHarvestDays from sowing and from transplant', () => {
  const both: Crop = {
    ...baseCrop,
    firstHarvestDays: { value: [{ days: 60, from: 'sowing' }, { days: 35, from: 'transplant' }], estimate: true },
  };

  it('parses a list with one entry per origin', () => {
    const crops = parseCrops(BASE + '  firstHarvestDays: { value: [{ days: 60, from: sowing }, { days: 35, from: transplant }], estimate: true }\n');
    expect(firstHarvestsOf(crops[0].firstHarvestDays!.value)).toHaveLength(2);
  });

  it('rejects two entries with the same origin', () => {
    expect(() => parseCrops(BASE + '  firstHarvestDays: { value: [{ days: 60, from: sowing }, { days: 50, from: sowing }], estimate: true }\n')).toThrow(/firstHarvestDays/);
  });

  it('uses the sowing delay for a direct sowing', () => {
    expect(forecastFirstHarvest({ ...basePlanting, method: 'direct', sownOn: '2026-05-01' }, both)?.expected).toBe('2026-06-30');
  });

  it('uses the transplant delay for a bought plant', () => {
    expect(forecastFirstHarvest({ ...basePlanting, method: 'bought', sownOn: '2026-05-10' }, both)?.expected).toBe('2026-06-14');
  });

  it('uses the transplant delay once a pot sowing is transplanted', () => {
    const p = { ...basePlanting, method: 'pot' as const, sownOn: '2026-04-10', transplantedOn: '2026-05-10' };
    expect(forecastFirstHarvest(p, both)?.expected).toBe('2026-06-14');
  });

  it('falls back to the sowing delay for a pot not yet transplanted', () => {
    expect(forecastFirstHarvest({ ...basePlanting, method: 'pot', sownOn: '2026-04-10' }, both)?.expected).toBe('2026-06-09');
  });
});
