import { z } from 'zod';
import { baseAngleSchema } from './base-angle.ts';
import { prismOffsetFields } from './offset.ts';
import { ratioSchema } from './ratio.ts';

/**
 * Parallelepiped: both bases are equal parallelograms with sides a and b and the angle α between them, at the distance
 * h = heightRatio·a. Its base is given by baseSideRatio = b/a and baseAngleDeg = α in degrees (α = 90° gives a
 * rectangle). With zero offsets it is a right parallelepiped; otherwise the upper base is displaced and it is oblique.
 */
export const parallelepipedShapeSchema = z.strictObject({
  kind: z.literal('parallelepiped'),
  baseSideRatio: ratioSchema,
  heightRatio: ratioSchema,
  baseAngleDeg: baseAngleSchema,
  ...prismOffsetFields,
});

export type ParallelepipedShape = z.infer<typeof parallelepipedShapeSchema>;
