import { z } from 'zod';
import { baseAngleSchema } from './base-angle.ts';
import { prismOffsetFields } from './offset.ts';
import { ratioSchema } from './ratio.ts';

export const PRISM_BASE_SIDES = [3, 4, 5, 6, 8] as const;

export type PrismBaseSides = (typeof PRISM_BASE_SIDES)[number];

export const PRISM_BASE_TYPES = ['regular', 'triangle'] as const;

export type PrismBaseType = (typeof PRISM_BASE_TYPES)[number];

/** The configurable triangle's defaults: b = a and α = 60°, an equilateral triangle. */
export const DEFAULT_TRIANGLE_BASE = { baseSideRatio: 1, baseAngleDeg: 60 } as const;

/**
 * Prism over a regular polygon with `baseSides` edges of length a. The base type defaults to "regular", so
 * specifications written before other bases existed keep their meaning.
 */
export const regularPrismShapeSchema = z.strictObject({
  kind: z.literal('prism'),
  baseType: z.literal('regular').default('regular'),
  baseSides: z.literal(PRISM_BASE_SIDES),
  heightRatio: ratioSchema,
  ...prismOffsetFields,
});

/** Prism over a triangle with the sides a and b = baseSideRatio·a and the angle α = baseAngleDeg between them. */
export const trianglePrismShapeSchema = z.strictObject({
  kind: z.literal('prism'),
  baseType: z.literal('triangle'),
  baseSideRatio: ratioSchema,
  baseAngleDeg: baseAngleSchema,
  heightRatio: ratioSchema,
  ...prismOffsetFields,
});

/**
 * Prism with height h = heightRatio·a over the selected base, whose fields are validated for that base only. With zero
 * offsets the lateral edges are perpendicular to the bases; otherwise the upper base is displaced horizontally and the
 * prism is oblique.
 */
export const prismShapeSchema = z.discriminatedUnion('baseType', [regularPrismShapeSchema, trianglePrismShapeSchema]);

export type RegularPrismShape = z.infer<typeof regularPrismShapeSchema>;
export type TrianglePrismShape = z.infer<typeof trianglePrismShapeSchema>;
export type PrismShape = z.infer<typeof prismShapeSchema>;
