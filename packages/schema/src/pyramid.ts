import { z } from 'zod';
import { ratioSchema } from './ratio.ts';

export const PYRAMID_BASE_SIDES = [3, 4, 5, 6, 8] as const;

export type PyramidBaseSides = (typeof PYRAMID_BASE_SIDES)[number];

/**
 * Regular pyramid: the base is a regular polygon with `baseSides` edges of length a, and the apex lies directly above
 * the base centre at the perpendicular height h. Its shape is given by the base and one proportion, heightRatio = h/a.
 */
export const pyramidShapeSchema = z.strictObject({
  kind: z.literal('pyramid'),
  baseSides: z.literal(PYRAMID_BASE_SIDES),
  heightRatio: ratioSchema,
});

export type PyramidShape = z.infer<typeof pyramidShapeSchema>;
