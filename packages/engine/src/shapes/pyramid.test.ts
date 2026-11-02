import {
  defaultModelSpecs,
  type ModelSpecInput,
  PYRAMID_BASE_SIDES,
  type PyramidBaseSides,
  TETRAHEDRON_HEIGHT_RATIO,
} from '@diploma-3d/schema';
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
import { pyramidParameters } from './pyramid.ts';
import { regularBaseDimensionsMm } from './regular-base.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const scale = { longestDimensionMm: 80 };
const pyramid = (baseSides: PyramidBaseSides, heightRatio: number): ModelSpecInput => ({
  shape: { kind: 'pyramid', baseSides, heightRatio },
  scale,
});
const prism = (baseSides: PyramidBaseSides, heightRatio: number): ModelSpecInput => ({
  shape: { kind: 'prism', baseSides, heightRatio },
  scale,
});
const tetrahedron: ModelSpecInput = { shape: { kind: 'tetrahedron' }, scale };

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

// Width and depth of a base with edge 1 (derived in the prism tests); the apex above the centre lies within them.
const unitBaseExtents: Readonly<Record<PyramidBaseSides, readonly [number, number]>> = {
  3: [1, Math.sqrt(3) / 2],
  4: [1, 1],
  5: [(1 + Math.sqrt(5)) / 2, (1 + Math.cos(Math.PI / 5)) / (2 * Math.sin(Math.PI / 5))],
  6: [2, Math.sqrt(3)],
  8: [1 + Math.SQRT2, 1 + Math.SQRT2],
};

/** Independent references for a regular n-gonal pyramid with base edge a and height h. */
function pyramidReference(sides: number, a: number, h: number) {
  const baseArea = (sides * a ** 2) / (4 * Math.tan(Math.PI / sides));
  // The slant height runs from the apex to the middle of a base edge, at the apothem r from the centre.
  const apothem = a / (2 * Math.tan(Math.PI / sides));
  const circumradius = a / (2 * Math.sin(Math.PI / sides));
  const slantHeight = Math.hypot(h, apothem);
  return {
    baseArea,
    lateralEdge: Math.hypot(h, circumradius),
    volume: (baseArea * h) / 3,
    surfaceArea: baseArea + (sides * a * slantHeight) / 2,
  };
}

const vertices = (mesh: TriangleMesh): Vec3[] =>
  Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex));

/** Vertices in z = 0, ordered counter-clockwise around the origin. */
const baseRing = (mesh: TriangleMesh): Vec3[] =>
  vertices(mesh)
    .filter((vertex) => Math.abs(vertex[2]) < ABSOLUTE_TOLERANCE_MM)
    .sort((p, q) => Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]));

/** Every triangle has a real area and faces away from a point inside the convex solid. */
function expectOutwardNondegenerateTriangles(mesh: TriangleMesh, interior: Vec3, minimumArea: number) {
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const areaVector = triangleAreaVector(mesh, triangle);
    expect(length(areaVector) / 2).toBeGreaterThan(minimumArea);
    const [a, b, c] = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex)) as [Vec3, Vec3, Vec3];
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    expect(dot(areaVector, subtract(centroid, interior))).toBeGreaterThan(0);
  }
}

