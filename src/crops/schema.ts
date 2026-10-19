import { z } from 'zod';

function sourced<T extends z.ZodTypeAny>(value: T) {
  return z
    .object({
      value,
      source: z.string().min(1).optional(),
      estimate: z.boolean().optional(),
    })
    .strict()
    .refine((v) => Boolean(v.source) || v.estimate === true, {
      message: 'needs a source or estimate: true',
    });
}

const week = z.number().int().min(1).max(53);
const weekWindow = z.object({ from: week, to: week }).strict();
/** One window, or several when a crop has two seasons (spring and autumn sowing). */
const weekWindows = z.union([weekWindow, z.array(weekWindow).min(1)]);
const positive = z.number().positive();
const firstHarvest = z
  .object({ days: z.number().int().positive(), from: z.enum(['sowing', 'transplant']) })
  .strict();

export const cropSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    family: z.string().min(1),
    sowUnderCover: sourced(weekWindows).optional(),
    sowDirect: sourced(weekWindows).optional(),
    transplant: sourced(weekWindows).optional(),
    tBaseC: sourced(z.number()).optional(),
    gdd: sourced(positive).optional(),
    daysToMaturity: sourced(positive).optional(),
    firstHarvestDays: sourced(firstHarvest).optional(),
    spacingCm: sourced(z.object({ inRow: positive, betweenRows: positive }).strict()).optional(),
    kc: sourced(z.object({ initial: positive, mid: positive, late: positive }).strict()).optional(),
    frostSensitive: z.boolean(),
    goodCompanions: z.array(z.string()),
    badCompanions: z.array(z.string()),
    seedLifespanYears: sourced(positive).optional(),
    successionDays: sourced(positive).optional(),
    maturitySigns: z.string().optional(),
  })
  .strict();

export type Crop = z.infer<typeof cropSchema>;
export type WeekWindow = z.infer<typeof weekWindow>;
export type WeekWindows = z.infer<typeof weekWindows>;
export type FirstHarvestDays = z.infer<typeof firstHarvest>;

export function windowsOf(windows: WeekWindows): WeekWindow[] {
  return Array.isArray(windows) ? windows : [windows];
}
export type Sourced<T> = { value: T; source?: string; estimate?: boolean };
