import type { PhysicalScale, PrismShape, RegularPrismShape, TrapezoidPrismShape, TrianglePrismShape } from '@diploma-3d/schema';
import { baseVertices } from './base.ts';
import { type PrismDimensions, type PrismProportions, prismDimensionsMm } from './prism-geometry.ts';
import { trapezoidLegs } from './trapezoid.ts';
import { triangleThirdSide } from './triangle.ts';

/**
 * The prism over a regular polygon before scaling: the base with edge 1, centred at the origin with its first edge
 * along X below the centre, the height h0 = h/a and the upper base displaced by (dx0, dy0).
 */
export function regularPrismProportions(shape: RegularPrismShape): PrismProportions {
  return {
    base: baseVertices(shape),
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
    base: baseVertices(shape),
    height: shape.heightRatio,
    offset: [shape.offsetXRatio, shape.offsetYRatio],
  };
}

/**
 * The prism over a trapezoid before scaling: a0 = 1 along X, b0 = b/a at the base height t0 = t/a with its midpoint
 * shifted by δ0 = δ/a, centred at its area centroid, the height h0 = h/a and the upper base displaced by (dx0, dy0).
 */
export function trapezoidPrismProportions(shape: TrapezoidPrismShape): PrismProportions {
  return {
    base: baseVertices(shape),
    height: shape.heightRatio,
    offset: [shape.offsetXRatio, shape.offsetYRatio],
  };
}

export function prismShapeProportions(shape: PrismShape): PrismProportions {
  switch (shape.baseType) {
    case 'regular':
      return regularPrismProportions(shape);
    case 'triangle':
      return trianglePrismProportions(shape);
    case 'trapezoid':
      return trapezoidPrismProportions(shape);
  }
}

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

export interface TrapezoidPrismDimensions extends PrismDimensions {
  readonly baseSideB: number;
  readonly baseSideC: number;
  readonly baseSideD: number;
  /** t: the distance between the parallel sides within the base plane, not the prism's height h. */
  readonly baseHeight: number;
  /** δ: the shift of the midpoint of b along X from that of a. */
  readonly baseShift: number;
}

/** Physical dimensions from the same uniform scale as the geometry: a is that scale and b, t and δ follow from it. */
export function trapezoidPrismDimensionsMm(shape: TrapezoidPrismShape, scale: PhysicalScale): TrapezoidPrismDimensions {
  const dimensions = prismDimensionsMm(trapezoidPrismProportions(shape), scale);
  const a = dimensions.edge;
  const [b, t, delta] = [shape.parallelSideRatio * a, shape.baseHeightRatio * a, shape.baseShiftRatio * a];
  const { c, d } = trapezoidLegs(a, b, t, delta);
  return { ...dimensions, baseSideB: b, baseSideC: c, baseSideD: d, baseHeight: t, baseShift: delta };
}
