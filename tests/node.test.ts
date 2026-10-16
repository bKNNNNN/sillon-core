import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCrops } from '../src/node/index.js';

const YAML = '- id: x\n  name: X\n  family: f\n  frostSensitive: false\n  goodCompanions: []\n  badCompanions: []\n';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('loadCrops', () => {
  it('reads and validates a crops file', () => {
    dir = mkdtempSync(join(tmpdir(), 'sillon-core-'));
    const file = join(dir, 'crops.yaml');
    writeFileSync(file, YAML);
    expect(loadCrops(file).map((c) => c.id)).toEqual(['x']);
  });

  it('throws on an invalid file', () => {
    dir = mkdtempSync(join(tmpdir(), 'sillon-core-'));
    const file = join(dir, 'crops.yaml');
    writeFileSync(file, YAML + '  gdd: { value: 900 }\n');
    expect(() => loadCrops(file)).toThrow(/x.*gdd/);
  });
});
