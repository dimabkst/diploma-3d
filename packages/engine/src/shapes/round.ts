import type { ConeShape, CylinderShape, PhysicalScale } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Vec3 } from '../mesh.ts';
import { integrate } from '../numeric.ts';
import type { Track } from '../scope.ts';
import { shearMatrix } from './shear.ts';

export type RoundShape = CylinderShape | ConeShape;

/** Largest allowed distance between the ideal circle and the inscribed polygon that approximates it. */
export const MAX_CIRCLE_DEVIATION_MM = 0.05;

/**
 * Segments of the base circle at the default 80 mm export size, where r ≤ 40 mm: the inscribed 64-gon deviates from the
 * circle by at most r·(1 − cos(π/64)) ≈ 0.0482 mm.
 */
export const CIRCULAR_SEGMENTS = 64;

/**
 * The number of circle segments for radius r: at least CIRCULAR_SEGMENTS, and enough for r·(1 − cos(π/N)) ≤
 * MAX_CIRCLE_DEVIATION_MM at larger export sizes, i.e. N ≥ π / arccos(1 − limit/r). N is a multiple of four, so that the
 * polygon has vertices on both axes and its bounding box is exactly 2r × 2r. The shear of an oblique solid moves every
 * horizontal section, ideal and polygonal alike, by the same amount, so it does not change this deviation.
 */
export function circularSegments(radiusMm: number): number {
  if (!(radiusMm > 0) || !Number.isFinite(radiusMm)) throw new RangeError(`Invalid circle radius: ${radiusMm}.`);
  const required = Math.PI / Math.acos(1 - Math.min(1, MAX_CIRCLE_DEVIATION_MM / radiusMm));
  return Math.max(CIRCULAR_SEGMENTS, 4 * Math.ceil(required / 4));
}

/**
 * The unscaled bounding box with r0 = 1: the base circle spans [−1, 1] in X and Y; the cylinder's upper circle spans
 * [d0 − 1, d0 + 1] in X and the cone's apex is the point d0. For d0 ≥ 0 that is 2 + d0 or max(2, 1 + d0) wide.
 */
export function roundBoundingSize(shape: RoundShape): Vec3 {
  const topRadius = shape.kind === 'cylinder' ? 1 : 0;
  const width = Math.max(1, shape.offsetRatio + topRadius) - Math.min(-1, shape.offsetRatio - topRadius);
  return [width, 2, shape.heightRatio];
}

export interface RoundDimensions {
  readonly radius: number;
  readonly height: number;
  /** The displacement d of the upper base's centre or the apex along X. */
  readonly offset: number;
}

/** r, h and d in millimetres, from the one scale that makes the longest side of the displaced solid's box L. */
export function roundDimensionsMm(shape: RoundShape, scale: PhysicalScale): RoundDimensions {
  const radius = scale.longestDimensionMm / Math.max(...roundBoundingSize(shape));
  return { radius, height: shape.heightRatio * radius, offset: shape.offsetRatio * radius };
}

export interface RoundSolidMeasurements {
  readonly radius: number;
  readonly diameter: number;
  readonly height: number;
  readonly offset: number;
  /** The shortest and longest generatrix: equal for the cylinder and the right cone. */
  readonly generatrix: { readonly min: number; readonly max: number };
  readonly baseArea: number;
  readonly lateralArea: number;
  readonly surfaceArea: number;
  readonly volume: number;
  /** The lateral area of an oblique solid comes from numerical integration rather than a closed form. */
  readonly lateralAreaIntegrated: boolean;
}

// Far below the displayed 0,1 mm²: an absolute 1e-4 mm² plus a relative 1e-8.
const AREA_TOLERANCE = { absoluteTolerance: 1e-4, relativeTolerance: 1e-8 } as const;

