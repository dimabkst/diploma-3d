import { z } from 'zod';

// Practical application limits for the apex position relative to a. They are wider than the prism offsets because the
// apex is measured from the base centroid, which may be far from the outline of an asymmetric base, and the apex may
// also lie outside the base.
export const APEX_LIMITS = { min: -4, max: 4 } as const;

/**
 * The apex coordinate along X or Y relative to the base's area centroid, divided by a. A missing value means 0, so
 * specifications written before the apex could move keep their apex above the base centre.
 */
export const apexRatioSchema = z.number().min(APEX_LIMITS.min).max(APEX_LIMITS.max).default(0);

/** X along the reference base edge a, Y across it in the base plane. */
export const pyramidApexFields = {
  apexXRatio: apexRatioSchema,
  apexYRatio: apexRatioSchema,
};
