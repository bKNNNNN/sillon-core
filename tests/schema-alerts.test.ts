import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCrops } from '../src/index.js';

const BASE = '- id: x\n  name: X\n  family: f\n  frostSensitive: false\n  goodCompanions: []\n  badCompanions: []\n';
const withField = (yaml: string) => parseCrops(BASE + yaml);

describe('alert fields in the crop schema', () => {
  it('still parses the released cultures file, which has none of the new fields', () => {
    const text = readFileSync(new URL('./fixtures/cultures-v0.2.0.yaml', import.meta.url), 'utf8');
    expect(parseCrops(text).length).toBeGreaterThan(10);
  });

  it('accepts a sourced frost class', () => {
    const [c] = withField('  frostClass: { value: tender, source: "MSU Extension" }\n');
    expect(c.frostClass).toEqual({ value: 'tender', source: 'MSU Extension' });
  });

  it.each(['semi', 'hardy'])('accepts frost class %s', (cls) => {
    expect(withField(`  frostClass: { value: ${cls}, estimate: true }\n`)[0].frostClass?.value).toBe(cls);
  });

  it('rejects an unknown frost class', () => {
    expect(() => withField('  frostClass: { value: fragile, estimate: true }\n')).toThrow(/frostClass/);
  });

  it('rejects a frost class with neither source nor estimate', () => {
    expect(() => withField('  frostClass: { value: tender }\n')).toThrow(/source or estimate/);
  });

  it('accepts chillC, rootDepthM and depletionP', () => {
    const [c] = withField(
      '  chillC: { value: 5, source: S18 }\n  rootDepthM: { value: 0.7, source: FAO-56 }\n  depletionP: { value: 0.4, source: FAO-56 }\n',
    );
    expect(c.chillC?.value).toBe(5);
    expect(c.rootDepthM?.value).toBe(0.7);
    expect(c.depletionP?.value).toBe(0.4);
  });

  it.each([
    ['rootDepthM', 0],
    ['rootDepthM', 3.5],
    ['depletionP', 0],
    ['depletionP', 1],
  ])('rejects %s = %s', (field, value) => {
    expect(() => withField(`  ${field}: { value: ${value}, estimate: true }\n`)).toThrow(new RegExp(field));
  });

  it('accepts a full germination soil range', () => {
    const [c] = withField('  germSoilC: { value: { min: 10, optLow: 15.6, optHigh: 29.4, max: 35 }, source: OSU }\n');
    expect(c.germSoilC?.value).toEqual({ min: 10, optLow: 15.6, optHigh: 29.4, max: 35 });
  });

  it('accepts min and max only, as for cabbage', () => {
    const [c] = withField('  germSoilC: { value: { min: 4.4, max: 37.8 }, source: OSU }\n');
    expect(c.germSoilC?.value).toEqual({ min: 4.4, max: 37.8 });
  });

  it.each([
    ['only one optimum bound', '{ min: 4, optLow: 10, max: 30 }'],
    ['min above max', '{ min: 30, max: 10 }'],
    ['optimum outside the range', '{ min: 10, optLow: 5, optHigh: 20, max: 30 }'],
    ['optimum reversed', '{ min: 5, optLow: 25, optHigh: 20, max: 30 }'],
  ])('rejects a germination range with %s', (_label, value) => {
    expect(() => withField(`  germSoilC: { value: ${value}, estimate: true }\n`)).toThrow(/germSoilC/);
  });

  it('accepts FAO-56 table 11 stage lengths', () => {
    const [c] = withField(
      '  kcStages: { value: { method: fao56-table11, initDays: 30, devDays: 40, midDays: 40, lateDays: 25 }, source: FAO-56 table 11 }\n',
    );
    expect(c.kcStages?.value).toEqual({ method: 'fao56-table11', initDays: 30, devDays: 40, midDays: 40, lateDays: 25 });
  });

  it('accepts a GDD-fraction mapping when the crop has degree days', () => {
    const [c] = withField(
      '  gdd: { value: 1000, estimate: true }\n  kcStages: { value: { method: gdd-fraction, devFrom: 0.15, midFrom: 0.4, lateFrom: 0.8 }, estimate: true }\n',
    );
    expect(c.kcStages?.value).toEqual({ method: 'gdd-fraction', devFrom: 0.15, midFrom: 0.4, lateFrom: 0.8 });
  });

  it('rejects a GDD-fraction mapping on a crop without degree days', () => {
    expect(() =>
      withField('  kcStages: { value: { method: gdd-fraction, devFrom: 0.15, midFrom: 0.4, lateFrom: 0.8 }, estimate: true }\n'),
    ).toThrow(/kcStages gdd-fraction needs gdd/);
  });

  it.each([
    ['fractions not ascending', '{ method: gdd-fraction, devFrom: 0.5, midFrom: 0.4, lateFrom: 0.8 }'],
    ['a fraction of 1', '{ method: gdd-fraction, devFrom: 0.1, midFrom: 0.4, lateFrom: 1 }'],
    ['an unknown method', '{ method: guess, devFrom: 0.1, midFrom: 0.4, lateFrom: 0.8 }'],
    ['a zero stage length', '{ method: fao56-table11, initDays: 0, devDays: 40, midDays: 40, lateDays: 25 }'],
    ['a fractional stage length', '{ method: fao56-table11, initDays: 10.5, devDays: 40, midDays: 40, lateDays: 25 }'],
  ])('rejects kcStages with %s', (_label, value) => {
    expect(() => withField(`  gdd: { value: 1000, estimate: true }\n  kcStages: { value: ${value}, estimate: true }\n`)).toThrow(/kcStages/);
  });
});
