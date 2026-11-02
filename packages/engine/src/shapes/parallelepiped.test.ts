import { defaultModelSpecs, type ModelSpec, type ParallelepipedShape } from '@diploma-3d/schema';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InvalidModelSpecError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { findMeshDefects, type TriangleMesh, triangleAreaVector, triangleCount, type Vec3, vertexAt } from '../mesh.ts';
import { generateModel } from '../model.ts';
import { parallelepipedDimensionsMm, parallelepipedProportions } from './parallelepiped.ts';
import { polygonSize } from './polygon.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const shapeOf = (baseSideRatio: number, heightRatio: number, baseAngleDeg: number): ParallelepipedShape => ({
  kind: 'parallelepiped',
  baseSideRatio,
  heightRatio,
  baseAngleDeg,
});

const spec = (shape: ParallelepipedShape, longestDimensionMm = 80): ModelSpec => ({ shape, scale: { longestDimensionMm } });

const onlySolid = (input: ModelSpec) => {
  const [solid] = generateModel(kernel, input).solids;
  if (solid === undefined) throw new Error('No solid');
  return solid;
};

// Vertices come from float32 positions of 80 mm-sized values: about 1e-5 mm absolute, 1e-6 relative.
const RELATIVE_TOLERANCE = 1e-6;
const expectRelativelyClose = (actual: number | undefined, expected: number) => {
  expect(Math.abs((actual ?? Number.NaN) / expected - 1)).toBeLessThan(RELATIVE_TOLERANCE);
};
const ABSOLUTE_TOLERANCE_MM = 1e-4;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Expected values from the definition alone: with a0 = 1 the base is 1 + |b0·cos α| wide and b0·sin α deep, the solid
 * h0 high, and a = L / max(width0, depth0, h0).
 */
function expected(b0: number, h0: number, angle: number, longest = 80) {
  const width0 = 1 + Math.abs(b0 * Math.cos(radians(angle)));
  const depth0 = b0 * Math.sin(radians(angle));
  const a = longest / Math.max(width0, depth0, h0);
  const b = b0 * a;
  const h = h0 * a;
  const baseArea = a * b * Math.sin(radians(angle));
  return {
    a,
    b,
    h,
    width: width0 * a,
    depth: depth0 * a,
    baseArea,
    volume: baseArea * h,
    surface: 2 * baseArea + 2 * (a + b) * h,
  };
}

const verticesAt = (mesh: TriangleMesh, z: number): Vec3[] =>
  Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex)).filter(
    (vertex) => Math.abs(vertex[2] - z) < ABSOLUTE_TOLERANCE_MM,
  );

/** Area of the faces whose outward normal is exactly −Z (the bottom base) or +Z (the top base). */
function capArea(mesh: TriangleMesh, direction: 1 | -1): number {
  let area = 0;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [x, y, z] = triangleAreaVector(mesh, triangle);
    if (x === 0 && y === 0 && Math.sign(z) === direction) area += Math.abs(z) / 2;
  }
  return area;
}

/** The expected vertex A, B, C or D of the scaled base matched by a mesh vertex in the plane z. */
const hasVertexNear = (points: readonly Vec3[], [x, y]: readonly [number, number]) =>
  points.some(([px, py]) => Math.hypot(px - x, py - y) < ABSOLUTE_TOLERANCE_MM);

describe('parallelepipedProportions', () => {
  it.each([
    [1, 1, 60],
    [4, 0.25, 15],
    [0.25, 4, 165],
    [2.05, 1.1, 62],
    [1.5, 2, 90],
  ])('takes the bounding box of the base with b/a = %s, h/a = %s and α = %s°', (b0, h0, angle) => {
    const { base, height, scale } = parallelepipedProportions(shapeOf(b0, h0, angle));
    const [width, depth] = polygonSize(base);
    expect(width).toBeCloseTo(1 + Math.abs(b0 * Math.cos(radians(angle))), 14);
    expect(depth).toBeCloseTo(b0 * Math.sin(radians(angle)), 14);
    expect(height).toBe(h0);
    expect(scale).toBe(1 / Math.max(width, depth, h0));
  });

  it('normalises by the bounding box, not by the longest edge max(a0, b0, h0)', () => {
    // Every edge is 1, yet the base is 1 + cos 60° = 1,5 wide: a = 80 / 1,5 mm, not 80 mm.
    const dimensions = parallelepipedDimensionsMm(shapeOf(1, 1, 60), { longestDimensionMm: 80 });
    expect(dimensions.baseSideA).toBeCloseTo(160 / 3, 12);
    expect(dimensions.baseSideB).toBeCloseTo(160 / 3, 12);
    expect(dimensions.height).toBeCloseTo(160 / 3, 12);
  });
});

