import {
  defaultModelSpecs,
  type ModelSpecInput,
  PRISM_BASE_SIDES,
  type PrismBaseSides,
  type RegularPrismShape,
} from '@diploma-3d/schema';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InvalidModelSpecError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { findMeshDefects, type TriangleMesh, triangleAreaVector, triangleCount, type Vec3, vertexAt } from '../mesh.ts';
import { generateModel } from '../model.ts';
import { regularBaseDimensionsMm } from './regular-base.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const prism = (baseSides: PrismBaseSides, heightRatio: number, longestDimensionMm = 80): ModelSpecInput => ({
  shape: { kind: 'prism', baseSides, heightRatio },
  scale: { longestDimensionMm },
});

const onlySolid = (spec: ModelSpecInput) => {
  const [solid] = generateModel(kernel, spec).solids;
  if (solid === undefined) throw new Error('No solid');
  return solid;
};

// Vertices come from float32 positions of 80 mm-sized values: about 1e-5 mm absolute, 1e-6 relative.
const RELATIVE_TOLERANCE = 1e-6;
const expectRelativelyClose = (actual: number | undefined, expected: number) => {
  expect(Math.abs((actual ?? Number.NaN) / expected - 1)).toBeLessThan(RELATIVE_TOLERANCE);
};
const ABSOLUTE_TOLERANCE_MM = 1e-4;

/**
 * Width and depth of the base with edge 1, from elementary geometry rather than from the construction: the triangle is
 * 1 wide and √3/2 deep, the pentagon's width is the diagonal φ and its depth R(1 + cos 36°) with R = 1 / (2 sin 36°),
 * the hexagon is 2 wide (two circumradii) and √3 deep, and the octagon, with flat edges on all four sides, is the edge
 * plus two diagonal edges' projections, 1 + 2 · (1/√2) = 1 + √2, in both directions.
 */
const unitBaseExtents: Readonly<Record<PrismBaseSides, readonly [number, number]>> = {
  3: [1, Math.sqrt(3) / 2],
  4: [1, 1],
  5: [(1 + Math.sqrt(5)) / 2, (1 + Math.cos(Math.PI / 5)) / (2 * Math.sin(Math.PI / 5))],
  6: [2, Math.sqrt(3)],
  8: [1 + Math.SQRT2, 1 + Math.SQRT2],
};

/** Base edge a for the longest bounding-box dimension L. */
const expectedEdge = (sides: PrismBaseSides, heightRatio: number, longest = 80) =>
  longest / Math.max(...unitBaseExtents[sides], heightRatio);

const baseArea = (sides: number, a: number) => (sides * a ** 2) / (4 * Math.tan(Math.PI / sides));

/** Vertices of the mesh at height z, ordered counter-clockwise around their centre. */
function ringAt(mesh: TriangleMesh, z: number): Vec3[] {
  const ring = Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex)).filter(
    (vertex) => Math.abs(vertex[2] - z) < ABSOLUTE_TOLERANCE_MM,
  );
  const [cx, cy] = ring.reduce(([sx, sy], [x, y]) => [sx + x / ring.length, sy + y / ring.length], [0, 0]);
  return ring.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
}

/** Area of the faces whose outward normal is exactly −Z (the bottom base) or +Z (the top base). */
function capArea(mesh: TriangleMesh, direction: 1 | -1): number {
  let area = 0;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [x, y, z] = triangleAreaVector(mesh, triangle);
    if (x === 0 && y === 0 && Math.sign(z) === direction) area += Math.abs(z) / 2;
  }
  return area;
}

