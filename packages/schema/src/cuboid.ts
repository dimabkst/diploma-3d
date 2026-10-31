import { z } from 'zod';
import { ratioSchema } from './ratio.ts';

/**
 * Rectangular cuboid with edges a, b, c along X, Y, Z (Z is the height) and all angles 90°. Its shape is given by two
 * independent proportions relative to a: widthRatio = b/a and heightRatio = c/a.
 */
export const cuboidShapeSchema = z.strictObject({
  kind: z.literal('cuboid'),
  widthRatio: ratioSchema,
  heightRatio: ratioSchema,
});

export type CuboidShape = z.infer<typeof cuboidShapeSchema>;