describe('generateModel for a right parallelepiped', () => {
  it('builds the default rhombic parallelepiped: b = a = h = 80 / 1,5 mm, the base 80 mm wide', () => {
    const model = generateModel(kernel, defaultModelSpecs.parallelepiped);
    expect(model.kind).toBe('parallelepiped');
    expect(model.name).toBe('parallelepiped');
    expect(model.solids.map((solid) => [solid.name, solid.smoothShading])).toEqual([['parallelepiped', false]]);
    const a = 160 / 3;
    const { bounds } = model.solids[0]?.measurements ?? { bounds: undefined };
    [-40, (-a * Math.sqrt(3)) / 4, 0].forEach((value, axis) => {
      expect(bounds?.min[axis]).toBeCloseTo(value, 4);
    });
    [40, (a * Math.sqrt(3)) / 4, a].forEach((value, axis) => {
      expect(bounds?.max[axis]).toBeCloseTo(value, 4);
    });
  });

  const cases = [0.25, 1, 2.05, 4].flatMap((b0) =>
    [0.25, 1.1, 4].flatMap((h0) => [15, 60, 62, 90, 120, 165].map((angle) => [b0, h0, angle] as const)),
  );

  it.each(cases)('with b/a = %s, h/a = %s and α = %s° matches the analytic geometry at L = 80 mm', (b0, h0, angle) => {
    const shape = shapeOf(b0, h0, angle);
    const { mesh, measurements } = onlySolid(spec(shape));
    const ideal = expected(b0, h0, angle);

    const dimensions = parallelepipedDimensionsMm(shape, { longestDimensionMm: 80 });
    expectRelativelyClose(dimensions.baseSideA, ideal.a);
    expectRelativelyClose(dimensions.baseSideB, ideal.b);
    expectRelativelyClose(dimensions.height, ideal.h);
    expectRelativelyClose(dimensions.baseArea, ideal.baseArea);
    expectRelativelyClose(dimensions.basePerimeter, 2 * (ideal.a + ideal.b));
    expectRelativelyClose(dimensions.volume, ideal.volume);
    expectRelativelyClose(dimensions.surfaceArea, ideal.surface);

    // Closed, outward-oriented, without degenerate triangles; standing on the build plate, centred in XY, with the
    // longest bounding-box dimension at the export size.
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(triangleCount(mesh)).toBe(12);
    expect(measurements.volume).toBeGreaterThan(0);
    expect(measurements.bounds.min[2]).toBe(0);
    expectRelativelyClose(measurements.size[0], ideal.width);
    expectRelativelyClose(measurements.size[1], ideal.depth);
    expectRelativelyClose(measurements.size[2], ideal.h);
    expectRelativelyClose(Math.max(...measurements.size), 80);
    for (const axis of [0, 1] as const) {
      expect(Math.abs(measurements.bounds.min[axis] + measurements.bounds.max[axis])).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    }

    // The base A, B, C, D in z = 0 and the same base in z = h: the lateral edges are perpendicular to the base.
    const [u, v] = [
      [ideal.a, 0],
      [ideal.b * Math.cos(radians(angle)), ideal.b * Math.sin(radians(angle))],
    ] as const;
    const corners = [
      [-(u[0] + v[0]) / 2, -(u[1] + v[1]) / 2],
      [(u[0] - v[0]) / 2, (u[1] - v[1]) / 2],
      [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2],
      [(v[0] - u[0]) / 2, (v[1] - u[1]) / 2],
    ] as const;
    const bottom = verticesAt(mesh, 0);
    const top = verticesAt(mesh, ideal.h);
    expect(bottom).toHaveLength(4);
    expect(top).toHaveLength(4);
    for (const corner of corners) {
      expect(hasVertexNear(bottom, corner)).toBe(true);
      expect(hasVertexNear(top, corner)).toBe(true);
    }

    // Each base has the area a·b·sin α and every other face is vertical; the mesh agrees with V = A·h and
    // S = 2A + 2(a + b)·h.
    expectRelativelyClose(capArea(mesh, -1), ideal.baseArea);
    expectRelativelyClose(capArea(mesh, 1), ideal.baseArea);
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const [x, y, z] = triangleAreaVector(mesh, triangle);
      if (x !== 0 || y !== 0) expect(Math.abs(z)).toBeLessThan(1e-6 * Math.hypot(x, y));
    }
    expectRelativelyClose(measurements.volume, ideal.volume);
    expectRelativelyClose(measurements.surfaceArea, ideal.surface);
  });

  it.each([
    [1.5, 2, 80],
    [2.5, 0.5, 80],
    [0.25, 0.5, 50],
    [1, 1, 37.5],
  ])('with α = 90° reproduces the cuboid with b/a = %s and c/a = %s at L = %s mm', (b0, h0, longest) => {
    const fromParallelepiped = onlySolid(spec(shapeOf(b0, h0, 90), longest));
    const fromCuboid = onlySolid({
      shape: { kind: 'cuboid', widthRatio: b0, heightRatio: h0 },
      scale: { longestDimensionMm: longest },
    });
    const sorted = (mesh: TriangleMesh) =>
      Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex)).sort(
        (p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2],
      );
    const cuboidVertices = sorted(fromCuboid.mesh);
    sorted(fromParallelepiped.mesh).forEach((vertex, index) => {
      vertex.forEach((component, axis) => {
        expect(Math.abs(component - (cuboidVertices[index]?.[axis] ?? Number.NaN))).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      });
    });
    expect(cuboidVertices).toHaveLength(8);
    expectRelativelyClose(fromParallelepiped.measurements.volume, fromCuboid.measurements.volume);
    expectRelativelyClose(fromParallelepiped.measurements.surfaceArea, fromCuboid.measurements.surfaceArea);
  });

  it.each([1, 2.05])('with b = a has a rhombus base with four equal sides and perpendicular diagonals (h/a = %s)', (h0) => {
    const { mesh } = onlySolid(spec(shapeOf(1, h0, 62)));
    const { a } = expected(1, h0, 62);
    const bottom = verticesAt(mesh, 0).sort((p, q) => Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]));
    bottom.forEach((vertex, index) => {
      const next = bottom[(index + 1) % 4] as Vec3;
      expectRelativelyClose(Math.hypot(next[0] - vertex[0], next[1] - vertex[1]), a);
    });
    const [p, q, r, s] = bottom as [Vec3, Vec3, Vec3, Vec3];
    const diagonalDot = (r[0] - p[0]) * (s[0] - q[0]) + (r[1] - p[1]) * (s[1] - q[1]);
    expect(Math.abs(diagonalDot)).toBeLessThan(1e-6 * a ** 2);
  });

  it.each([
    [60, 120],
    [15, 165],
    [62, 118],
  ])('mirrors the solid for α = %s° and α = %s° with equal size, area and volume', (angle, supplement) => {
    const first = onlySolid(spec(shapeOf(1.5, 0.75, angle)));
    const second = onlySolid(spec(shapeOf(1.5, 0.75, supplement)));
    first.measurements.size.forEach((size, axis) => {
      expectRelativelyClose(second.measurements.size[axis], size);
    });
    expectRelativelyClose(second.measurements.volume, first.measurements.volume);
    expectRelativelyClose(second.measurements.surfaceArea, first.measurements.surfaceArea);
    // Reflecting x → −x maps one vertex set onto the other.
    const mirrored = Array.from({ length: first.mesh.positions.length / 3 }, (_, vertex) => vertexAt(first.mesh, vertex));
    for (let vertex = 0; vertex < second.mesh.positions.length / 3; vertex += 1) {
      const [x, y, z] = vertexAt(second.mesh, vertex);
      expect(mirrored.some((point) => Math.hypot(point[0] + x, point[1] - y, point[2] - z) < ABSOLUTE_TOLERANCE_MM)).toBe(true);
    }
  });

  it.each([
    // α = 15°: 1 + cos 15° ≈ 1,966 wide, so a = 80 / 1,966 ≈ 40,7 mm and the base only b·sin 15° ≈ 10,5 mm deep.
    [15, 40.69, 10.53],
    [165, 40.69, 10.53],
  ])('at the supported limit α = %s° has a ≈ %s mm and a base depth of ≈ %s mm', (angle, a, depth) => {
    const { measurements } = onlySolid(spec(shapeOf(1, 1, angle)));
    expect(parallelepipedDimensionsMm(shapeOf(1, 1, angle), { longestDimensionMm: 80 }).baseSideA).toBeCloseTo(a, 2);
    expect(measurements.size[0]).toBeCloseTo(80, 4);
    expect(measurements.size[1]).toBeCloseTo(depth, 2);
  });

  it('is deterministic', () => {
    expect(onlySolid(spec(shapeOf(2.05, 1.1, 62))).mesh).toEqual(onlySolid(spec(shapeOf(2.05, 1.1, 62))).mesh);
  });

  it.each([
    ['an angle below the minimum', { baseAngleDeg: 14.99 }],
    ['an angle above the maximum', { baseAngleDeg: 165.01 }],
    ['a flat angle', { baseAngleDeg: 180 }],
    ['a NaN angle', { baseAngleDeg: Number.NaN }],
    ['an infinite angle', { baseAngleDeg: Number.POSITIVE_INFINITY }],
    ['a missing angle', { baseAngleDeg: undefined }],
    ['a side ratio below the minimum', { baseSideRatio: 0.2 }],
    ['an infinite side ratio', { baseSideRatio: Number.POSITIVE_INFINITY }],
    ['a height ratio above the maximum', { heightRatio: 4.01 }],
    ['a NaN height ratio', { heightRatio: Number.NaN }],
    ['a string ratio', { heightRatio: '1' }],
    ['a cuboid parameter', { widthRatio: 1 }],
  ])('rejects %s before allocating geometry', (_, override) => {
    const extrude = vi.spyOn(kernel.Manifold, 'extrude');
    const input = { shape: { ...defaultModelSpecs.parallelepiped.shape, ...override }, scale: { longestDimensionMm: 80 } };
    expect(() => generateModel(kernel, input as ModelSpec)).toThrow(InvalidModelSpecError);
    expect(extrude).not.toHaveBeenCalled();
  });
});
