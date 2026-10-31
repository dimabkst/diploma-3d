import { z } from 'zod';

// Practical application limits for this version, not geometric ones; adjust them here only.
export const CUBOID_RATIO_LIMITS = { min: 0.25, max: 4 } as const;

export const cuboidRatioSchema = z.number().min(CUBOID_RATIO_LIMITS.min).max(CUBOID_RATIO_LIMITS.max);

/**
 * Rectangular cuboid with edges a, b, c along X, Y, Z (Z is the height) and all angles 90°. Its shape is given by two
 * independent proportions relative to a: widthRatio = b/a and heightRatio = c/a.
 */
export const cuboidShapeSchema = z.strictObject({
  kind: z.literal('cuboid'),
  widthRatio: cuboidRatioSchema,
  heightRatio: cuboidRatioSchema,
});

export type CuboidShape = z.infer<typeof cuboidShapeSchema>;
