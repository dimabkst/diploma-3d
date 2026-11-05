import type { ModelSpecInput, PyramidShape } from '@diploma-3d/schema';
import { isWithinMinimumInclination, TETRAHEDRON_HEIGHT_RATIO } from '@diploma-3d/schema';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  findMeshDefects,
  measureMesh,
  meshFromManifold,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
} from '../mesh.ts';
import { generateModel } from '../model.ts';
import { withScope } from '../scope.ts';
import { type BaseShape, baseVertices } from './base.ts';
import { polygonSize, signedPolygonArea, type Vec2 } from './polygon.ts';
import { pyramidShapeDimensionsMm, pyramidShapeProportions } from './pyramid.ts';
import {
  buildUnscaledPyramid,
  type PyramidProportions,
  pyramidBoundingSize,
  pyramidDimensionsMm,
  pyramidScaleMm,
} from './pyramid-geometry.ts';
import { regularBaseDimensionsMm } from './regular-base.ts';
import { regularPolygonVertices } from './regular-polygon.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const L80 = { longestDimensionMm: 80 };

const pyramidShape = (base: BaseShape, heightRatio: number, apexXRatio = 0, apexYRatio = 0): PyramidShape =>
  ({ kind: 'pyramid', ...base, heightRatio, apexXRatio, apexYRatio }) as PyramidShape;

const onlySolid = (spec: ModelSpecInput) => {
  const [solid] = generateModel(kernel, spec).solids;
  if (solid === undefined) throw new Error('No solid');
  return solid;
};

const unscaledMesh = (pyramid: PyramidProportions): TriangleMesh =>
  withScope((track) => meshFromManifold(buildUnscaledPyramid(kernel, track, pyramid)));

// Vertices come from float32 positions of 80 mm-sized values: about 1e-5 mm absolute, 1e-6 relative. Areas of thin
// faces lose relative precision through cancellation.
const RELATIVE_TOLERANCE = 1e-6;
const AREA_TOLERANCE = 1e-5;
const expectRelativelyClose = (actual: number | undefined, expected: number, tolerance = RELATIVE_TOLERANCE) => {
  expect(Math.abs((actual ?? Number.NaN) / expected - 1)).toBeLessThan(tolerance);
};
const ABSOLUTE_TOLERANCE_MM = 1e-4;

const verticesOf = (mesh: TriangleMesh): Vec3[] =>
  Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex));

/** Areas of the faces whose outward normal is exactly −Z (the base) and of all others (the lateral faces). */
function faceAreas(mesh: TriangleMesh): { base: number; lateral: number } {
  const areas = { base: 0, lateral: 0 };
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [x, y, z] = triangleAreaVector(mesh, triangle);
    if (x === 0 && y === 0 && z < 0) areas.base += Math.abs(z) / 2;
    else areas.lateral += Math.hypot(x, y, z) / 2;
  }
  return areas;
}

const distance = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** The distance from point p to the line through q and r, from the projection of p onto that line. */
function distanceToLine(p: Vec3, q: Vec3, r: Vec3): number {
  const direction: Vec3 = [r[0] - q[0], r[1] - q[1], r[2] - q[2]];
  const t =
    ((p[0] - q[0]) * direction[0] + (p[1] - q[1]) * direction[1] + (p[2] - q[2]) * direction[2]) / Math.hypot(...direction) ** 2;
  return distance(p, [q[0] + t * direction[0], q[1] + t * direction[1], q[2] + t * direction[2]]);
}

