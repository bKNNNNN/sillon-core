import type { FrostClass } from '../crops/schema.js';

/**
 * A threshold or delay used by an alert rule. `estimate: true` marks an agronomic judgment that
 * has no source yet; the UI must show it as an estimate. Every alert copies the parameters it used.
 */
export type Param = { value: number; unit: string; estimate: boolean; source?: string };
export type ParamSet = Record<string, Param>;

/** Alert families. Each module owns one kind: frost and chill here, the others in later releases. */
export type AlertKind = 'frost' | 'chill' | 'mildew' | 'water' | 'soil-temp' | 'heat' | 'slugs' | 'wind';

/** Frost levels from agronomy 2.2, strongest first: gel, fort, faible. */
export type FrostLevel = 'gel' | 'fort' | 'faible';

/** A crop named by an alert. */
export type AlertCrop = {
  species: string;
  name: string;
  frostClass?: FrostClass;
  /** Where the frost class came from: the crop's `frostClass`, or the legacy `frostSensitive` flag. */
  frostClassFrom?: 'frostClass' | 'frostSensitive';
};

/**
 * One alert. `date` is the day it is about (for a night, the evening date), `daysAhead` counts
 * from `today`. `reason` is the French text shown and sent. `inputs` holds every value the rule
 * read, including its parameters, so the UI can explain the alert and tests can check it.
 */
export type Alert<K extends AlertKind, L extends string, I extends { params: ParamSet }> = {
  kind: K;
  level: L;
  date: string;
  daysAhead: number;
  crops: AlertCrop[];
  reason: string;
  /** True when the rule that fired relies on at least one estimated parameter. */
  estimate: boolean;
  inputs: I;
};
