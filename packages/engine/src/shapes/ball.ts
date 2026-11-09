import type { PhysicalScale } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Vec3 } from '../mesh.ts';
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

/** The ball's centre: it rests on z = 0. */
export const ballCentreMm = (scale: PhysicalScale): Vec3 => [0, 0, ballRadiusMm(scale)];

/**
 * The radius of a sphere inside the polyhedron, which no face plane comes closer to the centre than: every point inside it
 * lies at least (this radius − its distance from the centre) inside the actual solid.
 */
export function ballInradiusMm(scale: PhysicalScale): number {
  const radius = ballRadiusMm(scale);
  return radius * (1 - DEVIATION_TIMES_SEGMENTS_SQUARED / ballSegments(radius) ** 2);
}

/**
 * The polyhedron's corners and edges as manifold-3d 3.5.4 builds them around the origin: each face of an octahedron divided
 * into a regular grid of N/4 parts per edge, whose points (a, b, c) move to sin(π/2·(a, b, c)), normalised to the radius. The
 * tests compare them with the actual mesh. Corners on the faces' shared edges repeat, which a plane's section merges again.
 */
export function ballPolyhedron(radius: number): {
  readonly vertices: readonly Vec3[];
  readonly edges: readonly (readonly [number, number])[];
} {
  const parts = ballSegments(radius) / 4;
  const vertices: Vec3[] = [];
  const edges: (readonly [number, number])[] = [];
  for (const [sx, sy, sz] of OCTANTS) {
    const first = vertices.length;
    const indexOf = (i: number, j: number) => first + (i * (2 * parts + 3 - i)) / 2 + j;
    for (let i = 0; i <= parts; i += 1) {
      for (let j = 0; j <= parts - i; j += 1) {
        const [x, y, z] = [i, j, parts - i - j].map((step) => Math.sin((Math.PI / 2) * (step / parts))) as [
          number,
          number,
          number,
        ];
        const scale = radius / Math.hypot(x, y, z);
        vertices.push([sx * x * scale, sy * y * scale, sz * z * scale]);
        if (i + j < parts) {
          edges.push([indexOf(i, j), indexOf(i, j + 1)]);
          edges.push([indexOf(i, j), indexOf(i + 1, j)]);
          edges.push([indexOf(i, j + 1), indexOf(i + 1, j)]);
        }
      }
    }
  }
  return { vertices, edges };
}

const OCTANTS: readonly Vec3[] = [
  [1, 1, 1],
  [-1, 1, 1],
  [1, -1, 1],
  [-1, -1, 1],
  [1, 1, -1],
  [-1, 1, -1],
  [1, -1, -1],
  [-1, -1, -1],
];

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
  return track(centred.translate([...ballCentreMm(scale)]));
}