describe('the reference pyramid: unit square base, h0 = 1, apex A0 = (−0,5, −0,5, 1) above a corner', () => {
  const reference: PyramidProportions = { base: regularPolygonVertices(4), height: 1, apex: [-0.5, -0.5] };

  it('has the base area 1, volume 1/3, lateral edges 1, √2, √3, √2, surface 2 + √2 and a 1 × 1 × 1 box', () => {
    const [b0, b1, b2, b3] = reference.base as [Vec2, Vec2, Vec2, Vec2];
    expect([b0, b1, b2, b3].map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2])).toEqual([
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ]);
    // L = 1 keeps the unscaled values: the box is 1 × 1 × 1.
    const unscaled = pyramidDimensionsMm(reference, { longestDimensionMm: 1 });
    expect(unscaled.edge).toBeCloseTo(1, 15);
    expect(unscaled.baseArea).toBeCloseTo(1, 15);
    expect(unscaled.volume).toBeCloseTo(1 / 3, 15);
    [1, Math.SQRT2, Math.sqrt(3), Math.SQRT2].forEach((edge, index) => {
      expect(unscaled.lateralEdges[index]).toBeCloseTo(edge, 15);
    });
    // The faces over the two edges through the corner are vertical (height 1); the others lean (height √2).
    [1, Math.SQRT2, Math.SQRT2, 1].forEach((height, index) => {
      expect(unscaled.faceHeights[index]).toBeCloseTo(height, 15);
    });
    expect(unscaled.lateralArea).toBeCloseTo(1 + Math.SQRT2, 15);
    expect(unscaled.surfaceArea).toBeCloseTo(2 + Math.SQRT2, 14);
    pyramidBoundingSize(reference).forEach((size) => {
      expect(size).toBeCloseTo(1, 15);
    });

    const mesh = unscaledMesh(reference);
    const measurements = measureMesh(mesh);
    expect(findMeshDefects(mesh)).toEqual([]);
    expectRelativelyClose(measurements.volume, 1 / 3);
    expectRelativelyClose(measurements.surfaceArea, 2 + Math.SQRT2);
    for (const size of measurements.size) expectRelativelyClose(size, 1);
  });

  it('is scaled by 80 for the 80 mm export, with the apex at (−40, −40, 80) mm', () => {
    expect(pyramidScaleMm(reference, L80)).toBeCloseTo(80, 12);
    const dimensions = pyramidDimensionsMm(reference, L80);
    expect(dimensions.height).toBeCloseTo(80, 12);
    dimensions.apex.forEach((value, axis) => {
      expect(value).toBeCloseTo([-40, -40, 80][axis] as number, 12);
    });
    expect(dimensions.volume).toBeCloseTo(512_000 / 3, 7);
  });

  it('is 1,5 × 1 × 1 with the apex at (1, 0, 1): the box spans the base and the single apex, not a moved base', () => {
    const outside: PyramidProportions = { ...reference, apex: [1, 0] };
    const [width, depth, height] = pyramidBoundingSize(outside);
    expect(width).toBeCloseTo(1.5, 15);
    expect(depth).toBeCloseTo(1, 15);
    expect(height).toBe(1);
    expect(pyramidScaleMm(outside, L80)).toBeCloseTo(80 / 1.5, 12);
    const { measurements } = onlySolid({ shape: pyramidShape({ baseType: 'regular', baseSides: 4 }, 1, 1, 0), scale: L80 });
    for (const [axis, min, max] of [
      [0, -80 / 3, 160 / 3],
      [1, -80 / 3, 80 / 3],
      [2, 0, 160 / 3],
    ] as const) {
      expect(measurements.bounds.min[axis]).toBeCloseTo(min, 4);
      expect(measurements.bounds.max[axis]).toBeCloseTo(max, 4);
    }
  });
});

describe('moving the apex before normalisation', () => {
  it.each([[[0.5, 0]], [[-4, 4]], [[0.1, -2.35]]] as const)(
    'preserves the unscaled volume base area × h0 / 3 for the apex %j',
    (apex) => {
      for (const base of [
        { baseType: 'regular', baseSides: 6 },
        { baseType: 'triangle', baseSideRatio: 2, baseAngleDeg: 120 },
        { baseType: 'trapezoid', parallelSideRatio: 0.5, baseHeightRatio: 1, baseShiftRatio: 0.75 },
      ] as const) {
        const pyramid: PyramidProportions = { base: baseVertices(base), height: 1.1, apex };
        const volume = measureMesh(unscaledMesh(pyramid)).volume;
        expectRelativelyClose(volume, (signedPolygonArea(pyramid.base) * 1.1) / 3);
        expectRelativelyClose(volume, measureMesh(unscaledMesh({ ...pyramid, apex: [0, 0] })).volume);
      }
    },
  );
});

const BASES: readonly (readonly [string, BaseShape])[] = [
  ...([3, 4, 5, 6, 8] as const).map((baseSides) => [`regular ${baseSides}-gon`, { baseType: 'regular', baseSides }] as const),
  ['right triangle', { baseType: 'triangle', baseSideRatio: 0.75, baseAngleDeg: 90 }],
  ['acute triangle', { baseType: 'triangle', baseSideRatio: 4, baseAngleDeg: 15 }],
  ['obtuse triangle', { baseType: 'triangle', baseSideRatio: 1, baseAngleDeg: 120 }],
  ['rhombus', { baseType: 'parallelogram', baseSideRatio: 1, baseAngleDeg: 60 }],
  ['long parallelogram', { baseType: 'parallelogram', baseSideRatio: 4, baseAngleDeg: 165 }],
  ['rectangle', { baseType: 'parallelogram', baseSideRatio: 0.25, baseAngleDeg: 90 }],
  ['right trapezoid', { baseType: 'trapezoid', parallelSideRatio: 0.5, baseHeightRatio: 0.375, baseShiftRatio: -0.25 }],
  ['parallelogram trapezoid', { baseType: 'trapezoid', parallelSideRatio: 1, baseHeightRatio: 0.5, baseShiftRatio: 0.6 }],
  ['separated trapezoid', { baseType: 'trapezoid', parallelSideRatio: 0.25, baseHeightRatio: 0.5, baseShiftRatio: 2 }],
];

