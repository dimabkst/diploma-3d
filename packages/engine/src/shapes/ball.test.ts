import type { ModelSpec } from '@diploma-3d/schema';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InvalidModelSpecError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  cross,
  dot,
  findMeshDefects,
  length,
  subtract,
  type TriangleMesh,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
} from '../mesh.ts';
import { generateModel } from '../model.ts';
import { BALL_SEGMENTS, ballMeasurements, ballSegments } from './ball.ts';
import { MAX_CIRCLE_DEVIATION_MM } from './round.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ball = (longestDimensionMm = 80): ModelSpec => ({ shape: { kind: 'ball' }, scale: { longestDimensionMm } });

const onlySolid = (spec: ModelSpec) => {
  const [solid] = generateModel(kernel, spec).solids;
  if (solid === undefined) throw new Error('No solid');
  return solid;
};

// Float32 positions of values up to 2r: about 1e-7 relative.
const positionTolerance = (r: number) => 1e-6 * r;

interface FaceSurvey {
  /** Largest r − d over all faces, d being the distance from the centre to the face plane. */
  readonly maxDeviation: number;
  readonly minArea: number;
  readonly outward: boolean;
}

/** For each face: its area, whether it faces away from the centre, and how far its plane lies inside the sphere. */
function surveyFaces(mesh: TriangleMesh, centre: Vec3, r: number): FaceSurvey {
  let maxDeviation = 0;
  let minArea = Number.POSITIVE_INFINITY;
  let outward = true;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [a, b, c] = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex)) as [Vec3, Vec3, Vec3];
    const normal = cross(subtract(b, a), subtract(c, a));
    minArea = Math.min(minArea, length(normal) / 2);
    const distance = dot(normal, subtract(a, centre)) / length(normal);
    if (distance <= 0) outward = false;
    maxDeviation = Math.max(maxDeviation, r - distance);
  }
  return { maxDeviation, minArea, outward };
}

/**
 * Every edge is convex: the far vertex of the neighbouring triangle lies on the inner side of (or on) the face plane.
 * For a closed, connected surface such local convexity implies that the whole polyhedron is convex.
 */
function hasConvexEdges(mesh: TriangleMesh, tolerance: number): boolean {
  const oppositeOfEdge = new Map<string, number>();
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle);
    corners.forEach((from, corner) => {
      oppositeOfEdge.set(`${from}:${corners[(corner + 1) % 3]}`, corners[(corner + 2) % 3] as number);
    });
  }
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle);
    const [a, b, c] = corners.map((vertex) => vertexAt(mesh, vertex)) as [Vec3, Vec3, Vec3];
    const normal = cross(subtract(b, a), subtract(c, a));
    const unit = normal.map((component) => component / length(normal)) as unknown as Vec3;
    for (let corner = 0; corner < 3; corner += 1) {
      // The neighbour traverses the shared edge in the opposite direction.
      const far = oppositeOfEdge.get(`${corners[(corner + 1) % 3]}:${corners[corner]}`);
      if (far === undefined || dot(unit, subtract(vertexAt(mesh, far), a)) > tolerance) return false;
    }
  }
  return true;
}

describe('ballSegments', () => {
  it('uses 128 segments up to the default 40 mm radius', () => {
    expect(BALL_SEGMENTS).toBe(128);
    for (const r of [0.001, 1, 20, 40, 60]) expect(ballSegments(r)).toBe(128);
  });

  it.each([
    [100, 168],
    [500, 368],
  ])('raises the count in multiples of four for r = %s mm, to %s', (r, segments) => {
    expect(ballSegments(r)).toBe(segments);
    expect(segments % 4).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the radius %s', (r) => {
    expect(() => ballSegments(r)).toThrow(RangeError);
  });
});

describe('ballMeasurements', () => {
  it('gives the ideal ball: d = 2r, S = 4πr² and V = 4πr³/3', () => {
    const m = ballMeasurements({ longestDimensionMm: 80 });
    expect(m.radius).toBe(40);
    expect(m.diameter).toBe(80);
    expect(m.surfaceArea).toBeCloseTo(6400 * Math.PI, 9);
    expect(m.volume).toBeCloseTo((256_000 * Math.PI) / 3, 9);
    // 20 106,2 mm² and 268 082,6 mm³.
    expect(m.surfaceArea).toBeCloseTo(20_106.19, 2);
    expect(m.volume).toBeCloseTo(268_082.57, 2);
  });
});

