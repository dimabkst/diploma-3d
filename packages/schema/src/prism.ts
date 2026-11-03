import { z } from 'zod';
import { trapezoidFields, twoSidesAndAngleFields } from './base.ts';
import { prismOffsetFields } from './offset.ts';
import { ratioSchema } from './ratio.ts';

export const PRISM_BASE_SIDES = [3, 4, 5, 6, 8] as const;

export type PrismBaseSides = (typeof PRISM_BASE_SIDES)[number];

export const PRISM_BASE_TYPES = ['regular', 'triangle', 'trapezoid'] as const;

export type PrismBaseType = (typeof PRISM_BASE_TYPES)[number];

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
  ...twoSidesAndAngleFields,
  heightRatio: ratioSchema,
  ...prismOffsetFields,
});

/** Prism over a trapezoid; see `trapezoidFields`. */
export const trapezoidPrismShapeSchema = z.strictObject({
  kind: z.literal('prism'),
  baseType: z.literal('trapezoid'),
  ...trapezoidFields,
  heightRatio: ratioSchema,
  ...prismOffsetFields,
});

/**
 * Prism with height h = heightRatio·a over the selected base, whose fields are validated for that base only. With zero
 * offsets the lateral edges are perpendicular to the bases; otherwise the upper base is displaced horizontally and the
 * prism is oblique.
 */
export const prismShapeSchema = z.discriminatedUnion('baseType', [
  regularPrismShapeSchema,
  trianglePrismShapeSchema,
  trapezoidPrismShapeSchema,
]);

export type RegularPrismShape = z.infer<typeof regularPrismShapeSchema>;
export type TrianglePrismShape = z.infer<typeof trianglePrismShapeSchema>;
export type TrapezoidPrismShape = z.infer<typeof trapezoidPrismShapeSchema>;
export type PrismShape = z.infer<typeof prismShapeSchema>;
