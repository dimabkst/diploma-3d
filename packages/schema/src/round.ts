import { z } from 'zod';
import { roundHeightRatioSchema } from './ratio.ts';

// Practical application limits for d/r. The displacement runs along +X only: any other horizontal direction gives the
// same ideal solid rotated about the vertical axis. The lean is further limited by MIN_INCLINATION_DEG.
export const ROUND_OFFSET_LIMITS = { min: 0, max: 4 } as const;

/** d/r, where d is the displacement of the cylinder's upper base or the cone's apex; missing means 0, a right solid. */
export const roundOffsetSchema = z.number().min(ROUND_OFFSET_LIMITS.min).max(ROUND_OFFSET_LIMITS.max).default(0);

/**
 * Circular cylinder: two equal circular bases of radius r in parallel planes at the perpendicular distance
 * h = heightRatio·r, the upper one displaced by d = offsetRatio·r along X. With d = 0 it is a right cylinder.
 */
export const cylinderShapeSchema = z.strictObject({
  kind: z.literal('cylinder'),
  heightRatio: roundHeightRatioSchema,
  offsetRatio: roundOffsetSchema,
});

export type CylinderShape = z.infer<typeof cylinderShapeSchema>;

/**
 * Circular cone: a circular base of radius r and the apex at the perpendicular height h = heightRatio·r, displaced by
 * d = offsetRatio·r along X from above the base centre. With d = 0 it is a right cone.
 */
export const coneShapeSchema = z.strictObject({
  kind: z.literal('cone'),
  heightRatio: roundHeightRatioSchema,
  offsetRatio: roundOffsetSchema,
});

export type ConeShape = z.infer<typeof coneShapeSchema>;
