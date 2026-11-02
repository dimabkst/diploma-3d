import { z } from 'zod';
import { prismOffsetFields } from './offset.ts';
import { ratioSchema } from './ratio.ts';

// Practical application limits for the base angle, in degrees: they keep the parallelogram away from a degenerate,
// nearly flat base. The bounds are symmetric about 90°, so α and 180° − α (mirror-image bases) are both available.
export const BASE_ANGLE_LIMITS = { min: 15, max: 165 } as const;

export const baseAngleSchema = z.number().min(BASE_ANGLE_LIMITS.min).max(BASE_ANGLE_LIMITS.max);

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
