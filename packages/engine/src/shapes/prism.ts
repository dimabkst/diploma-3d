import type { PhysicalScale, PrismShape } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';
import { buildPrism, type PrismDimensions, type PrismProportions, prismDimensionsMm } from './prism-geometry.ts';
import { regularPolygonVertices } from './regular-polygon.ts';

/**
 * The prism over a regular polygon before scaling: the base with edge 1, centred at the origin with its first edge
 * along X below the centre, the height h0 = h/a and the upper base displaced by (dx0, dy0).
 */
export function regularPrismProportions(shape: PrismShape): PrismProportions {
  return {
    base: regularPolygonVertices(shape.baseSides),
    height: shape.heightRatio,
    offset: [shape.offsetXRatio, shape.offsetYRatio],
  };
}

export const regularPrismDimensionsMm = (shape: PrismShape, scale: PhysicalScale): PrismDimensions =>
  prismDimensionsMm(regularPrismProportions(shape), scale);

/** The prism in millimetres, with the base centre at the origin and the lower base in z = 0. */
export function buildRegularPrism(kernel: GeometryKernel, track: Track, shape: PrismShape, scale: PhysicalScale): Manifold {
  return buildPrism(kernel, track, regularPrismProportions(shape), scale);
}