describe('generateModel for a ball', () => {
  // L = 80 mm uses 128 segments; 200 and 1000 mm need more to stay within 0,05 mm of the sphere.
  it.each([
    [80, 128],
    [200, 168],
    [1000, 368],
  ])('builds a closed, convex, outward ball for L = %s mm with %s segments within 0,05 mm of the sphere', (longest, segments) => {
    const model = generateModel(kernel, ball(longest));
    expect(model.name).toBe('ball');
    const solid = model.solids[0];
    if (solid === undefined) throw new Error('No solid');
    const { mesh, measurements } = solid;
    const r = longest / 2;
    const centre: Vec3 = [0, 0, r];
    expect(ballSegments(r)).toBe(segments);
    expect(solid.smoothShading).toBe(true);

    // An octahedron with each edge split into N/4 parts: 8·(N/4)² triangles.
    expect(triangleCount(mesh)).toBe(8 * (segments / 4) ** 2);
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
    expect(measurements.volume).toBeGreaterThan(0);

    // Centre at (0, 0, r), resting on z = 0: x, y in [−r, r] and z in [0, 2r].
    const expectedMin = [-r, -r, 0] as const;
    const expectedMax = [r, r, 2 * r] as const;
    for (const axis of [0, 1, 2] as const) {
      expect(Math.abs(measurements.bounds.min[axis] - expectedMin[axis])).toBeLessThan(positionTolerance(r));
      expect(Math.abs(measurements.bounds.max[axis] - expectedMax[axis])).toBeLessThan(positionTolerance(r));
    }

    // Vertices lie on the sphere; between them each face plane is at least r − 0,05 mm from the centre.
    let radiusError = 0;
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
      radiusError = Math.max(radiusError, Math.abs(length(subtract(vertexAt(mesh, vertex), centre)) - r));
    }
    expect(radiusError).toBeLessThan(positionTolerance(r));
    const faces = surveyFaces(mesh, centre, r);
    expect(faces.outward).toBe(true);
    expect(faces.maxDeviation).toBeGreaterThan(0);
    expect(faces.maxDeviation).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM + positionTolerance(r));
    expect(faces.minArea).toBeGreaterThan(1e-4 * r ** 2);
    if (longest === 80) expect(faces.maxDeviation).toBeCloseTo(0.0324, 3);

    // A convex polyhedron with its vertices on the sphere and its faces at least r − δ from the centre lies between the
    // balls of radius r − δ and r, so its area and volume do too (both grow with nested convex bodies).
    expect(hasConvexEdges(mesh, positionTolerance(r))).toBe(true);
    const inner = r - faces.maxDeviation;
    const ideal = ballMeasurements({ longestDimensionMm: longest });
    expect(measurements.volume).toBeLessThan(ideal.volume);
    expect(measurements.volume).toBeGreaterThan((4 / 3) * Math.PI * inner ** 3);
    expect(measurements.surfaceArea).toBeLessThan(ideal.surfaceArea);
    expect(measurements.surfaceArea).toBeGreaterThan(4 * Math.PI * inner ** 2);
  });

  it('is deterministic', () => {
    expect(onlySolid(ball()).mesh).toEqual(onlySolid(ball()).mesh);
  });

  it.each([
    ['a radius', { kind: 'ball', radius: 40 }],
    ['a segment count', { kind: 'ball', segments: 16 }],
    ['a hollow shell', { kind: 'ball', hollow: true }],
  ])('rejects %s before allocating geometry', (_, shape) => {
    const sphere = vi.spyOn(kernel.Manifold, 'sphere');
    expect(() => generateModel(kernel, { shape, scale: { longestDimensionMm: 80 } } as ModelSpec)).toThrow(InvalidModelSpecError);
    expect(sphere).not.toHaveBeenCalled();
  });
});
