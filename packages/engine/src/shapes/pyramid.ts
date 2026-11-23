import { type PhysicalScale, type PyramidShape, TETRAHEDRON_HEIGHT_RATIO, type TetrahedronShape } from '@diploma-3d/schema';
import { type BaseSides, baseSidesMm, baseVertices } from './base.ts';
import { type PyramidDimensions, type PyramidProportions, pyramidDimensionsMm } from './pyramid-geometry.ts';

/**
 * The regular tetrahedron as a pyramid: the equilateral triangle with the apex above its centroid at h = a·√(2/3), so
 * that the lateral edges equal the base edge.
 */
const tetrahedronAsPyramid = {
  baseType: 'regular',
  baseSides: 3,
  heightRatio: TETRAHEDRON_HEIGHT_RATIO,
  apexXRatio: 0,
  apexYRatio: 0,
} as const;

const asPyramid = (shape: PyramidShape | TetrahedronShape) => (shape.kind === 'tetrahedron' ? tetrahedronAsPyramid : shape);

/** The pyramid before scaling: the selected base with a0 = 1, h0 = h/a and the apex at (qx0, qy0) from its centroid. */
export function pyramidShapeProportions(shape: PyramidShape | TetrahedronShape): PyramidProportions {
  const pyramid = asPyramid(shape);
  return { base: baseVertices(pyramid), height: pyramid.heightRatio, apex: [pyramid.apexXRatio, pyramid.apexYRatio] };
}

export interface PyramidShapeDimensions extends PyramidDimensions {
  /** The base sides besides a, from the same uniform scale. */
  readonly sides: BaseSides;
}

export function pyramidShapeDimensionsMm(shape: PyramidShape | TetrahedronShape, scale: PhysicalScale): PyramidShapeDimensions {
  const dimensions = pyramidDimensionsMm(pyramidShapeProportions(shape), scale);
  return { ...dimensions, sides: baseSidesMm(asPyramid(shape), dimensions.edge) };
}
