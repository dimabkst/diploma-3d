import type { PhysicalScale } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import { cross, length, subtract, type Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';
import { baseContours, polygonSize, signedPolygonArea, type Vec2 } from './polygon.ts';
import { shearMatrix } from './shear.ts';

/**
 * A pyramid over any base polygon, before scaling: the base in z = 0 with a0 = 1, counter-clockwise seen from +Z and
 * centred at its area centroid, the height h0 = h/a and the apex position (qx0, qy0) above the base plane, measured
 * from that centroid. The apex may lie above an edge, a vertex or outside the base.
 */
export interface PyramidProportions {
  readonly base: readonly Vec2[];
  readonly height: number;
  readonly apex: Vec2;
}

export const isApexCentred = ({ apex: [x, y] }: PyramidProportions): boolean => x === 0 && y === 0;

/**
 * The unscaled bounding box: the base's vertices and the apex's projection span it in X and Y, and h0 in Z. Unlike a
 * prism's box it is not widened by |qx0| or |qy0|: there is a single apex, not a translated upper base.
 */
export function pyramidBoundingSize({ base, height, apex }: PyramidProportions): Vec3 {
  const [width, depth] = polygonSize([...base, apex]);
  return [width, depth, height];
}

/** Millimetres per unit of a0: the longest bounding-box dimension of the complete pyramid becomes L. */
export const pyramidScaleMm = (pyramid: PyramidProportions, scale: PhysicalScale): number =>
  scale.longestDimensionMm / Math.max(...pyramidBoundingSize(pyramid));

export interface PyramidDimensions {
  /** Base edge a. */
  readonly edge: number;
  /** Height h: the perpendicular distance from the apex to the base plane. */
  readonly height: number;
  /** The apex A = (qx, qy, h), relative to the base centroid. */
  readonly apex: Vec3;
  readonly baseArea: number;
  readonly basePerimeter: number;
  /** |A − Bᵢ| for every base vertex Bᵢ, in base order. */
  readonly lateralEdges: readonly number[];
  /** The area of the face over the edge BᵢBᵢ₊₁, in base order. */
  readonly faceAreas: readonly number[];
  /** The distance from the apex to the line through BᵢBᵢ₊₁; its foot may lie outside the edge. */
  readonly faceHeights: readonly number[];
  readonly lateralArea: number;
  readonly surfaceArea: number;
  readonly volume: number;
}

/**
 * Physical dimensions. Each lateral face is the triangle BᵢBᵢ₊₁A with area |(Bᵢ₊₁ − Bᵢ) × (A − Bᵢ)| / 2 and height
 * 2·area / |Bᵢ₊₁ − Bᵢ|. With the apex off the centre the lateral edges and face heights differ, so no shared apothem
 * applies. The volume is base area × h / 3 wherever the apex lies.
 */
export function pyramidDimensionsMm(pyramid: PyramidProportions, scale: PhysicalScale): PyramidDimensions {
  const s = pyramidScaleMm(pyramid, scale);
  const base = pyramid.base.map(([x, y]): Vec3 => [x * s, y * s, 0]);
  const height = pyramid.height * s;
  const apex: Vec3 = [pyramid.apex[0] * s, pyramid.apex[1] * s, height];
  const faces = base.map((vertex, index) => {
    const edge = subtract(base[(index + 1) % base.length] as Vec3, vertex);
    const toApex = subtract(apex, vertex);
    const area = length(cross(edge, toApex)) / 2;
    return { edge: length(edge), lateralEdge: length(toApex), area, height: (2 * area) / length(edge) };
  });
  const baseArea = signedPolygonArea(base.map(([x, y]): Vec2 => [x, y]));
  const lateralArea = faces.reduce((sum, face) => sum + face.area, 0);
  return {
    edge: s,
    height,
    apex,
    baseArea,
    basePerimeter: faces.reduce((sum, face) => sum + face.edge, 0),
    lateralEdges: faces.map((face) => face.lateralEdge),
    faceAreas: faces.map((face) => face.area),
    faceHeights: faces.map((face) => face.height),
    lateralArea,
    surfaceArea: baseArea + lateralArea,
    volume: (baseArea * height) / 3,
  };
}

/**
 * The unscaled pyramid. Extruding the base while scaling its top to zero about the origin, the base centroid, makes
 * manifold-3d emit the base cap, the single apex vertex at (0, 0, h0) and the lateral triangles, with no degenerate top
 * face. A displaced apex is then reached by the shear that keeps the base plane fixed and moves z = h0 by (qx0, qy0).
 */
export function buildUnscaledPyramid(kernel: GeometryKernel, track: Track, pyramid: PyramidProportions): Manifold {
  const centred = track(kernel.Manifold.extrude(baseContours(pyramid.base), pyramid.height, 0, 0, [0, 0]));
  return isApexCentred(pyramid) ? centred : track(centred.transform(shearMatrix(pyramid.height, pyramid.apex)));
}

/** The pyramid in millimetres, uniformly scaled after positioning the apex; the base stays in z = 0. */
export function buildPyramid(kernel: GeometryKernel, track: Track, pyramid: PyramidProportions, scale: PhysicalScale): Manifold {
  return track(buildUnscaledPyramid(kernel, track, pyramid).scale(pyramidScaleMm(pyramid, scale)));
}
