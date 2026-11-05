import { MAX_LONGEST_DIMENSION_MM, MIN_LONGEST_DIMENSION_MM, type ModelSpecInput, type PhysicalScale } from '@diploma-3d/schema';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InvalidModelSpecError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  dot,
  findMeshDefects,
  length,
  subtract,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
} from '../mesh.ts';
import { generateModel } from '../model.ts';
import { ballSegments } from './ball.ts';
import {
  CIRCULAR_SEGMENTS,
  circularSegments,
  MAX_CIRCLE_DEVIATION_MM,
  type RoundShape,
  roundDimensionsMm,
  roundSolidMeasurements,
} from './round.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Kind = RoundShape['kind'];
const KINDS: readonly Kind[] = ['cylinder', 'cone'];
const scale = (longestDimensionMm = 80): PhysicalScale => ({ longestDimensionMm });
const spec = (kind: Kind, heightRatio: number, longestDimensionMm = 80): ModelSpecInput => ({
  shape: { kind, heightRatio },
  scale: scale(longestDimensionMm),
});

const onlySolid = (input: ModelSpecInput) => {
  const [solid] = generateModel(kernel, input).solids;
  if (solid === undefined) throw new Error('No solid');
  return solid;
};

const RELATIVE_TOLERANCE = 1e-6;
const expectRelativelyClose = (actual: number | undefined, expected: number) => {
  expect(Math.abs((actual ?? Number.NaN) / expected - 1)).toBeLessThan(RELATIVE_TOLERANCE);
};
const ABSOLUTE_TOLERANCE_MM = 1e-4;

const vertices = (mesh: TriangleMesh): Vec3[] =>
  Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex));

/** Area of the inscribed regular N-gon of radius r: N·r²·sin(2π/N) / 2. */
const polygonArea = (segments: number, r: number) => (segments * r ** 2 * Math.sin((2 * Math.PI) / segments)) / 2;

describe('round solid dimensions', () => {
  // [h/r, r, h] at L = 80 mm: r = L / max(2, h/r).
  it.each([
    [1, 40, 40],
    [2, 40, 80],
    [4, 20, 80],
    [0.25, 40, 10],
    [1.1, 40, 44],
    [2.05, 80 / 2.05, 80],
  ])('h/r = %s gives r = %s mm and h = %s mm', (heightRatio, r, h) => {
    for (const kind of KINDS) {
      const { radius, height } = roundDimensionsMm({ kind, heightRatio, offsetRatio: 0 }, scale());
      expectRelativelyClose(radius, r);
      expectRelativelyClose(height, h);
      expectRelativelyClose(Math.max(2 * radius, height), 80);
    }
  });
});

describe('circularSegments', () => {
  const deviation = (r: number, segments: number) => r * (1 - Math.cos(Math.PI / segments));

  it('uses 64 segments up to the 40 mm radius of the default size, within 0,05 mm of the circle', () => {
    expect(CIRCULAR_SEGMENTS).toBe(64);
    for (const r of [0.01, 1, 10, 20, 40]) expect(circularSegments(r)).toBe(64);
    expect(deviation(40, 64)).toBeCloseTo(0.0482, 4);
    expect(deviation(40, 64)).toBeLessThan(MAX_CIRCLE_DEVIATION_MM);
  });

  // 64 segments suffice up to r ≈ 41,5 mm; beyond it the count grows in steps of four.
  it.each([42, 80, 125, 500])('picks the fewest multiple of four within 0,05 mm for r = %s mm', (r) => {
    const segments = circularSegments(r);
    expect(segments % 4).toBe(0);
    expect(segments).toBeGreaterThan(64);
    expect(deviation(r, segments)).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM);
    expect(deviation(r, segments - 4)).toBeGreaterThan(MAX_CIRCLE_DEVIATION_MM);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the radius %s', (r) => {
    expect(() => circularSegments(r)).toThrow(RangeError);
  });
});

