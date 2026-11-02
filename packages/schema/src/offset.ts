import { z } from 'zod';

// Practical application limits for the horizontal displacement of a prism's upper base relative to the base edge a.
export const OFFSET_LIMITS = { min: -2, max: 2 } as const;

/**
 * Displacement of the upper base along X or Y divided by a. A missing value means 0, so specifications written before
 * oblique prisms existed keep describing the same right prism.
 */
export const offsetRatioSchema = z.number().min(OFFSET_LIMITS.min).max(OFFSET_LIMITS.max).default(0);

/** The upper base is translated by (offsetXRatio, offsetYRatio)·a: X along the base edge a, Y across it in the base plane. */
export const prismOffsetFields = {
  offsetXRatio: offsetRatioSchema,
  offsetYRatio: offsetRatioSchema,
};