describe('generateModel for a regular pyramid', () => {
  it('builds the default square pyramid with h = a = 80 mm', () => {
    const model = generateModel(kernel, defaultModelSpecs.pyramid);
    expect(model.kind).toBe('pyramid');
    expect(model.name).toBe('pyramid-4-sided');
    expect(model.solids.map((solid) => solid.name)).toEqual(['pyramid-4-sided']);
    const { edge, height } = regularBaseDimensionsMm(defaultModelSpecs.pyramid.shape, scale);
    expectRelativelyClose(edge, 80);
    expectRelativelyClose(height, 80);
    const { bounds } = model.solids[0]?.measurements ?? {};
    const expectedMin = [-40, -40, 0] as const;
    const expectedMax = [40, 40, 80] as const;
    for (const axis of [0, 1, 2] as const) {
      expect(Math.abs((bounds?.min[axis] ?? Number.NaN) - expectedMin[axis])).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      expect(Math.abs((bounds?.max[axis] ?? Number.NaN) - expectedMax[axis])).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    }
  });

  const cases = PYRAMID_BASE_SIDES.flatMap((sides) =>
    [0.25, 0.5, 1, 1.1, 2.05, 4].map((heightRatio) => [sides, heightRatio] as const),
  );

  it.each(cases)('with %s base sides and h/a = %s matches the analytic geometry at L = 80 mm', (sides, heightRatio) => {
    const spec = pyramid(sides, heightRatio);
    const { mesh, measurements } = onlySolid(spec);
    const a = 80 / Math.max(...unitBaseExtents[sides], heightRatio);
    const h = heightRatio * a;
    const reference = pyramidReference(sides, a, h);
    const dimensions = regularBaseDimensionsMm(pyramidParameters({ kind: 'pyramid', baseSides: sides, heightRatio }), scale);
    expectRelativelyClose(dimensions.edge, a);
    expectRelativelyClose(dimensions.height, h);

    // n base vertices and one apex; the base is triangulated into n − 2 triangles and each side is one triangle.
    expect(mesh.positions.length / 3).toBe(sides + 1);
    expect(triangleCount(mesh)).toBe(2 * sides - 2);
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(measurements.volume).toBeGreaterThan(0);
    expectOutwardNondegenerateTriangles(mesh, [0, 0, h / 4], 1e-3 * a ** 2);

    // Standing on the build plate, with the longest bounding-box dimension at the export size.
    expect(measurements.bounds.min[2]).toBe(0);
    expectRelativelyClose(Math.max(...measurements.size), 80);
    expectRelativelyClose(measurements.size[0], unitBaseExtents[sides][0] * a);
    expectRelativelyClose(measurements.size[1], unitBaseExtents[sides][1] * a);

    // A regular base with n equal edges a, centred at the origin.
    const base = baseRing(mesh);
    expect(base).toHaveLength(sides);
    base.forEach(([x, y], index) => {
      const [nextX, nextY] = base[(index + 1) % sides] as Vec3;
      expectRelativelyClose(Math.hypot(nextX - x, nextY - y), a);
    });
    const [cx, cy] = base.reduce<[number, number]>(([sx, sy], [x, y]) => [sx + x / sides, sy + y / sides], [0, 0]);
    expect(Math.hypot(cx, cy)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);

    // The apex lies directly above the base centre at the perpendicular height h, with equal lateral edges.
    const [apex, ...rest] = vertices(mesh).filter((vertex) => vertex[2] > ABSOLUTE_TOLERANCE_MM);
    expect(rest).toEqual([]);
    if (apex === undefined) throw new Error('No apex');
    expect(Math.hypot(apex[0] - cx, apex[1] - cy)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    expectRelativelyClose(apex[2], h);
    for (const vertex of base) {
      expectRelativelyClose(length(subtract(apex, vertex)), reference.lateralEdge);
    }

    // Measured on the mesh: A = n·a² / (4·tan(π/n)), V = A·h / 3, S = A + n·a·√(h² + r²) / 2 with the apothem r.
    let bottomArea = 0;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const [x, y, z] = triangleAreaVector(mesh, triangle);
      if (x === 0 && y === 0 && z < 0) bottomArea -= z / 2;
    }
    expectRelativelyClose(bottomArea, reference.baseArea);
    expectRelativelyClose(measurements.volume, reference.volume);
    expectRelativelyClose(measurements.surfaceArea, reference.surfaceArea);
  });

  it.each(cases)(
    'with %s base sides and h/a = %s has one third of the volume of the prism over the same base',
    (sides, ratio) => {
      const pyramidSolid = onlySolid(pyramid(sides, ratio)).measurements;
      const prismSolid = onlySolid(prism(sides, ratio)).measurements;
      // Equal up to float32 rounding: the prism is scaled once from its unnormalised extrusion, the pyramid from model units.
      pyramidSolid.size.forEach((size, axis) => {
        expectRelativelyClose(size, prismSolid.size[axis] as number);
      });
      expectRelativelyClose(pyramidSolid.volume, prismSolid.volume / 3);
    },
  );

  it('is deterministic', () => {
    expect(onlySolid(pyramid(5, 1.1)).mesh).toEqual(onlySolid(pyramid(5, 1.1)).mesh);
  });

  it.each([
    ['2 base sides', { kind: 'pyramid', baseSides: 2, heightRatio: 1 }],
    ['7 base sides', { kind: 'pyramid', baseSides: 7, heightRatio: 1 }],
    ['9 base sides', { kind: 'pyramid', baseSides: 9, heightRatio: 1 }],
    ['a fractional side count', { kind: 'pyramid', baseSides: 4.5, heightRatio: 1 }],
    ['a string side count', { kind: 'pyramid', baseSides: '4', heightRatio: 1 }],
    ['a height ratio below the minimum', { kind: 'pyramid', baseSides: 4, heightRatio: 0.2 }],
    ['a height ratio above the maximum', { kind: 'pyramid', baseSides: 4, heightRatio: 4.01 }],
    ['a NaN height ratio', { kind: 'pyramid', baseSides: 4, heightRatio: Number.NaN }],
    ['a missing height ratio', { kind: 'pyramid', baseSides: 4 }],
    ['a tetrahedron with a height ratio', { kind: 'tetrahedron', heightRatio: 1 }],
    ['a tetrahedron with a base', { kind: 'tetrahedron', baseSides: 4 }],
  ])('rejects %s before allocating geometry', (_, shape) => {
    const extrude = vi.spyOn(kernel.Manifold, 'extrude');
    expect(() => generateModel(kernel, { shape, scale } as ModelSpecInput)).toThrow(InvalidModelSpecError);
    expect(extrude).not.toHaveBeenCalled();
  });
});