describe('generateModel for a regular prism', () => {
  it('builds the default triangular prism with a = 40 mm and h = 2a = 80 mm', () => {
    const model = generateModel(kernel, defaultModelSpecs.prism);
    expect(model.kind).toBe('prism');
    expect(model.name).toBe('prism-3-sided');
    expect(model.solids.map((solid) => solid.name)).toEqual(['prism-3-sided']);
    expect(regularBaseDimensionsMm(defaultModelSpecs.prism.shape, defaultModelSpecs.prism.scale)).toEqual({
      edge: 40,
      height: 80,
    });
    const { size, bounds } = model.solids[0]?.measurements ?? {};
    expectRelativelyClose(size?.[0], 40);
    expectRelativelyClose(size?.[1], 20 * Math.sqrt(3));
    expectRelativelyClose(size?.[2], 80);
    expect(bounds?.min[2]).toBe(0);
  });

  const cases = PRISM_BASE_SIDES.flatMap((sides) =>
    [0.25, 0.5, 1, 1.1, 2.05, 4].map((heightRatio) => [sides, heightRatio] as const),
  );

  it.each(cases)('with %s base sides and h/a = %s matches the analytic geometry at L = 80 mm', (sides, heightRatio) => {
    const spec = prism(sides, heightRatio);
    const { mesh, measurements } = onlySolid(spec);
    const a = expectedEdge(sides, heightRatio);
    const h = heightRatio * a;
    const dimensions = regularBaseDimensionsMm(spec.shape as RegularPrismShape, spec.scale);
    expectRelativelyClose(dimensions.edge, a);
    expectRelativelyClose(dimensions.height, h);

    // Closed and outward-oriented, standing on the build plate, with the longest dimension at the export size.
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(measurements.volume).toBeGreaterThan(0);
    expect(measurements.bounds.min[2]).toBe(0);
    expectRelativelyClose(measurements.size[2], h);
    expectRelativelyClose(Math.max(...measurements.size), 80);
    const [width, depth] = unitBaseExtents[sides];
    expectRelativelyClose(measurements.size[0], width * a);
    expectRelativelyClose(measurements.size[1], depth * a);

    // The base: n equal edges a, centred at the origin, with its lowest edge parallel to X.
    const bottom = ringAt(mesh, 0);
    expect(bottom).toHaveLength(sides);
    bottom.forEach(([x, y], index) => {
      const [nextX, nextY] = bottom[(index + 1) % sides] as Vec3;
      expectRelativelyClose(Math.hypot(nextX - x, nextY - y), a);
    });
    const centre = bottom.reduce<[number, number]>(([sx, sy], [x, y]) => [sx + x / sides, sy + y / sides], [0, 0]);
    expect(Math.abs(centre[0])).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    expect(Math.abs(centre[1])).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    const lowest = [...bottom].sort((p, q) => p[1] - q[1]).slice(0, 2);
    expect(Math.abs((lowest[0]?.[1] ?? 0) - (lowest[1]?.[1] ?? 1))).toBeLessThan(ABSOLUTE_TOLERANCE_MM);

    // Lateral edges are perpendicular to the base: the top base is the bottom base moved up by h.
    const top = ringAt(mesh, h);
    expect(top).toHaveLength(sides);
    for (const [x, y] of bottom) {
      expect(top.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < ABSOLUTE_TOLERANCE_MM)).toBe(true);
    }

    // Measured on the mesh and compared with A = n·a² / (4·tan(π/n)), V = A·h and S = 2A + n·a·h.
    const area = baseArea(sides, a);
    expectRelativelyClose(capArea(mesh, -1), area);
    expectRelativelyClose(capArea(mesh, 1), area);
    expectRelativelyClose(measurements.volume, area * h);
    expectRelativelyClose(measurements.surfaceArea, 2 * area + sides * a * h);
  });

  it.each([
    [6, 0.25, 40, 10],
    [5, 1, 160 / (1 + Math.sqrt(5)), 160 / (1 + Math.sqrt(5))],
    [3, 4, 20, 80],
    [4, 0.5, 80, 40],
    [8, 1, 80 / (1 + Math.SQRT2), 80 / (1 + Math.SQRT2)],
    [8, 4, 20, 80],
  ] as const)('with %s sides and h/a = %s has a = %s mm and h = %s mm', (sides, heightRatio, a, h) => {
    const spec = prism(sides, heightRatio);
    const dimensions = regularBaseDimensionsMm(spec.shape as RegularPrismShape, spec.scale);
    expectRelativelyClose(dimensions.edge, a);
    expectRelativelyClose(dimensions.height, h);
    expectRelativelyClose(onlySolid(spec).measurements.size[2], h);
  });

  it.each([80, 37.5])('with a square base and h = a matches the cube at L = %s mm', (longest) => {
    const fromPrism = onlySolid(prism(4, 1, longest)).measurements;
    const fromCube = onlySolid({ shape: { kind: 'cube' }, scale: { longestDimensionMm: longest } }).measurements;
    for (const axis of [0, 1, 2] as const) {
      expectRelativelyClose(fromPrism.size[axis], fromCube.size[axis]);
      expect(Math.abs(fromPrism.bounds.min[axis] - fromCube.bounds.min[axis])).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      expect(Math.abs(fromPrism.bounds.max[axis] - fromCube.bounds.max[axis])).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    }
    expectRelativelyClose(fromPrism.volume, fromCube.volume);
    expectRelativelyClose(fromPrism.surfaceArea, fromCube.surfaceArea);
  });

  it('is deterministic', () => {
    expect(onlySolid(prism(5, 1.1)).mesh).toEqual(onlySolid(prism(5, 1.1)).mesh);
  });

  it.each([
    ['2 base sides', { shape: { kind: 'prism', baseSides: 2, heightRatio: 2 } }],
    ['7 base sides', { shape: { kind: 'prism', baseSides: 7, heightRatio: 2 } }],
    ['9 base sides', { shape: { kind: 'prism', baseSides: 9, heightRatio: 2 } }],
    ['a fractional side count', { shape: { kind: 'prism', baseSides: 4.5, heightRatio: 2 } }],
    ['a string side count', { shape: { kind: 'prism', baseSides: '4', heightRatio: 2 } }],
    ['a missing side count', { shape: { kind: 'prism', heightRatio: 2 } }],
    ['a height ratio below the minimum', { shape: { kind: 'prism', baseSides: 3, heightRatio: 0.12 } }],
    ['a height ratio above the maximum', { shape: { kind: 'prism', baseSides: 3, heightRatio: 8.01 } }],
    ['a NaN height ratio', { shape: { kind: 'prism', baseSides: 3, heightRatio: Number.NaN } }],
    ['an infinite height ratio', { shape: { kind: 'prism', baseSides: 3, heightRatio: Number.POSITIVE_INFINITY } }],
    ['a missing height ratio', { shape: { kind: 'prism', baseSides: 3 } }],
    ['a cuboid parameter', { shape: { kind: 'prism', baseSides: 3, heightRatio: 2, widthRatio: 1 } }],
  ])('rejects %s before allocating geometry', (_, input) => {
    const extrude = vi.spyOn(kernel.Manifold, 'extrude');
    const spec = { ...input, scale: { longestDimensionMm: 80 } };
    expect(() => generateModel(kernel, spec as ModelSpecInput)).toThrow(InvalidModelSpecError);
    expect(extrude).not.toHaveBeenCalled();
  });
});
