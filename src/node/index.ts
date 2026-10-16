import { readFileSync } from 'node:fs';
import { parseCrops } from '../crops/parse.js';
import type { Crop } from '../crops/schema.js';

/** Reads and validates a crops YAML file. Node only. */
export function loadCrops(filePath: string): Crop[] {
  return parseCrops(readFileSync(filePath, 'utf8'));
}
