import type { PhysicalScale, PrismShape } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';
import { regularPolygonVertices, type Vec2 } from './regular-polygon.ts';

export interface PrismProportions {
  /** Base polygon in model units, counter-clockwise seen from +Z. */
  readonly base: readonly Vec2[];
  /** Base edge a in model units. */
  readonly edge: number;
  /** Height h in model units. */
  readonly height: number;
}

/**
 * The prism built with base edge a0 = 1 and height h0 = h/a, uniformly scaled so that the longest dimension of its
 * axis-aligned bounding box is 1. The base's width and depth are taken from its actual vertices: they differ from the
 * circumcircle diameter except for the hexagon's width.
 */
export function prismProportions(shape: PrismShape): PrismProportions {
  const base = regularPolygonVertices(shape.baseSides);
  const extent = (axis: 0 | 1) =>
    Math.max(...base.map((vertex) => vertex[axis])) - Math.min(...base.map((vertex) => vertex[axis]));
  const scale = 1 / Math.max(extent(0), extent(1), shape.heightRatio);
  return {
    base: base.map(([x, y]): Vec2 => [x * scale, y * scale]),
    edge: scale,
    height: shape.heightRatio * scale,
  };
}

/** Base edge a and height h in millimetres. */
export function prismDimensionsMm(shape: PrismShape, scale: PhysicalScale): { readonly edge: number; readonly height: number } {
  const { edge, height } = prismProportions(shape);
  return { edge: edge * scale.longestDimensionMm, height: height * scale.longestDimensionMm };
}

/** Prism in model units: the base centred at the origin in z = 0, extruded along +Z. */
export function buildUnitPrism(kernel: GeometryKernel, track: Track, shape: PrismShape): Manifold {
  const { base, height } = prismProportions(shape);
  return track(kernel.Manifold.extrude([base.map(([x, y]): [number, number] => [x, y])], height));
}
