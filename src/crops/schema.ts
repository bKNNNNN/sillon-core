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
/** `note` qualifies one window in French, for example "sous voile" or "ail de printemps". */
const weekWindow = z.object({ from: week, to: week, note: z.string().min(1).max(40).optional() }).strict();
/** One window, or several when a crop has two seasons (spring and autumn sowing). */
const weekWindows = z.union([weekWindow, z.array(weekWindow).min(1)]);
const positive = z.number().positive();
const firstHarvest = z
  .object({ days: z.number().int().positive(), from: z.enum(['sowing', 'transplant']) })
  .strict();
/** One delay, or one per origin when a crop is both sown in place and transplanted. */
const firstHarvests = z.union([
  firstHarvest,
  z
    .array(firstHarvest)
    .min(1)
    .max(2)
    .refine((list) => new Set(list.map((f) => f.from)).size === list.length, {
      message: 'one entry per origin (sowing, transplant)',
    }),
]);
const cropId = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const cropSchema = z
  .object({
    id: cropId,
    /** Former ids that still resolve to this crop, so stored plantings stay valid. */
    aliases: z.array(cropId).min(1).optional(),
    name: z.string().min(1),
    family: z.string().min(1),
    sowUnderCover: sourced(weekWindows).optional(),
    sowDirect: sourced(weekWindows).optional(),
    transplant: sourced(weekWindows).optional(),
    tBaseC: sourced(z.number()).optional(),
    gdd: sourced(positive).optional(),
    daysToMaturity: sourced(positive).optional(),
    firstHarvestDays: sourced(firstHarvests).optional(),
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
export type FirstHarvestDaysList = z.infer<typeof firstHarvests>;

export function windowsOf(windows: WeekWindows): WeekWindow[] {
  return Array.isArray(windows) ? windows : [windows];
}
export function firstHarvestsOf(delays: FirstHarvestDaysList): FirstHarvestDays[] {
  return Array.isArray(delays) ? delays : [delays];
}

/** True when `species` is this crop's id or one of its aliases. */
export function isCrop(crop: Crop, species: string): boolean {
  return crop.id === species || (crop.aliases?.includes(species) ?? false);
}
export type Sourced<T> = { value: T; source?: string; estimate?: boolean };