describe('roundSolidMeasurements', () => {
  it('gives the ideal cylinder: S = 2πr² + 2πrh and V = πr²h', () => {
    const m = roundSolidMeasurements({ kind: 'cylinder', heightRatio: 2, offsetRatio: 0 }, scale());
    expect(m).toMatchObject({ radius: 40, diameter: 80, height: 80, offset: 0, lateralAreaIntegrated: false });
    // A right cylinder's generatrix is its height.
    expect(m.generatrix).toEqual({ min: 80, max: 80 });
    expect(m.lateralArea).toBeCloseTo(6400 * Math.PI, 9);
    expect(m.baseArea).toBeCloseTo(1600 * Math.PI, 9);
    expect(m.surfaceArea).toBeCloseTo(3200 * Math.PI + 6400 * Math.PI, 9);
    expect(m.volume).toBeCloseTo(128_000 * Math.PI, 9);
    // 30 159,3 mm² and 402 123,9 mm³.
    expect(m.surfaceArea).toBeCloseTo(30_159.29, 2);
    expect(m.volume).toBeCloseTo(402_123.86, 2);
  });

  it('gives the ideal cone: l = √(h² + r²), S = πr² + πrl and V = πr²h / 3', () => {
    const m = roundSolidMeasurements({ kind: 'cone', heightRatio: 2, offsetRatio: 0 }, scale());
    expect(m).toMatchObject({ radius: 40, diameter: 80, height: 80, lateralAreaIntegrated: false });
    // All generatrices of a right cone are equal.
    expect(m.generatrix.min).toBeCloseTo(Math.sqrt(8000), 9);
    expect(m.generatrix.max).toBe(m.generatrix.min);
    expect(m.baseArea).toBeCloseTo(1600 * Math.PI, 9);
    expect(m.surfaceArea).toBeCloseTo(1600 * Math.PI + 40 * Math.PI * Math.sqrt(8000), 9);
    expect(m.volume).toBeCloseTo((128_000 * Math.PI) / 3, 9);
    // l ≈ 89,4 mm, S ≈ 5 026,55 + 11 239,70 = 16 266,25 mm², V ≈ 134 041,3 mm³.
    expect(m.surfaceArea).toBeCloseTo(16_266.25, 2);
    expect(m.volume).toBeCloseTo(134_041.29, 2);
  });

  it('follows the physical dimensions of other ratios', () => {
    const m = roundSolidMeasurements({ kind: 'cone', heightRatio: 4, offsetRatio: 0 }, scale());
    expect(m).toMatchObject({ radius: 20, diameter: 40, height: 80 });
    expect(m.generatrix.max).toBeCloseTo(Math.hypot(80, 20), 9);
    expect(m.volume).toBeCloseTo((Math.PI * 400 * 80) / 3, 9);
  });
});

