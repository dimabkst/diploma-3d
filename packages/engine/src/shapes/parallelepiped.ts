import type { ParallelepipedShape, PhysicalScale } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';
import { parallelogramVertices } from './parallelogram.ts';
import { buildPrism, type PrismDimensions, type PrismProportions, prismDimensionsMm } from './prism-geometry.ts';

/**
 * The parallelepiped before scaling: the parallelogram with a0 = 1, b0 = b/a and the angle α, centred at the origin
 * with AB along X, the height h0 = h/a and the upper base displaced by (dx0, dy0).
 */
export function parallelepipedProportions(shape: ParallelepipedShape): PrismProportions {
  return {
    base: parallelogramVertices(1, shape.baseSideRatio, shape.baseAngleDeg),
    height: shape.heightRatio,
    offset: [shape.offsetXRatio, shape.offsetYRatio],
  };
}

export interface ParallelepipedDimensions extends PrismDimensions {
  readonly baseSideB: number;
}

/**
 * Physical dimensions: a is 1 over the longest bounding-box dimension times L, which is not 1 over the longest edge (a
 * slanted side b is longer than its projections), and b = (b/a)·a.
 */
export function parallelepipedDimensionsMm(shape: ParallelepipedShape, scale: PhysicalScale): ParallelepipedDimensions {
  const dimensions = prismDimensionsMm(parallelepipedProportions(shape), scale);
  return { ...dimensions, baseSideB: shape.baseSideRatio * dimensions.edge };
}

/** The parallelepiped in millimetres, with the base centre at the origin and the lower base in z = 0. */
export function buildParallelepiped(
  kernel: GeometryKernel,
  track: Track,
  shape: ParallelepipedShape,
  scale: PhysicalScale,
): Manifold {
  return buildPrism(kernel, track, parallelepipedProportions(shape), scale);
}
