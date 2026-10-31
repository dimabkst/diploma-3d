import { z } from 'zod';
import { ratioSchema } from './ratio.ts';

export const PRISM_BASE_SIDES = [3, 4, 5, 6] as const;

export type PrismBaseSides = (typeof PRISM_BASE_SIDES)[number];

/**
 * Regular right prism: both bases are regular polygons with `baseSides` edges of length a, and the lateral edges are
 * perpendicular to them. Its shape is given by the base and one proportion, heightRatio = h/a.
 */
export const prismShapeSchema = z.strictObject({
  kind: z.literal('prism'),
  baseSides: z.literal(PRISM_BASE_SIDES),
  heightRatio: ratioSchema,
});

export type PrismShape = z.infer<typeof prismShapeSchema>;
