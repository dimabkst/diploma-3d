import type { PhysicalScale } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import { cross, length, type Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';
import { polygonSize, signedPolygonArea, type Vec2 } from './polygon.ts';

/**
 * A prism over any base polygon, before scaling: the base in z = 0 with a0 = 1, counter-clockwise seen from +Z, the
 * height h0 = h/a and the displacement (dx0, dy0) = (dx/a, dy/a) of the upper base. Zero displacement is a right prism.
 */
export interface PrismProportions {
  readonly base: readonly Vec2[];
  readonly height: number;
  readonly offset: Vec2;
}

export const isOblique = ({ offset: [dx, dy] }: PrismProportions): boolean => dx !== 0 || dy !== 0;

/**
 * The unscaled bounding box. Its vertices are those of the lower base and of the upper base, the same polygon moved by
 * (dx0, dy0), so it is the base's box widened by |dx0| and |dy0|; its height is h0.
 */
export function prismBoundingSize({ base, height, offset: [dx, dy] }: PrismProportions): Vec3 {
  const top = base.map(([x, y]): Vec2 => [x + dx, y + dy]);
  const [width, depth] = polygonSize([...base, ...top]);
  return [width, depth, height];
}

/** Millimetres per unit of a0: the longest bounding-box dimension of the complete, displaced solid becomes L. */
export const prismScaleMm = (prism: PrismProportions, scale: PhysicalScale): number =>
  scale.longestDimensionMm / Math.max(...prismBoundingSize(prism));

export interface PrismDimensions {
  /** Base edge a. */
  readonly edge: number;
  /** Height h: the perpendicular distance between the base planes, not the lateral edge. */
  readonly height: number;
  /** Displacement (dx, dy) of the upper base. */
  readonly offset: Vec2;
  /** Length of every lateral edge, |(dx, dy, h)|; equal to h only for a right prism. */
  readonly lateralEdge: number;
  readonly baseArea: number;
  readonly basePerimeter: number;
  readonly lateralArea: number;
  readonly surfaceArea: number;
  readonly volume: number;
}

/**
 * Physical dimensions. Each lateral face is the parallelogram spanned by a base edge e and the lateral edge
 * v = (dx, dy, h), with area |e × v|. For a right prism this is |e|·h, so the sum reduces to perimeter × h; for an
 * oblique one neither perimeter × h nor perimeter × |v| is correct in general. The volume is base area × h.
 */
export function prismDimensionsMm(prism: PrismProportions, scale: PhysicalScale): PrismDimensions {
  const s = prismScaleMm(prism, scale);
  const base = prism.base.map(([x, y]): Vec2 => [x * s, y * s]);
  const height = prism.height * s;
  const offset: Vec2 = [prism.offset[0] * s, prism.offset[1] * s];
  const lateral: Vec3 = [offset[0], offset[1], height];
  let basePerimeter = 0;
  let lateralArea = 0;
  base.forEach(([x, y], index) => {
    const [nextX, nextY] = base[(index + 1) % base.length] as Vec2;
    const edge: Vec3 = [nextX - x, nextY - y, 0];
    basePerimeter += length(edge);
    lateralArea += length(cross(edge, lateral));
  });
  const baseArea = signedPolygonArea(base);
  return {
    edge: s,
    height,
    offset,
    lateralEdge: length(lateral),
    baseArea,
    basePerimeter,
    lateralArea,
    surfaceArea: 2 * baseArea + lateralArea,
    volume: baseArea * height,
  };
}

/** The vertices before scaling: the lower base in z = 0, then the upper base, the same polygon moved by (dx0, dy0, h0). */
export function prismVertices({ base, height, offset: [dx, dy] }: PrismProportions): Vec3[] {
  return [...base.map(([x, y]): Vec3 => [x, y, 0]), ...base.map(([x, y]): Vec3 => [x + dx, y + dy, height])];
}

/** The unscaled prism: the convex hull of its vertices, every base being convex. */
export function buildUnscaledPrism(kernel: GeometryKernel, track: Track, prism: PrismProportions): Manifold {
  return track(kernel.Manifold.hull(prismVertices(prism).map(([x, y, z]): [number, number, number] => [x, y, z])));
}
