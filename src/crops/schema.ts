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
const positive = z.number().positive();

export const cropSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    family: z.string().min(1),
    sowUnderCover: sourced(weekWindow).optional(),
    sowDirect: sourced(weekWindow).optional(),
    transplant: sourced(weekWindow).optional(),
    tBaseC: sourced(z.number()).optional(),
    gdd: sourced(positive).optional(),
    daysToMaturity: sourced(positive).optional(),
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
export type Sourced<T> = { value: T; source?: string; estimate?: boolean };