/** Apex positions: the centroid, inside, above vertex 0 and above the midpoint of edge 0, and outside the base. */
function apexPositions(base: readonly Vec2[]): readonly (readonly [string, Vec2])[] {
  const [b0, b1] = base as [Vec2, Vec2];
  return [
    ['the centroid', [0, 0]],
    ['inside', [0.05, -0.1]],
    ['a vertex', b0],
    ['an edge', [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2]],
    ['outside', [4, -4]],
    ['outside, off-step', [-2.35, 3.05]],
  ];
}

describe('generateModel for a pyramid over every base type with a positioned apex', () => {
  const cases = BASES.flatMap(([name, base]) =>
    apexPositions(baseVertices(base)).flatMap(([where, apex]) =>
      [0.25, 1, 4]
        // Flatter than the minimum inclination is outside the domain.
        .filter((h0) => isWithinMinimumInclination(h0, Math.hypot(...apex)))
        .map((h0) => [name, where, h0, base, apex] as const),
    ),
  );

  it.each(cases)('over a %s with the apex above %s and h/a = %s matches its definition', (_, __, h0, base, apex) => {
    const shape = pyramidShape(base, h0, apex[0], apex[1]);
    const proportions = pyramidShapeProportions(shape);
    const { mesh, measurements } = onlySolid({ shape, scale: L80 });
    const vertices = baseVertices(base);

    // The box spans the base and the apex's projection; its longest side is 80 mm.
    const [width0, depth0] = polygonSize([...vertices, apex]);
    const s = 80 / Math.max(width0, depth0, h0);
    const dimensions = pyramidShapeDimensionsMm(shape, L80);
    expectRelativelyClose(dimensions.edge, s);
    expectRelativelyClose(dimensions.height, h0 * s);
    expectRelativelyClose(measurements.size[0], width0 * s);
    expectRelativelyClose(measurements.size[1], depth0 * s);
    expectRelativelyClose(measurements.size[2], h0 * s);
    expectRelativelyClose(Math.max(...measurements.size), 80);
    expect(measurements.bounds.min[2]).toBe(0);
    expect(proportions.apex).toEqual(apex);

    // A closed, outward solid with n base vertices and one apex: n − 2 base triangles and n lateral triangles.
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(measurements.volume).toBeGreaterThan(0);
    expect(triangleCount(mesh)).toBe(2 * vertices.length - 2);
    const points = verticesOf(mesh);
    expect(points).toHaveLength(vertices.length + 1);
    const apexPoints = points.filter((point) => point[2] > ABSOLUTE_TOLERANCE_MM);
    expect(apexPoints).toHaveLength(1);
    const meshApex = apexPoints[0] as Vec3;
    const expectedApex: Vec3 = [apex[0] * s, apex[1] * s, h0 * s];
    expect(distance(meshApex, expectedApex)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    dimensions.apex.forEach((value, axis) => {
      expect(Math.abs(value - (expectedApex[axis] as number))).toBeLessThan(1e-9);
    });

    // Lateral edges and face heights, independently from the base vertices and the apex.
    const scaled = vertices.map(([x, y]): Vec3 => [x * s, y * s, 0]);
    scaled.forEach((vertex, index) => {
      expect(points.some((point) => distance(point, vertex) < ABSOLUTE_TOLERANCE_MM)).toBe(true);
      expectRelativelyClose(dimensions.lateralEdges[index], distance(expectedApex, vertex));
      expectRelativelyClose(
        dimensions.faceHeights[index],
        distanceToLine(expectedApex, vertex, scaled[(index + 1) % scaled.length] as Vec3),
      );
    });
    // Every lateral edge of the mesh joins a base vertex to the apex.
    const apexIndex = points.indexOf(meshApex);
    const apexNeighbours = new Set<number>();
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const corners = triangleAt(mesh, triangle);
      if (corners.includes(apexIndex)) for (const corner of corners) if (corner !== apexIndex) apexNeighbours.add(corner);
    }
    expect(apexNeighbours.size).toBe(vertices.length);

    // Mesh areas and volume against A, S = A + Σ faces and V = A·h / 3.
    const areas = faceAreas(mesh);
    const baseArea = signedPolygonArea(vertices) * s ** 2;
    expectRelativelyClose(dimensions.baseArea, baseArea);
    expectRelativelyClose(areas.base, baseArea, AREA_TOLERANCE);
    expectRelativelyClose(areas.lateral, dimensions.lateralArea, AREA_TOLERANCE);
    expectRelativelyClose(measurements.surfaceArea, dimensions.surfaceArea, AREA_TOLERANCE);
    expectRelativelyClose(measurements.volume, (baseArea * h0 * s) / 3, AREA_TOLERANCE);
    expectRelativelyClose(dimensions.volume, (baseArea * h0 * s) / 3);
    expectRelativelyClose(
      dimensions.lateralArea,
      dimensions.faceAreas.reduce((sum, area) => sum + area, 0),
    );
  });

  it.each([3, 4, 5, 6, 8] as const)('keeps the regular %s-gonal pyramid with the apex above the centre', (baseSides) => {
    const omitted = onlySolid({ shape: { kind: 'pyramid', baseSides, heightRatio: 1.1 }, scale: L80 });
    const explicit = onlySolid({ shape: pyramidShape({ baseType: 'regular', baseSides }, 1.1), scale: L80 });
    expect(explicit.mesh).toEqual(omitted.mesh);
    const dimensions = pyramidShapeDimensionsMm(pyramidShape({ baseType: 'regular', baseSides }, 1.1), L80);
    const regular = regularBaseDimensionsMm({ baseSides, heightRatio: 1.1 }, L80);
    expectRelativelyClose(dimensions.edge, regular.edge);
    expectRelativelyClose(dimensions.height, regular.height);
    // All lateral edges and all face heights (the apothem of the pyramid) agree.
    const circumradius = regular.edge / (2 * Math.sin(Math.PI / baseSides));
    const apothem = regular.edge / (2 * Math.tan(Math.PI / baseSides));
    for (const edge of dimensions.lateralEdges) expectRelativelyClose(edge, Math.hypot(regular.height, circumradius));
    for (const height of dimensions.faceHeights) expectRelativelyClose(height, Math.hypot(regular.height, apothem));
    expect(dimensions.sides).toEqual({});
  });

  it('builds the regular tetrahedron from an equilateral triangle with h/a = √(2/3) and the apex above the centroid', () => {
    const shape = pyramidShape({ baseType: 'triangle', baseSideRatio: 1, baseAngleDeg: 60 }, TETRAHEDRON_HEIGHT_RATIO);
    const dimensions = pyramidShapeDimensionsMm(shape, L80);
    const sides = [dimensions.edge, dimensions.sides.b, dimensions.sides.c, ...dimensions.lateralEdges];
    expect(sides).toHaveLength(6);
    for (const side of sides) expectRelativelyClose(side, dimensions.edge);
    const fromTriangle = onlySolid({ shape, scale: L80 });
    const tetrahedron = onlySolid({ shape: { kind: 'tetrahedron' }, scale: L80 });
    fromTriangle.measurements.size.forEach((size, axis) => {
      expectRelativelyClose(size, tetrahedron.measurements.size[axis] as number);
    });
    expectRelativelyClose(fromTriangle.measurements.volume, tetrahedron.measurements.volume);
    expectRelativelyClose(fromTriangle.measurements.surfaceArea, tetrahedron.measurements.surfaceArea);
  });

  it('gives each base its own sides', () => {
    const a = (shape: PyramidShape) => pyramidShapeDimensionsMm(shape, L80);
    const triangle = a(pyramidShape({ baseType: 'triangle', baseSideRatio: 0.75, baseAngleDeg: 90 }, 1));
    expect(triangle.edge).toBeCloseTo(80, 9);
    expect(triangle.sides).toEqual({ b: expect.closeTo(60, 9), c: expect.closeTo(100, 9) });
    const parallelogram = a(pyramidShape({ baseType: 'parallelogram', baseSideRatio: 2, baseAngleDeg: 120 }, 0.5));
    expect(parallelogram.sides).toEqual({ b: expect.closeTo(80, 9) });
    const trapezoid = a(
      pyramidShape({ baseType: 'trapezoid', parallelSideRatio: 0.5, baseHeightRatio: 0.375, baseShiftRatio: -0.25 }, 0.5),
    );
    expect(trapezoid.sides).toEqual({
      b: expect.closeTo(40, 9),
      c: expect.closeTo(50, 9),
      d: expect.closeTo(30, 9),
      t: expect.closeTo(30, 9),
    });
    // The trapezoid pyramid: V = 1800 · 40 / 3 mm³.
    expect(trapezoid.volume).toBeCloseTo(24_000, 7);
  });
});
