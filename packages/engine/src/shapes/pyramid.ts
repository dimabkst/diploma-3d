import { type PyramidShape, TETRAHEDRON_HEIGHT_RATIO, type TetrahedronShape } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';
import { baseContours, type RegularBaseParameters, regularBaseProportions } from './regular-base.ts';

/** The regular tetrahedron is the regular triangular pyramid whose lateral edges equal the base edge. */
export function pyramidParameters(shape: PyramidShape | TetrahedronShape): RegularBaseParameters {
  return shape.kind === 'tetrahedron' ? { baseSides: 3, heightRatio: TETRAHEDRON_HEIGHT_RATIO } : shape;
}

/**
 * Pyramid in model units: the base centred at the origin in z = 0 and the apex at (0, 0, h). Extruding the base while
 * scaling its top to zero about the origin, the base centre, makes manifold-3d emit the single apex vertex and the
 * lateral triangles, with no degenerate top face.
 */
export function buildUnitPyramid(kernel: GeometryKernel, track: Track, parameters: RegularBaseParameters): Manifold {
  const { base, height } = regularBaseProportions(parameters);
  return track(kernel.Manifold.extrude(baseContours(base), height, 0, 0, [0, 0]));
}
