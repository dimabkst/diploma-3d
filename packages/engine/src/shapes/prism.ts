import type { PhysicalScale, PrismShape, RegularPrismShape, TrianglePrismShape } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';
import { buildPrism, type PrismDimensions, type PrismProportions, prismDimensionsMm } from './prism-geometry.ts';
import { regularPolygonVertices } from './regular-polygon.ts';
import { triangleThirdSide, triangleVertices } from './triangle.ts';

/**
 * The prism over a regular polygon before scaling: the base with edge 1, centred at the origin with its first edge
 * along X below the centre, the height h0 = h/a and the upper base displaced by (dx0, dy0).
 */
export function regularPrismProportions(shape: RegularPrismShape): PrismProportions {
  return {
    base: regularPolygonVertices(shape.baseSides),
    height: shape.heightRatio,
    offset: [shape.offsetXRatio, shape.offsetYRatio],
  };
}

/**
 * The prism over a triangle before scaling: a0 = 1 along X, b0 = b/a at the angle α, centred at its centroid, the
 * height h0 = h/a and the upper base displaced by (dx0, dy0).
 */
export function trianglePrismProportions(shape: TrianglePrismShape): PrismProportions {
  return {
    base: triangleVertices(1, shape.baseSideRatio, shape.baseAngleDeg),
    height: shape.heightRatio,
    offset: [shape.offsetXRatio, shape.offsetYRatio],
  };
}

export const prismShapeProportions = (shape: PrismShape): PrismProportions =>
  shape.baseType === 'triangle' ? trianglePrismProportions(shape) : regularPrismProportions(shape);

export const regularPrismDimensionsMm = (shape: RegularPrismShape, scale: PhysicalScale): PrismDimensions =>
  prismDimensionsMm(regularPrismProportions(shape), scale);

export interface TrianglePrismDimensions extends PrismDimensions {
  readonly baseSideB: number;
  /** The third side, opposite α. */
  readonly baseSideC: number;
}

/**
 * Physical dimensions from the same uniform scale as the geometry: a is that scale (a0 = 1), b = (b/a)·a and c from the
 * cosine rule. A side may be longer than L: the 80 mm limit applies to the bounding box, not to edges.
 */
export function trianglePrismDimensionsMm(shape: TrianglePrismShape, scale: PhysicalScale): TrianglePrismDimensions {
  const dimensions = prismDimensionsMm(trianglePrismProportions(shape), scale);
  const b = shape.baseSideRatio * dimensions.edge;
  return { ...dimensions, baseSideB: b, baseSideC: triangleThirdSide(dimensions.edge, b, shape.baseAngleDeg) };
}

/** The prism in millimetres, with the base centre at the origin and the lower base in z = 0. */
export function buildPrismShape(kernel: GeometryKernel, track: Track, shape: PrismShape, scale: PhysicalScale): Manifold {
  return buildPrism(kernel, track, prismShapeProportions(shape), scale);
}
