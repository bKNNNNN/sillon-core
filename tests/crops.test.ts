import { describe, it, expect } from 'vitest';
import { getCrop, parseCrops } from '../src/index.js';

const BASE = '- id: x\n  name: X\n  family: f\n  frostSensitive: false\n  goodCompanions: []\n  badCompanions: []\n';

describe('crops knowledge base', () => {
  it('rejects a sourced value with neither source nor estimate', () => {
    expect(() => parseCrops(BASE + '  gdd: { value: 900 }\n')).toThrow(/x.*gdd/);
  });

  it('accepts a value with a source or an estimate flag', () => {
    const crops = parseCrops(BASE + '  gdd: { value: 900, estimate: true }\n  tBaseC: { value: 10, source: "ref" }\n');
    expect(crops[0].gdd?.value).toBe(900);
  });

  it('rejects week numbers out of range', () => {
    expect(() => parseCrops(BASE + '  sowDirect: { value: { from: 0, to: 54 }, estimate: true }\n')).toThrow(/x.*sowDirect/);
  });

  it('lists every invalid entry in one error', () => {
    const bad = BASE + '  gdd: { value: 1 }\n' + BASE.replace('id: x', 'id: y') + '  gdd: { value: 1 }\n';
    expect(() => parseCrops(bad)).toThrow(/x[\s\S]*y/);
  });

  it('rejects non-list yaml', () => {
    expect(() => parseCrops('a: 1')).toThrow();
  });

  it('rejects duplicate ids', () => {
    expect(() => parseCrops(BASE + BASE)).toThrow(/duplicate/i);
  });

  it('getCrop finds by id', () => {
    const crops = parseCrops(BASE + BASE.replace('id: x', 'id: tomate').replace('name: X', 'name: Tomate'));
    expect(getCrop(crops, 'tomate')?.name).toBe('Tomate');
    expect(getCrop(crops, 'nope')).toBeUndefined();
  });
});
