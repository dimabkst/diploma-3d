import { offsetRatioSchema } from './offset.ts';

/**
 * The apex coordinate along X or Y relative to the base's area centroid, divided by a, within TILT_OFFSET_LIMITS. A
 * missing value means 0, so specifications written before the apex could move keep their apex above the base centre.
 */
export const apexRatioSchema = offsetRatioSchema;

/** X along the reference base edge a, Y across it in the base plane. */
export const pyramidApexFields = {
  apexXRatio: apexRatioSchema,
  apexYRatio: apexRatioSchema,
};
