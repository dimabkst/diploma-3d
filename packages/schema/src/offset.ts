import { z } from 'zod';

// Practical application limits for each horizontal displacement of a prism's upper base or a pyramid's apex, relative to
// the base edge a. The lean is further limited by MIN_INCLINATION_DEG; see `tilt.ts`.
export const TILT_OFFSET_LIMITS = { min: -4, max: 4 } as const;

/**
 * Displacement along X or Y divided by a. A missing value means 0, so specifications written before oblique prisms
 * existed keep describing the same right prism.
 */
export const offsetRatioSchema = z.number().min(TILT_OFFSET_LIMITS.min).max(TILT_OFFSET_LIMITS.max).default(0);

/** The upper base is translated by (offsetXRatio, offsetYRatio)·a: X along the base edge a, Y across it in the base plane. */
export const prismOffsetFields = {
  offsetXRatio: offsetRatioSchema,
  offsetYRatio: offsetRatioSchema,
};