describe('generateModel for a cylinder and a cone', () => {
  const cases = KINDS.flatMap((kind) => [0.5, 1, 1.1, 2, 2.05, 4, 4.8, 8].map((heightRatio) => [kind, heightRatio] as const));

  it.each(cases)('builds a closed, outward %s with h/r = %s at its physical size', (kind, heightRatio) => {
    const { mesh, measurements, smoothShading } = onlySolid(spec(kind, heightRatio));
    const { radius: r, height: h } = roundDimensionsMm({ kind, heightRatio, offsetRatio: 0 }, scale());
    const segments = CIRCULAR_SEGMENTS;
    expect(smoothShading).toBe(true);

    expect(findMeshDefects(mesh)).toEqual([]);
    expect(measurements.volume).toBeGreaterThan(0);
    // The kernel's −0 on-axis coordinates are normalised, so the mesh equals what the 3MF text writes.
    expect(Array.from(mesh.positions).some((value) => Object.is(value, -0))).toBe(false);
    // Two rings for the cylinder; one ring and the apex for the cone. No degenerate triangles.
    expect(vertices(mesh)).toHaveLength(kind === 'cylinder' ? 2 * segments : segments + 1);
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      expect(length(triangleAreaVector(mesh, triangle)) / 2).toBeGreaterThan(1e-3);
      // Convex solid: every face points away from an inner point on the axis.
      const [a, b, c] = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex)) as [Vec3, Vec3, Vec3];
      const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      expect(dot(triangleAreaVector(mesh, triangle), subtract(centroid, [0, 0, h / 4]))).toBeGreaterThan(0);
    }

    // Base centre at the origin, axis along +Z: bounding box 2r × 2r × h from z = 0, largest side 80 mm.
    expect(measurements.bounds.min[2]).toBe(0);
    for (const axis of [0, 1] as const) {
      expect(Math.abs(measurements.bounds.min[axis] + r)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      expect(Math.abs(measurements.bounds.max[axis] - r)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    }
    expectRelativelyClose(measurements.size[2], h);
    expectRelativelyClose(Math.max(...measurements.size), 80);

    // Every ring vertex lies on the ideal circle, so the facets deviate from it by r·(1 − cos(π/N)) ≤ 0,05 mm.
    const ring = vertices(mesh)
      .filter((vertex) => vertex[2] === 0)
      .sort((p, q) => Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]));
    expect(ring).toHaveLength(segments);
    let deviation = 0;
    ring.forEach((vertex, index) => {
      expect(Math.abs(Math.hypot(vertex[0], vertex[1]) - r)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      const next = ring[(index + 1) % segments] as Vec3;
      deviation = Math.max(deviation, r - Math.hypot((vertex[0] + next[0]) / 2, (vertex[1] + next[1]) / 2));
    });
    expect(deviation).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM);
    expect(deviation).toBeCloseTo(r * (1 - Math.cos(Math.PI / segments)), 4);

    if (kind === 'cylinder') {
      expect(vertices(mesh).filter((vertex) => Math.abs(vertex[2] - h) < ABSOLUTE_TOLERANCE_MM)).toHaveLength(segments);
    } else {
      const above = vertices(mesh).filter((vertex) => vertex[2] > 0);
      expect(above).toHaveLength(1);
      const [apex] = above as [Vec3];
      expect(Math.hypot(apex[0], apex[1])).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      expectRelativelyClose(apex[2], h);
    }

    // The mesh is the inscribed polygonal solid, so its volume is the polygon's, slightly below the ideal πr²·h.
    const base = polygonArea(segments, r);
    expectRelativelyClose(measurements.volume, kind === 'cylinder' ? base * h : (base * h) / 3);
    expect(measurements.volume).toBeLessThan(roundSolidMeasurements({ kind, heightRatio, offsetRatio: 0 }, scale()).volume);
  });

  it.each(KINDS)('refines the %s at a larger export size to stay within 0,05 mm of the circle', (kind) => {
    const { mesh, measurements } = onlySolid(spec(kind, 1, 1000));
    const r = 500;
    const segments = circularSegments(r);
    expect(segments).toBe(224);
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(vertices(mesh).filter((vertex) => vertex[2] === 0)).toHaveLength(segments);
    expect(Math.abs(measurements.size[0] - 2 * r)).toBeLessThan(1e-3);
    expect(r * (1 - Math.cos(Math.PI / segments))).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM);
  });

  it('keeps the circle and sphere subdivisions within the deviation limit and bounded for every allowed size', () => {
    // The longest dimension bounds every radius: r ≤ L/2 for circles and r = L/2 for the ball.
    let [previousCircle, previousBall] = [0, 0];
    for (const longest of [MIN_LONGEST_DIMENSION_MM, 12.5, 80, 120, 333.3, 640, MAX_LONGEST_DIMENSION_MM]) {
      const r = longest / 2;
      const [circle, sphere] = [circularSegments(r), ballSegments(r)];
      expect(r * (1 - Math.cos(Math.PI / circle))).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM);
      expect(circle).toBeGreaterThanOrEqual(previousCircle);
      expect(sphere).toBeGreaterThanOrEqual(previousBall);
      [previousCircle, previousBall] = [circle, sphere];
    }
    // At the largest allowed size: 224 circle segments and 368 sphere segments, 8·92² = 67 712 triangles.
    expect(previousCircle).toBe(224);
    expect(previousBall).toBe(368);
  });

  it('names the solids and files after the shape', () => {
    expect(generateModel(kernel, spec('cylinder', 2)).name).toBe('cylinder');
    expect(generateModel(kernel, spec('cone', 2)).name).toBe('cone');
  });

  it('is deterministic', () => {
    expect(onlySolid(spec('cone', 1.1)).mesh).toEqual(onlySolid(spec('cone', 1.1)).mesh);
  });

  it.each(
    KINDS.flatMap((kind) =>
      [
        ['a ratio below the minimum', { kind, heightRatio: 0.24 }],
        ['a ratio above the maximum', { kind, heightRatio: 16.5 }],
        ['a NaN ratio', { kind, heightRatio: Number.NaN }],
        ['an infinite ratio', { kind, heightRatio: Number.POSITIVE_INFINITY }],
        ['a string ratio', { kind, heightRatio: '2' }],
        ['a missing ratio', { kind }],
        ['a segment count', { kind, heightRatio: 2, segments: 8 }],
      ].map(([label, shape]) => [kind, label, shape] as const),
    ),
  )('rejects a %s with %s before allocating geometry', (_, __, shape) => {
    const cylinder = vi.spyOn(kernel.Manifold, 'cylinder');
    expect(() => generateModel(kernel, { shape, scale: scale() } as ModelSpecInput)).toThrow(InvalidModelSpecError);
    expect(cylinder).not.toHaveBeenCalled();
  });
});
