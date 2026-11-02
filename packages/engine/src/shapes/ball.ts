import type { PhysicalScale } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';
import { MAX_CIRCLE_DEVIATION_MM } from './round.ts';

/**
 * Circular segments of the ball at the default 80 mm export size (r = 40 mm). manifold-3d builds a sphere by splitting
 * each edge of an octahedron into N/4 parts and projecting the vertices onto the sphere, so the largest deviation lies
 * inside the faces, not on a circle: at N = 128 it is 0.032 mm, while the cylinder's 64 segments would give 0.13 mm.
 */
export const BALL_SEGMENTS = 128;

/**
 * Measured for manifold-3d 3.5.4: the largest relative deviation (r − d)/r over all faces, with d the distance from the
 * centre to a face plane, times N² is 13.27 at N = 128 and decreases slowly with N (13.18 at N = 1024). Using a
 * slightly larger constant keeps the segment count for larger balls on the safe side; tests check the actual meshes.
 */
const DEVIATION_TIMES_SEGMENTS_SQUARED = 13.5;

/**
 * The number of sphere segments for radius r: at least BALL_SEGMENTS and enough for r · 13.5 / N² ≤ 0.05 mm, as a
 * multiple of four so that the octahedron's edges divide evenly.
 */
export function ballSegments(radiusMm: number): number {
  if (!(radiusMm > 0) || !Number.isFinite(radiusMm)) throw new RangeError(`Invalid ball radius: ${radiusMm}.`);
  const required = Math.sqrt((DEVIATION_TIMES_SEGMENTS_SQUARED * radiusMm) / MAX_CIRCLE_DEVIATION_MM);
  return Math.max(BALL_SEGMENTS, 4 * Math.ceil(required / 4));
}

/** The ball's radius r = L/2 in millimetres: its diameter is the longest dimension. */
export const ballRadiusMm = (scale: PhysicalScale): number => scale.longestDimensionMm / 2;

export interface BallMeasurements {
  readonly radius: number;
  readonly diameter: number;
  readonly surfaceArea: number;
  readonly volume: number;
}

/** Measurements of the ideal ball, which the exported polyhedron inscribed in it slightly undershoots. */
export function ballMeasurements(scale: PhysicalScale): BallMeasurements {
  const r = ballRadiusMm(scale);
  return { radius: r, diameter: 2 * r, surfaceArea: 4 * Math.PI * r ** 2, volume: (4 * Math.PI * r ** 3) / 3 };
}

/**
 * Solid ball in millimetres, built by manifold-3d and moved so that its centre is at (0, 0, r) and it rests on z = 0.
 * Like the cylinder it is built at its physical size, because the segment count depends on the physical radius.
 */
export function buildBall(kernel: GeometryKernel, track: Track, scale: PhysicalScale): Manifold {
  const radius = ballRadiusMm(scale);
  const centred = track(kernel.Manifold.sphere(radius, ballSegments(radius)));
  return track(centred.translate([0, 0, radius]));
}
