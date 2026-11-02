import type { ConeShape, CylinderShape, PhysicalScale } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';

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
 * polygon has vertices on both axes and its bounding box is exactly 2r × 2r.
 */
export function circularSegments(radiusMm: number): number {
  if (!(radiusMm > 0) || !Number.isFinite(radiusMm)) throw new RangeError(`Invalid circle radius: ${radiusMm}.`);
  const required = Math.PI / Math.acos(1 - Math.min(1, MAX_CIRCLE_DEVIATION_MM / radiusMm));
  return Math.max(CIRCULAR_SEGMENTS, 4 * Math.ceil(required / 4));
}

/** Radius r and height h in millimetres: r = L / max(2, h/r), so the 2r × 2r × h bounding box has L as its longest side. */
export function roundDimensionsMm(shape: RoundShape, scale: PhysicalScale): { readonly radius: number; readonly height: number } {
  const radius = scale.longestDimensionMm / Math.max(2, shape.heightRatio);
  return { radius, height: shape.heightRatio * radius };
}

export interface RoundSolidMeasurements {
  readonly radius: number;
  readonly diameter: number;
  readonly height: number;
  /** The cone's slant height l = √(h² + r²); undefined for the cylinder. */
  readonly slantHeight: number | undefined;
  readonly baseArea: number;
  readonly surfaceArea: number;
  readonly volume: number;
}

/** Measurements of the ideal curved solid, which the exported polygonal approximation slightly undershoots. */
export function roundSolidMeasurements(shape: RoundShape, scale: PhysicalScale): RoundSolidMeasurements {
  const { radius: r, height: h } = roundDimensionsMm(shape, scale);
  const baseArea = Math.PI * r ** 2;
  if (shape.kind === 'cylinder') {
    return {
      radius: r,
      diameter: 2 * r,
      height: h,
      slantHeight: undefined,
      baseArea,
      surfaceArea: 2 * baseArea + 2 * Math.PI * r * h,
      volume: baseArea * h,
    };
  }
  const slantHeight = Math.hypot(h, r);
  return {
    radius: r,
    diameter: 2 * r,
    height: h,
    slantHeight,
    baseArea,
    surfaceArea: baseArea + Math.PI * r * slantHeight,
    volume: (baseArea * h) / 3,
  };
}

/**
 * Cylinder or cone in millimetres, built by manifold-3d with the base centre at the origin, the axis along +Z and the
 * cone apex at (0, 0, h). Unlike the polyhedra it is built at its physical size, because the segment count depends on
 * the physical radius.
 */
export function buildRoundSolid(kernel: GeometryKernel, track: Track, shape: RoundShape, scale: PhysicalScale): Manifold {
  const { radius, height } = roundDimensionsMm(shape, scale);
  const topRadius = shape.kind === 'cone' ? 0 : radius;
  return track(kernel.Manifold.cylinder(height, radius, topRadius, circularSegments(radius), false));
}