describe('generateModel for a regular tetrahedron', () => {
  // The triangle base is a wide and √3/2·a deep, and h = √(2/3)·a ≈ 0,816a, so the base edge is the longest dimension.
  const a = 80;

  it('has six equal edges, the independent height, volume and surface area, and four outward faces', () => {
    const model = generateModel(kernel, tetrahedron);
    expect(model.name).toBe('tetrahedron');
    const { mesh, measurements } = model.solids[0] ?? onlySolid(tetrahedron);

    const corners = vertices(mesh);
    expect(corners).toHaveLength(4);
    expect(triangleCount(mesh)).toBe(4);
    expect(findMeshDefects(mesh)).toEqual([]);
    const edges = corners.flatMap((p, i) => corners.slice(i + 1).map((q) => length(subtract(p, q))));
    expect(edges).toHaveLength(6);
    for (const edge of edges) expectRelativelyClose(edge, a);

    expect(measurements.bounds.min[2]).toBe(0);
    expectRelativelyClose(measurements.size[2], a * Math.sqrt(2 / 3));
    expectRelativelyClose(measurements.volume, a ** 3 / (6 * Math.SQRT2));
    expectRelativelyClose(measurements.surfaceArea, Math.sqrt(3) * a ** 2);
    expectOutwardNondegenerateTriangles(mesh, [0, 0, measurements.size[2] / 4], 1);
  });

  it('is the regular triangular pyramid with h/a = √(2/3) at full precision', () => {
    expect(pyramidParameters({ kind: 'tetrahedron' })).toEqual({ baseSides: 3, heightRatio: TETRAHEDRON_HEIGHT_RATIO });
    expect(onlySolid(tetrahedron).mesh).toEqual(onlySolid(pyramid(3, TETRAHEDRON_HEIGHT_RATIO)).mesh);
    // The nearest control steps give visibly different solids.
    for (const stepped of [0.75, 1]) {
      expect(onlySolid(pyramid(3, stepped)).measurements.volume).not.toBeCloseTo(onlySolid(tetrahedron).measurements.volume, 0);
    }
  });
});
