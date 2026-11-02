import { z } from 'zod';
import { baseAngleSchema } from './base-angle.ts';
import { prismOffsetFields } from './offset.ts';
import { ratioSchema } from './ratio.ts';

export const PRISM_BASE_SIDES = [3, 4, 5, 6, 8] as const;

export type PrismBaseSides = (typeof PRISM_BASE_SIDES)[number];

export const PRISM_BASE_TYPES = ['regular', 'triangle', 'trapezoid'] as const;

export type PrismBaseType = (typeof PRISM_BASE_TYPES)[number];

/** The configurable triangle's defaults: b = a and α = 60°, an equilateral triangle. */
export const DEFAULT_TRIANGLE_BASE = { baseSideRatio: 1, baseAngleDeg: 60 } as const;

// Practical application limits for the trapezoid's shift δ/a of side b relative to side a.
export const BASE_SHIFT_LIMITS = { min: -2, max: 2 } as const;

export const baseShiftSchema = z.number().min(BASE_SHIFT_LIMITS.min).max(BASE_SHIFT_LIMITS.max);

/** The configurable trapezoid's defaults: b = a/2 and t = a/2, with side b centred over side a. */
export const DEFAULT_TRAPEZOID_BASE = { parallelSideRatio: 0.5, baseHeightRatio: 0.5, baseShiftRatio: 0 } as const;

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
 * Prism over a trapezoid with the parallel sides a and b = parallelSideRatio·a at the distance t = baseHeightRatio·a
 * within the base plane, the midpoint of b displaced by δ = baseShiftRatio·a along X from that of a. Either parallel
 * side may be the longer one; b = a gives a parallelogram, and a rectangle when δ = 0.
 */
export const trapezoidPrismShapeSchema = z.strictObject({
  kind: z.literal('prism'),
  baseType: z.literal('trapezoid'),
  parallelSideRatio: ratioSchema,
  baseHeightRatio: ratioSchema,
  baseShiftRatio: baseShiftSchema,
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
