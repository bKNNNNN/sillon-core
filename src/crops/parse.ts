import { parse } from 'yaml';
import { cropSchema, isCrop, type Crop } from './schema.js';

function describeId(entry: unknown, index: number): string {
  const id = (entry as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : `#${index}`;
}

export function parseCrops(yamlText: string): Crop[] {
  const raw: unknown = parse(yamlText);
  if (!Array.isArray(raw)) throw new Error('crops: expected a YAML list of crops');

  const crops: Crop[] = [];
  const errors: string[] = [];
  raw.forEach((entry, i) => {
    const result = cropSchema.safeParse(entry);
    if (result.success) {
      crops.push(result.data);
      return;
    }
    const id = describeId(entry, i);
    for (const issue of result.error.issues) {
      errors.push(`${id}: ${issue.path.join('.') || '(root)'} ${issue.message}`);
    }
  });

  for (const c of crops) {
    if (c.kcStages?.value.method === 'gdd-fraction' && !c.gdd) errors.push(`${c.id}: kcStages gdd-fraction needs gdd`);
  }

  const seen = new Set<string>();
  for (const c of crops) {
    if (seen.has(c.id)) errors.push(`${c.id}: duplicate id`);
    seen.add(c.id);
  }

  const owner = new Map<string, string>();
  for (const c of crops) {
    for (const alias of c.aliases ?? []) {
      if (seen.has(alias)) errors.push(`${c.id}: alias ${alias} is also a crop id`);
      const other = owner.get(alias);
      if (other) errors.push(`${c.id}: alias ${alias} already used by ${other}`);
      owner.set(alias, c.id);
    }
  }

  if (errors.length > 0) throw new Error(`Invalid crops:\n${errors.join('\n')}`);
  return crops;
}

export function getCrop(crops: Crop[], id: string): Crop | undefined {
  return crops.find((c) => c.id === id) ?? crops.find((c) => isCrop(c, id));
}
