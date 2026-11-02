import type { ParallelepipedShape, PhysicalScale } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';
import { parallelogramArea, parallelogramVertices } from './parallelogram.ts';
import { baseContours, polygonSize, type Vec2 } from './polygon.ts';

export interface ParallelepipedProportions {
  /** Base with a0 = 1 and b0 = b/a, centred at the origin and counter-clockwise seen from +Z. */
  readonly base: readonly Vec2[];
  /** h0 = h/a. */
  readonly height: number;
  /**
   * Model units per unit of a0: 1 over the longest dimension of the solid's axis-aligned bounding box, whose width and
   * depth are those of the base (1 + |b0·cos α| and b0·sin α) and whose height is h0. This is not 1 over the longest
   * edge: a slanted side b is longer than its projections onto X and Y.
   */
  readonly scale: number;
}

export function parallelepipedProportions(shape: ParallelepipedShape): ParallelepipedProportions {
  const base = parallelogramVertices(1, shape.baseSideRatio, shape.baseAngleDeg);
  return { base, height: shape.heightRatio, scale: 1 / Math.max(...polygonSize(base), shape.heightRatio) };
}

export interface ParallelepipedDimensions {
  readonly baseSideA: number;
  readonly baseSideB: number;
  readonly height: number;
  readonly baseArea: number;
  readonly basePerimeter: number;
  readonly surfaceArea: number;
  readonly volume: number;
}

/** Physical dimensions: a = s·L, b = (b/a)·a and h = (h/a)·a, with s from `parallelepipedProportions`. */
export function parallelepipedDimensionsMm(shape: ParallelepipedShape, scale: PhysicalScale): ParallelepipedDimensions {
  const a = parallelepipedProportions(shape).scale * scale.longestDimensionMm;
  const b = shape.baseSideRatio * a;
  const h = shape.heightRatio * a;
  const baseArea = parallelogramArea(a, b, shape.baseAngleDeg);
  const basePerimeter = 2 * (a + b);
  return {
    baseSideA: a,
    baseSideB: b,
    height: h,
    baseArea,
    basePerimeter,
    surfaceArea: 2 * baseArea + basePerimeter * h,
    volume: baseArea * h,
  };
}

/**
 * Right parallelepiped in millimetres: the unscaled base extruded along +Z from z = 0 to h0, with the top base equal to
 * the bottom one, then uniformly scaled to the export size. The base centre stays at the origin.
 */
export function buildParallelepiped(
  kernel: GeometryKernel,
  track: Track,
  shape: ParallelepipedShape,
  scale: PhysicalScale,
): Manifold {
  const { base, height, scale: unitScale } = parallelepipedProportions(shape);
  const unscaled = track(kernel.Manifold.extrude(baseContours(base), height));
  return track(unscaled.scale(unitScale * scale.longestDimensionMm));
}
