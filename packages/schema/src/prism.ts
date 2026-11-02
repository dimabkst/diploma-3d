import { z } from 'zod';
import { prismOffsetFields } from './offset.ts';
import { ratioSchema } from './ratio.ts';

export const PRISM_BASE_SIDES = [3, 4, 5, 6, 8] as const;

export type PrismBaseSides = (typeof PRISM_BASE_SIDES)[number];

/**
 * Prism over a regular polygon with `baseSides` edges of length a and height h = heightRatio·a. With zero offsets the
 * lateral edges are perpendicular to the bases (a regular prism); otherwise the upper base is displaced horizontally
 * and the prism is oblique.
 */
export const prismShapeSchema = z.strictObject({
  kind: z.literal('prism'),
  baseSides: z.literal(PRISM_BASE_SIDES),
  heightRatio: ratioSchema,
  ...prismOffsetFields,
});

export type PrismShape = z.infer<typeof prismShapeSchema>;
