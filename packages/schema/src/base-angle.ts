import { z } from 'zod';

// Practical application limits for the angle α between the base sides a and b, in degrees, shared by the
// parallelogram and the triangle: they keep the base away from a degenerate, nearly flat shape. The bounds are
// symmetric about 90°, so α and 180° − α are both available. They are not meant to cover every possible base.
export const BASE_ANGLE_LIMITS = { min: 15, max: 165 } as const;

export const baseAngleSchema = z.number().min(BASE_ANGLE_LIMITS.min).max(BASE_ANGLE_LIMITS.max);
