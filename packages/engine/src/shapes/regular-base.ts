import type { PhysicalScale } from '@diploma-3d/schema';
import { polygonSize, type Vec2 } from './polygon.ts';
import { regularPolygonVertices } from './regular-polygon.ts';

/** A solid over a regular base, such as a regular prism or pyramid: the number of base sides and h/a. */
export interface RegularBaseParameters {
  readonly baseSides: number;
  readonly heightRatio: number;
}

export interface RegularBaseProportions {
  /** Base polygon in model units, centred at the origin and counter-clockwise seen from +Z. */
  readonly base: readonly Vec2[];
  /** Base edge a in model units. */
  readonly edge: number;
  /** Height h in model units. */
  readonly height: number;
}

/**
 * The solid built with base edge a0 = 1 and height h0 = h/a, uniformly scaled so that the longest dimension of its
 * axis-aligned bounding box is 1. That box spans the base in X and Y (a pyramid's apex above the centre lies within it)
 * and h0 in Z. The base's width and depth are taken from its actual vertices: they differ from the circumcircle
 * diameter except for the hexagon's width.
 */
export function regularBaseProportions({ baseSides, heightRatio }: RegularBaseParameters): RegularBaseProportions {
  const base = regularPolygonVertices(baseSides);
  const scale = 1 / Math.max(...polygonSize(base), heightRatio);
  return {
    base: base.map(([x, y]): Vec2 => [x * scale, y * scale]),
    edge: scale,
    height: heightRatio * scale,
  };
}

/** Base edge a and height h in millimetres. */
export function regularBaseDimensionsMm(
  parameters: RegularBaseParameters,
  scale: PhysicalScale,
): { readonly edge: number; readonly height: number } {
  const { edge, height } = regularBaseProportions(parameters);
  return { edge: edge * scale.longestDimensionMm, height: height * scale.longestDimensionMm };
}
