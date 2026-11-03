import { parallelogramVertices } from './parallelogram.ts';
import type { Vec2 } from './polygon.ts';
import { regularPolygonVertices } from './regular-polygon.ts';
import { trapezoidLegs, trapezoidVertices } from './trapezoid.ts';
import { triangleThirdSide, triangleVertices } from './triangle.ts';

/** The base fields of a prism or pyramid specification, by base type; the schema's shapes match these structurally. */
export type BaseShape =
  | { readonly baseType: 'regular'; readonly baseSides: number }
  | { readonly baseType: 'triangle' | 'parallelogram'; readonly baseSideRatio: number; readonly baseAngleDeg: number }
  | {
      readonly baseType: 'trapezoid';
      readonly parallelSideRatio: number;
      readonly baseHeightRatio: number;
      readonly baseShiftRatio: number;
    };

/**
 * The base with its reference edge a0 = 1 along +X, counter-clockwise seen from +Z and centred at its area centroid:
 * the centre of a regular polygon or parallelogram, the centroid of a triangle or trapezoid.
 */
export function baseVertices(base: BaseShape): Vec2[] {
  switch (base.baseType) {
    case 'regular':
      return regularPolygonVertices(base.baseSides);
    case 'triangle':
      return triangleVertices(1, base.baseSideRatio, base.baseAngleDeg);
    case 'parallelogram':
      return parallelogramVertices(1, base.baseSideRatio, base.baseAngleDeg);
    case 'trapezoid':
      return trapezoidVertices(1, base.parallelSideRatio, base.baseHeightRatio, base.baseShiftRatio);
  }
}

/** The physical base sides besides a, and the trapezoid's height t; undefined where the base has no such side. */
export interface BaseSides {
  readonly b?: number;
  readonly c?: number;
  readonly d?: number;
  /** The trapezoid's height t: the distance between its parallel sides within the base plane. */
  readonly t?: number;
}

/** The sides of the base whose reference edge is a millimetres long. */
export function baseSidesMm(base: BaseShape, a: number): BaseSides {
  switch (base.baseType) {
    case 'regular':
      return {};
    case 'triangle': {
      const b = base.baseSideRatio * a;
      return { b, c: triangleThirdSide(a, b, base.baseAngleDeg) };
    }
    case 'parallelogram':
      return { b: base.baseSideRatio * a };
    case 'trapezoid': {
      const [b, t] = [base.parallelSideRatio * a, base.baseHeightRatio * a];
      return { b, ...trapezoidLegs(a, b, t, base.baseShiftRatio * a), t };
    }
  }
}
