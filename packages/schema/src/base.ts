import { z } from 'zod';
import { baseAngleSchema } from './base-angle.ts';
import { ratioSchema } from './ratio.ts';

// Base polygons shared by prisms and pyramids. Each base is given relative to its reference edge a, so a solid's
// specification adds only its height and the position of its upper base or apex.

/** The triangle's or parallelogram's sides a and b = baseSideRatio·a with the angle α = baseAngleDeg between them. */
export const twoSidesAndAngleFields = {
  baseSideRatio: ratioSchema,
  baseAngleDeg: baseAngleSchema,
};

/** The triangle's defaults: b = a and α = 60°, an equilateral triangle. */
export const DEFAULT_TRIANGLE_BASE = { baseSideRatio: 1, baseAngleDeg: 60 } as const;

/** The parallelogram's defaults, as for the configurable parallelepiped: a rhombus with α = 60°. */
export const DEFAULT_PARALLELOGRAM_BASE = { baseSideRatio: 1, baseAngleDeg: 60 } as const;

// Practical application limits for the trapezoid's shift δ/a of side b relative to side a.
export const BASE_SHIFT_LIMITS = { min: -2, max: 2 } as const;

export const baseShiftSchema = z.number().min(BASE_SHIFT_LIMITS.min).max(BASE_SHIFT_LIMITS.max);

/**
 * The trapezoid's parallel sides a and b = parallelSideRatio·a at the distance t = baseHeightRatio·a within the base
 * plane, the midpoint of b displaced by δ = baseShiftRatio·a along X from that of a. Either parallel side may be the
 * longer one; b = a gives a parallelogram, and a rectangle when δ = 0.
 */
export const trapezoidFields = {
  parallelSideRatio: ratioSchema,
  baseHeightRatio: ratioSchema,
  baseShiftRatio: baseShiftSchema,
};

/** The trapezoid's defaults: b = a/2 and t = a/2, with side b centred over side a. */
export const DEFAULT_TRAPEZOID_BASE = { parallelSideRatio: 0.5, baseHeightRatio: 0.5, baseShiftRatio: 0 } as const;