/**
 * The lateral area of the ideal solid. Over the base point at angle θ the generatrix runs to the same point of the
 * upper circle (cylinder) or to the apex (cone). The cylinder's lateral surface is swept by the vector v = (d, 0, h)
 * along the circle, so its area element is |r·(−sin θ, cos θ, 0) × v| dθ = r·√(h² + d² cos² θ) dθ. The cone's is the
 * triangle between the apex and an arc element, (r/2)·√(h² + (r − d cos θ)²) dθ. With d = 0 they reduce to the closed
 * forms 2πrh and πr·√(h² + r²), which are used then.
 */
function lateralArea(kind: RoundShape['kind'], { radius: r, height: h, offset: d }: RoundDimensions): number {
  if (d === 0) return kind === 'cylinder' ? 2 * Math.PI * r * h : Math.PI * r * Math.hypot(h, r);
  const element =
    kind === 'cylinder'
      ? (theta: number) => r * Math.hypot(h, d * Math.cos(theta))
      : (theta: number) => (r / 2) * Math.hypot(h, r - d * Math.cos(theta));
  return integrate(element, 0, 2 * Math.PI, AREA_TOLERANCE);
}

/**
 * Measurements of the ideal curved solid, which the exported polygonal approximation slightly undershoots. The shear
 * keeps every horizontal section's area, so the volume is that of the right solid: πr²h or πr²h/3. A cone's generatrix
 * to the base point at angle θ is √(h² + r² + d² − 2rd cos θ): shortest at θ = 0, √(h² + (r − d)²), and longest at
 * θ = π, √(h² + (r + d)²).
 */
export function roundSolidMeasurements(shape: RoundShape, scale: PhysicalScale): RoundSolidMeasurements {
  const dimensions = roundDimensionsMm(shape, scale);
  const { radius: r, height: h, offset: d } = dimensions;
  const baseArea = Math.PI * r ** 2;
  const lateral = lateralArea(shape.kind, dimensions);
  const shared = {
    radius: r,
    diameter: 2 * r,
    height: h,
    offset: d,
    baseArea,
    lateralArea: lateral,
    lateralAreaIntegrated: d !== 0,
  };
  if (shape.kind === 'cylinder') {
    const generatrix = Math.hypot(h, d);
    return {
      ...shared,
      generatrix: { min: generatrix, max: generatrix },
      surfaceArea: 2 * baseArea + lateral,
      volume: baseArea * h,
    };
  }
  return {
    ...shared,
    generatrix: { min: Math.hypot(h, r - d), max: Math.hypot(h, r + d) },
    surfaceArea: baseArea + lateral,
    volume: (baseArea * h) / 3,
  };
}

/**
 * Cylinder or cone in millimetres with `segments` circle segments, the base centred at the origin in z = 0. Built by
 * manifold-3d as a right solid and, for d ≠ 0, sheared by x' = x + (d/h)·z: the base circle stays, the upper circle's
 * centre or the apex moves to (d, 0, h), and every section keeps its circle. Rotating a right solid would tilt its
 * base instead.
 */
export function buildRound(
  kernel: GeometryKernel,
  track: Track,
  kind: RoundShape['kind'],
  { radius, height, offset }: RoundDimensions,
  segments: number,
): Manifold {
  const right = track(kernel.Manifold.cylinder(height, radius, kind === 'cone' ? 0 : radius, segments, false));
  return offset === 0 ? right : track(right.transform(shearMatrix(height, [offset, 0])));
}

/**
 * The cylinder or cone at its physical size: unlike polyhedra it is built in millimetres, because the segment count
 * depends on the physical radius.
 */
export function buildRoundSolid(kernel: GeometryKernel, track: Track, shape: RoundShape, scale: PhysicalScale): Manifold {
  const dimensions = roundDimensionsMm(shape, scale);
  return buildRound(kernel, track, shape.kind, dimensions, circularSegments(dimensions.radius));
}

/** The shear (d/h, 0) that turns the right solid into this one, for shading its curved side. */
export const roundShear = (shape: RoundShape): readonly [number, number] => [shape.offsetRatio / shape.heightRatio, 0];
