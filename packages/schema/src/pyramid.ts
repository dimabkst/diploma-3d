import { z } from 'zod';
import { pyramidApexFields } from './apex.ts';
import { trapezoidFields, twoSidesAndAngleFields } from './base.ts';
import { ratioSchema } from './ratio.ts';

export const PYRAMID_BASE_SIDES = [3, 4, 5, 6, 8] as const;

export type PyramidBaseSides = (typeof PYRAMID_BASE_SIDES)[number];

export const PYRAMID_BASE_TYPES = ['regular', 'triangle', 'parallelogram', 'trapezoid'] as const;

export type PyramidBaseType = (typeof PYRAMID_BASE_TYPES)[number];

// Every pyramid: h = heightRatio·a is the perpendicular distance from the apex to the base plane, and the apex lies
// at (apexXRatio, apexYRatio)·a from the base's area centroid.
const pyramidFields = { kind: z.literal('pyramid'), heightRatio: ratioSchema, ...pyramidApexFields };

/**
 * Pyramid over a regular polygon with `baseSides` edges of length a; with the apex above the base centre it is a
 * regular pyramid. The base type defaults to "regular", so earlier specifications keep their meaning.
 */
export const regularPyramidShapeSchema = z.strictObject({
  ...pyramidFields,
  baseType: z.literal('regular').default('regular'),
  baseSides: z.literal(PYRAMID_BASE_SIDES),
});

export const trianglePyramidShapeSchema = z.strictObject({
  ...pyramidFields,
  baseType: z.literal('triangle'),
  ...twoSidesAndAngleFields,
});

export const parallelogramPyramidShapeSchema = z.strictObject({
  ...pyramidFields,
  baseType: z.literal('parallelogram'),
  ...twoSidesAndAngleFields,
});

export const trapezoidPyramidShapeSchema = z.strictObject({
  ...pyramidFields,
  baseType: z.literal('trapezoid'),
  ...trapezoidFields,
});

/** Pyramid over the selected base, whose fields are validated for that base only. */
export const pyramidShapeSchema = z.discriminatedUnion('baseType', [
  regularPyramidShapeSchema,
  trianglePyramidShapeSchema,
  parallelogramPyramidShapeSchema,
  trapezoidPyramidShapeSchema,
]);

export type PyramidShape = z.infer<typeof pyramidShapeSchema>;
export type RegularPyramidShape = z.infer<typeof regularPyramidShapeSchema>;
