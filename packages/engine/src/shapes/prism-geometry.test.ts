import type {
  ModelSpecInput,
  ParallelepipedShape,
  PrismBaseSides,
  RegularPrismShape,
  TrapezoidPrismShape,
  TrianglePrismShape,
} from '@diploma-3d/schema';
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
import { parallelepipedDimensionsMm, parallelepipedProportions } from './parallelepiped.ts';
import { polygonSize, signedPolygonArea, type Vec2 } from './polygon.ts';
import {
  regularPrismDimensionsMm,
  regularPrismProportions,
  trapezoidPrismDimensionsMm,
  trapezoidPrismProportions,
  trianglePrismDimensionsMm,
  trianglePrismProportions,
} from './prism.ts';
import {
  buildUnscaledPrism,
  isOblique,
  type PrismProportions,
  prismBoundingSize,
  prismDimensionsMm,
  prismScaleMm,
  shearMatrix,
} from './prism-geometry.ts';
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

const prismShape = (baseSides: PrismBaseSides, heightRatio: number, offsetXRatio = 0, offsetYRatio = 0): RegularPrismShape => ({
  kind: 'prism',
  baseType: 'regular',
  baseSides,
  heightRatio,
  offsetXRatio,
  offsetYRatio,
});

const parallelepipedShape = (
  baseSideRatio: number,
  baseAngleDeg: number,
  heightRatio: number,
  offsetXRatio = 0,
  offsetYRatio = 0,
): ParallelepipedShape => ({ kind: 'parallelepiped', baseSideRatio, baseAngleDeg, heightRatio, offsetXRatio, offsetYRatio });

const onlySolid = (spec: ModelSpecInput) => {
  const [solid] = generateModel(kernel, spec).solids;
  if (solid === undefined) throw new Error('No solid');
  return solid;
};

/** The unscaled solid, copied out of the kernel before its WASM objects are released. */
const unscaledMesh = (prism: PrismProportions): TriangleMesh =>
  withScope((track) => meshFromManifold(buildUnscaledPrism(kernel, track, prism)));

// Vertices come from float32 positions of 80 mm-sized values: about 1e-5 mm absolute, 1e-6 relative.
const RELATIVE_TOLERANCE = 1e-6;
const expectRelativelyClose = (actual: number | undefined, expected: number, tolerance = RELATIVE_TOLERANCE) => {
  expect(Math.abs((actual ?? Number.NaN) / expected - 1)).toBeLessThan(tolerance);
};
// Areas of thin faces lose relative precision through cancellation: a 165° base with b/a = 0,25 is under 2 mm deep.
const AREA_TOLERANCE = 1e-5;
const ABSOLUTE_TOLERANCE_MM = 1e-4;

const verticesOf = (mesh: TriangleMesh): Vec3[] =>
  Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex));

const indexNear = (mesh: TriangleMesh, [x, y, z]: Vec3): number =>
  verticesOf(mesh).findIndex(([px, py, pz]) => Math.hypot(px - x, py - y, pz - z) < ABSOLUTE_TOLERANCE_MM);

/** Undirected mesh edges as "i:j" with i < j. */
function edgeSet(mesh: TriangleMesh): Set<string> {
  const edges = new Set<string>();
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle);
    corners.forEach((from, corner) => {
      const to = corners[(corner + 1) % 3] as number;
      edges.add(from < to ? `${from}:${to}` : `${to}:${from}`);
    });
  }
  return edges;
}

/** Areas of the faces whose outward normal is exactly −Z or +Z (the bases) and of all others (the lateral faces). */
function faceAreas(mesh: TriangleMesh): { bottom: number; top: number; lateral: number } {
  const areas = { bottom: 0, top: 0, lateral: 0 };
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [x, y, z] = triangleAreaVector(mesh, triangle);
    const area = Math.hypot(x, y, z) / 2;
    if (x === 0 && y === 0) areas[z > 0 ? 'top' : 'bottom'] += area;
    else areas.lateral += area;
  }
  return areas;
}

describe('shearMatrix and the installed manifold-3d transform', () => {
  it('stores the shear in the z column of the column-major matrix', () => {
    const prism: PrismProportions = { base: regularPolygonVertices(4), height: 2, offset: [1, -0.5] };
    expect(shearMatrix(prism)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0.5, -0.25, 1, 0, 0, 0, 0, 1]);
  });

  it('keeps the lower base, translates the upper base by the offset and every section in proportion to its height', () => {
    const prism: PrismProportions = { base: regularPolygonVertices(4), height: 2, offset: [1, -0.5] };
    const vertices = verticesOf(unscaledMesh(prism));
    expect(vertices).toHaveLength(8);
    const hasVertex = ([x, y, z]: Vec3) => vertices.some(([px, py, pz]) => Math.hypot(px - x, py - y, pz - z) < 1e-7);
    for (const [x, y] of prism.base) {
      expect(hasVertex([x, y, 0])).toBe(true);
      expect(hasVertex([x + 1, y - 0.5, 2])).toBe(true);
    }
    // A point at mid-height of a lateral edge moves by half the offset: the face through it is planar.
    const midpoint: Vec3 = [-0.5 + 0.5, -0.5 - 0.25, 1];
    const sides = withScope((track) => {
      const solid = buildUnscaledPrism(kernel, track, prism);
      const slice = track(solid.slice(1));
      return slice.toPolygons();
    });
    const sliceVertices = sides.flat().map(([x, y]) => [x, y]);
    expect(sliceVertices.some(([x, y]) => Math.hypot((x as number) - midpoint[0], (y as number) - midpoint[1]) < 1e-12)).toBe(
      true,
    );
  });
});

describe('the reference oblique prism: unit square base, h0 = 1, (dx0, dy0) = (1, 0)', () => {
  const reference: PrismProportions = { base: regularPolygonVertices(4), height: 1, offset: [1, 0] };

  it('has the unscaled volume 1, lateral edge √2, surface area 4 + 2√2 and a 2 × 1 × 1 bounding box', () => {
    const mesh = unscaledMesh(reference);
    const measurements = measureMesh(mesh);
    expect(findMeshDefects(mesh)).toEqual([]);
    // The mesh holds float32 positions.
    expectRelativelyClose(measurements.volume, 1);
    expectRelativelyClose(measurements.surfaceArea, 4 + 2 * Math.SQRT2);
    [2, 1, 1].forEach((size, axis) => {
      expectRelativelyClose(measurements.size[axis], size);
      expect(prismBoundingSize(reference)[axis]).toBeCloseTo(size, 15);
    });

    // With L = 2 the scale is 1, so the dimensions are the unscaled ones.
    const unscaled = prismDimensionsMm(reference, { longestDimensionMm: 2 });
    expect(unscaled.lateralEdge).toBeCloseTo(Math.SQRT2, 15);
    expect(unscaled.volume).toBeCloseTo(1, 15);
    expect(unscaled.surfaceArea).toBeCloseTo(4 + 2 * Math.SQRT2, 14);
    // Neither perimeter × h nor perimeter × l: two faces keep the area 1, the two sheared ones have the area √2.
    expect(unscaled.lateralArea).toBeCloseTo(2 + 2 * Math.SQRT2, 14);
    expect(unscaled.lateralArea).not.toBeCloseTo(4, 3);
    expect(unscaled.lateralArea).not.toBeCloseTo(4 * Math.SQRT2, 3);
  });

  it('is scaled by 40 for the 80 mm export: a = h = dx = 40 mm and the box is 80 × 40 × 40 mm', () => {
    expect(prismScaleMm(reference, L80)).toBeCloseTo(40, 12);
    const dimensions = prismDimensionsMm(reference, L80);
    expect(dimensions.edge).toBeCloseTo(40, 12);
    expect(dimensions.height).toBeCloseTo(40, 12);
    expect(dimensions.offset[0]).toBeCloseTo(40, 12);
    expect(dimensions.offset[1]).toBe(0);
    expect(dimensions.lateralEdge).toBeCloseTo(40 * Math.SQRT2, 12);
    expect(dimensions.volume).toBeCloseTo(64_000, 9);
    expect(dimensions.surfaceArea).toBeCloseTo(1600 * (4 + 2 * Math.SQRT2), 9);

    const { mesh, measurements } = onlySolid({ shape: prismShape(4, 1, 1, 0), scale: L80 });
    expect(findMeshDefects(mesh)).toEqual([]);
    for (const [axis, min, max] of [
      [0, -20, 60],
      [1, -20, 20],
      [2, 0, 40],
    ] as const) {
      expect(measurements.bounds.min[axis]).toBeCloseTo(min, 4);
      expect(measurements.bounds.max[axis]).toBeCloseTo(max, 4);
    }
    expect(measurements.bounds.min[2]).toBe(0);
    expectRelativelyClose(measurements.volume, 64_000);
    expectRelativelyClose(measurements.surfaceArea, 1600 * (4 + 2 * Math.SQRT2));
  });
});

describe('shear before normalisation', () => {
  it.each([[[1, 0]], [[-2, 2]], [[0.5, -1.25]]] as const)(
    'preserves the unscaled volume and base area for the offset %j',
    (offset) => {
      for (const sides of [3, 5, 8] as const) {
        const right = regularPrismProportions(prismShape(sides, 1.1));
        const oblique = { ...right, offset };
        const rightMesh = measureMesh(unscaledMesh(right));
        const obliqueMesh = unscaledMesh(oblique);
        // Equal up to the float32 rounding of the positions, and both equal to base area × h0.
        expectRelativelyClose(measureMesh(obliqueMesh).volume, rightMesh.volume);
        expectRelativelyClose(measureMesh(obliqueMesh).volume, signedPolygonArea(right.base) * right.height);
        expectRelativelyClose(faceAreas(obliqueMesh).bottom, signedPolygonArea(right.base));
        expectRelativelyClose(faceAreas(obliqueMesh).top, signedPolygonArea(right.base));
      }
    },
  );

  it('normalises after the shear: a larger offset widens the box, so the same ratios give a smaller solid', () => {
    const right = regularPrismDimensionsMm(prismShape(4, 1), L80);
    const oblique = regularPrismDimensionsMm(prismShape(4, 1, 2, 0), L80);
    // The box grows from 1 × 1 × 1 to 3 × 1 × 1, so a falls from 80 to 80/3 mm and the volume by a factor of 27.
    expect(right.edge).toBeCloseTo(80, 12);
    expect(oblique.edge).toBeCloseTo(80 / 3, 12);
    expect(oblique.volume / right.volume).toBeCloseTo(1 / 27, 12);
  });
});

/** Expected scale from the definition: the base's box widened by |dx0| and |dy0|, its height h0, and L = 80 mm. */
function expectedScale(base: readonly Vec2[], h0: number, [dx0, dy0]: Vec2): number {
  const [baseWidth, baseDepth] = polygonSize(base);
  return 80 / Math.max(baseWidth + Math.abs(dx0), baseDepth + Math.abs(dy0), h0);
}

/** Checks the generated solid against its definition; returns nothing, fails on the first difference. */
function expectPrismGeometry(spec: ModelSpecInput, proportions: PrismProportions) {
  const { base, height: h0, offset } = proportions;
  const { mesh, measurements } = onlySolid(spec);
  const s = expectedScale(base, h0, offset);
  const [dx, dy, h] = [offset[0] * s, offset[1] * s, h0 * s];

  // Scale, perpendicular height and lateral edge.
  const dimensions = prismDimensionsMm(proportions, L80);
  expectRelativelyClose(dimensions.edge, s);
  expectRelativelyClose(dimensions.height, h);
  expectRelativelyClose(dimensions.lateralEdge, Math.hypot(dx, dy, h));
  expect(isOblique(proportions)).toBe(offset[0] !== 0 || offset[1] !== 0);

  // A closed, outward solid of positive volume without degenerate triangles, as many as the right prism has.
  expect(findMeshDefects(mesh)).toEqual([]);
  expect(triangleCount(mesh)).toBe(4 * base.length - 4);
  expect(measurements.volume).toBeGreaterThan(0);

  // The bounding box: the lower base in z = 0 at its original position, the longest dimension at 80 mm.
  const [baseWidth, baseDepth] = polygonSize(base);
  expect(measurements.bounds.min[2]).toBe(0);
  expectRelativelyClose(measurements.size[0], (baseWidth + Math.abs(offset[0])) * s);
  expectRelativelyClose(measurements.size[1], (baseDepth + Math.abs(offset[1])) * s);
  expectRelativelyClose(measurements.size[2], h);
  expectRelativelyClose(Math.max(...measurements.size), 80);

  // The upper base is the lower one translated by (dx, dy, h), and each lateral edge joins a vertex to its image.
  const edges = edgeSet(mesh);
  expect(verticesOf(mesh)).toHaveLength(2 * base.length);
  for (const [x, y] of base) {
    const lower = indexNear(mesh, [x * s, y * s, 0]);
    const upper = indexNear(mesh, [x * s + dx, y * s + dy, h]);
    expect(lower).toBeGreaterThanOrEqual(0);
    expect(upper).toBeGreaterThanOrEqual(0);
    expect(edges.has(lower < upper ? `${lower}:${upper}` : `${upper}:${lower}`)).toBe(true);
  }

  // Mesh areas and volume against A = base area, S = 2A + Σ|e × v| and V = A·h.
  const areas = faceAreas(mesh);
  const baseArea = signedPolygonArea(base) * s ** 2;
  expectRelativelyClose(dimensions.baseArea, baseArea);
  expectRelativelyClose(areas.bottom, baseArea, AREA_TOLERANCE);
  expectRelativelyClose(areas.top, baseArea, AREA_TOLERANCE);
  expectRelativelyClose(areas.lateral, dimensions.lateralArea, AREA_TOLERANCE);
  expectRelativelyClose(measurements.surfaceArea, dimensions.surfaceArea, AREA_TOLERANCE);
  expectRelativelyClose(measurements.volume, baseArea * h, AREA_TOLERANCE);
  expectRelativelyClose(dimensions.volume, baseArea * h);
  if (!isOblique(proportions)) expectRelativelyClose(dimensions.lateralArea, dimensions.basePerimeter * h);
}

const OFFSETS: readonly Vec2[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 0.5],
  [0, -1.5],
  [-0.75, 1.25],
  [1.1, 0.35],
  [2, 2],
  [-2, -2],
  [2, -2],
  [-2, 2],
];

describe('generateModel for a prism over a regular polygon with a displaced upper base', () => {
  const cases = ([3, 4, 5, 6, 8] as const).flatMap((sides) =>
    [0.25, 1, 4].flatMap((h0) => OFFSETS.map((offset) => [sides, h0, offset] as const)),
  );

  it.each(cases)('with %s sides, h/a = %s and the offset %j matches its definition', (sides, h0, [dx0, dy0]) => {
    const shape = prismShape(sides, h0, dx0, dy0);
    expectPrismGeometry({ shape, scale: L80 }, regularPrismProportions(shape));
  });

  it.each([3, 4, 5, 6, 8] as const)('with %s sides and no offset reproduces the right prism exactly', (sides) => {
    const omitted = onlySolid({ shape: { kind: 'prism', baseSides: sides, heightRatio: 1.1 }, scale: L80 });
    const zero = onlySolid({ shape: prismShape(sides, 1.1), scale: L80 });
    const negativeZero = onlySolid({ shape: prismShape(sides, 1.1, -0, -0), scale: L80 });
    expect(zero.mesh).toEqual(omitted.mesh);
    expect(negativeZero.mesh).toEqual(omitted.mesh);
    const dimensions = regularPrismDimensionsMm(prismShape(sides, 1.1), L80);
    const regular = regularBaseDimensionsMm({ baseSides: sides, heightRatio: 1.1 }, L80);
    expectRelativelyClose(dimensions.edge, regular.edge);
    expectRelativelyClose(dimensions.height, regular.height);
    expect(dimensions.lateralEdge).toBe(dimensions.height);
  });
});

describe('generateModel for a parallelepiped with a displaced upper base', () => {
  const cases = (
    [
      [1, 60],
      [4, 15],
      [0.25, 165],
      [1.5, 90],
    ] as const
  ).flatMap(([b0, angle]) => [0.25, 1.1, 4].flatMap((h0) => OFFSETS.map((offset) => [b0, angle, h0, offset] as const)));

  it.each(cases)('with b/a = %s, α = %s°, h/a = %s and the offset %j matches its definition', (b0, angle, h0, [dx0, dy0]) => {
    const shape = parallelepipedShape(b0, angle, h0, dx0, dy0);
    expectPrismGeometry({ shape, scale: L80 }, parallelepipedProportions(shape));
    expectRelativelyClose(
      parallelepipedDimensionsMm(shape, L80).baseSideB,
      b0 * prismScaleMm(parallelepipedProportions(shape), L80),
    );
  });

  it('with α = 90° and an offset is an oblique solid over a rectangle: (dx, dy) moves the top of the 40 × 60 base', () => {
    // b/a = 1,5, h/a = 2 and (dx0, dy0) = (0,5, −0,5): the box is 1,5 × 2 × 2, so a = 40 mm and the offset (20, −20) mm.
    const { measurements } = onlySolid({ shape: parallelepipedShape(1.5, 90, 2, 0.5, -0.5), scale: L80 });
    for (const [axis, min, max] of [
      [0, -20, 40],
      [1, -50, 30],
      [2, 0, 80],
    ] as const) {
      expect(measurements.bounds.min[axis]).toBeCloseTo(min, 4);
      expect(measurements.bounds.max[axis]).toBeCloseTo(max, 4);
    }
    expectRelativelyClose(measurements.volume, 40 * 60 * 80);
  });
});

describe('generateModel for a prism over a configurable triangle', () => {
  const triangleShape = (
    baseSideRatio: number,
    baseAngleDeg: number,
    heightRatio: number,
    offsetXRatio = 0,
    offsetYRatio = 0,
  ): TrianglePrismShape => ({
    kind: 'prism',
    baseType: 'triangle',
    baseSideRatio,
    baseAngleDeg,
    heightRatio,
    offsetXRatio,
    offsetYRatio,
  });

  const cases = (
    [
      [1, 60],
      [0.75, 90],
      [1, 120],
      [0.25, 15],
      [4, 15],
      [4, 165],
      [2.05, 62],
    ] as const
  ).flatMap(([b0, angle]) =>
    [0.25, 1.1, 4].flatMap((h0) =>
      (
        [
          [0, 0],
          [1, 0],
          [0, -1.5],
          [-0.75, 1.25],
          [2, -2],
        ] as const
      ).map((offset) => [b0, angle, h0, offset] as const),
    ),
  );

  it.each(cases)('with b/a = %s, α = %s°, h/a = %s and the offset %j matches its definition', (b0, angle, h0, [dx0, dy0]) => {
    const shape = triangleShape(b0, angle, h0, dx0, dy0);
    expectPrismGeometry({ shape, scale: L80 }, trianglePrismProportions(shape));

    // The base's width from its vertices P0 = (0, 0), P1 = (1, 0) and P2 = b0·(cos α, sin α): for an obtuse α or a long
    // b it is not a.
    const p2x = b0 * Math.cos((angle * Math.PI) / 180);
    const width0 = Math.max(1, p2x) - Math.min(0, p2x) + Math.abs(dx0);
    const depth0 = b0 * Math.sin((angle * Math.PI) / 180) + Math.abs(dy0);
    const s = 80 / Math.max(width0, depth0, h0);
    const dimensions = trianglePrismDimensionsMm(shape, L80);
    expectRelativelyClose(dimensions.edge, s);
    expectRelativelyClose(dimensions.baseSideB, b0 * s);
    expectRelativelyClose(dimensions.baseSideC, s * Math.sqrt(1 + b0 ** 2 - 2 * b0 * Math.cos((angle * Math.PI) / 180)));
    expectRelativelyClose(dimensions.basePerimeter, s + dimensions.baseSideB + dimensions.baseSideC);
    expectRelativelyClose(dimensions.baseArea, (s * dimensions.baseSideB * Math.sin((angle * Math.PI) / 180)) / 2);
  });

  it('builds the right-triangle reference: a = 80, b = 60, c = 100, h = 80 mm, S = 24 000 mm², V = 192 000 mm³', () => {
    const shape = triangleShape(0.75, 90, 1);
    const dimensions = trianglePrismDimensionsMm(shape, L80);
    expect(dimensions.edge).toBeCloseTo(80, 12);
    expect(dimensions.baseSideB).toBeCloseTo(60, 12);
    expect(dimensions.baseSideC).toBeCloseTo(100, 12);
    expect(dimensions.height).toBeCloseTo(80, 12);
    expect(dimensions.lateralEdge).toBeCloseTo(80, 12);
    expect(dimensions.baseArea).toBeCloseTo(2400, 9);
    expect(dimensions.volume).toBeCloseTo(192_000, 7);
    expect(dimensions.lateralArea).toBeCloseTo(240 * 80, 9);
    expect(dimensions.surfaceArea).toBeCloseTo(24_000, 9);

    const { mesh, measurements } = onlySolid({ shape, scale: L80 });
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(triangleCount(mesh)).toBe(8);
    // The centroid (80/3, 20) mm of the legs' triangle is at the origin.
    for (const [axis, min, max] of [
      [0, -80 / 3, 160 / 3],
      [1, -20, 40],
      [2, 0, 80],
    ] as const) {
      expect(measurements.bounds.min[axis]).toBeCloseTo(min, 4);
      expect(measurements.bounds.max[axis]).toBeCloseTo(max, 4);
    }
    expectRelativelyClose(measurements.volume, 192_000);
    expectRelativelyClose(measurements.surfaceArea, 24_000);
  });

  it.each([
    [1, 0, 0],
    [2, 0, 0],
    [0.5, -0.75, 1.25],
  ])('with b = a and α = 60° matches the regular triangular prism for h/a = %s and the offset (%s, %s)', (h0, dx0, dy0) => {
    const configurable = onlySolid({ shape: triangleShape(1, 60, h0, dx0, dy0), scale: L80 });
    const regular = onlySolid({ shape: prismShape(3, h0, dx0, dy0), scale: L80 });
    const sorted = (mesh: TriangleMesh) => verticesOf(mesh).sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const regularVertices = sorted(regular.mesh);
    sorted(configurable.mesh).forEach((vertex, index) => {
      vertex.forEach((component, axis) => {
        expect(Math.abs(component - (regularVertices[index]?.[axis] ?? Number.NaN))).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      });
    });
    expectRelativelyClose(configurable.measurements.volume, regular.measurements.volume);
    expectRelativelyClose(configurable.measurements.surfaceArea, regular.measurements.surfaceArea);
    const dimensions = trianglePrismDimensionsMm(triangleShape(1, 60, h0, dx0, dy0), L80);
    expectRelativelyClose(dimensions.baseSideC, dimensions.edge);
  });

  it('keeps the 80 mm limit on the bounding box, so a slanted side may be longer', () => {
    // b/a = 4 and α = 60°: the base is 2a wide and 2√3·a deep, so a = 80 / (2√3) mm and b = 4a ≈ 92,4 mm.
    const shape = triangleShape(4, 60, 1);
    const dimensions = trianglePrismDimensionsMm(shape, L80);
    expect(dimensions.baseSideB).toBeCloseTo(160 / Math.sqrt(3), 9);
    expect(dimensions.baseSideB).toBeGreaterThan(80);
    expectRelativelyClose(Math.max(...onlySolid({ shape, scale: L80 }).measurements.size), 80);
  });
});

describe('generateModel for a prism over a configurable trapezoid', () => {
  const trapezoidShape = (
    parallelSideRatio: number,
    baseHeightRatio: number,
    baseShiftRatio: number,
    heightRatio: number,
    offsetXRatio = 0,
    offsetYRatio = 0,
  ): TrapezoidPrismShape => ({
    kind: 'prism',
    baseType: 'trapezoid',
    parallelSideRatio,
    baseHeightRatio,
    baseShiftRatio,
    heightRatio,
    offsetXRatio,
    offsetYRatio,
  });

  const cases = (
    [
      [0.5, 0.5, 0],
      [0.5, 0.375, -0.25],
      [0.5, 0.375, 0.25],
      [1, 0.5, 0],
      [1, 0.75, 0.6],
      [4, 0.25, -1.5],
      [0.25, 4, 2],
      [0.25, 0.25, -2],
      [2.05, 1.1, 0.35],
    ] as const
  ).flatMap(([b0, t0, delta0]) =>
    [0.25, 1, 4].flatMap((h0) =>
      (
        [
          [0, 0],
          [1, 0],
          [-0.75, 1.25],
          [2, -2],
        ] as const
      ).map((offset) => [b0, t0, delta0, h0, offset] as const),
    ),
  );

  it.each(cases)(
    'with b/a = %s, t/a = %s, δ/a = %s, h/a = %s and the offset %j matches its definition',
    (b0, t0, delta0, h0, [dx0, dy0]) => {
      const shape = trapezoidShape(b0, t0, delta0, h0, dx0, dy0);
      expectPrismGeometry({ shape, scale: L80 }, trapezoidPrismProportions(shape));

      // The base's box from P0 = (−1/2, 0), P1 = (1/2, 0), P2 = (δ0 + b0/2, t0), P3 = (δ0 − b0/2, t0): side a is not
      // necessarily the width.
      const width0 = Math.max(0.5, delta0 + b0 / 2) - Math.min(-0.5, delta0 - b0 / 2) + Math.abs(dx0);
      const s = 80 / Math.max(width0, t0 + Math.abs(dy0), h0);
      const dimensions = trapezoidPrismDimensionsMm(shape, L80);
      expectRelativelyClose(dimensions.edge, s);
      expectRelativelyClose(dimensions.baseSideB, b0 * s);
      expectRelativelyClose(dimensions.baseHeight, t0 * s);
      expect(dimensions.baseShift).toBeCloseTo(delta0 * s, 9);
      expectRelativelyClose(dimensions.baseSideC, s * Math.hypot(t0, delta0 + (b0 - 1) / 2));
      expectRelativelyClose(dimensions.baseSideD, s * Math.hypot(t0, delta0 + (1 - b0) / 2));
      expectRelativelyClose(dimensions.basePerimeter, s + dimensions.baseSideB + dimensions.baseSideC + dimensions.baseSideD);
      expectRelativelyClose(dimensions.baseArea, ((s + dimensions.baseSideB) * dimensions.baseHeight) / 2);
    },
  );

  it('builds the right-trapezoid reference: a = 80, b = 40, t = 30, c = 50, d = 30, h = 40 mm', () => {
    const shape = trapezoidShape(0.5, 0.375, -0.25, 0.5);
    const dimensions = trapezoidPrismDimensionsMm(shape, L80);
    for (const [value, expected] of [
      [dimensions.edge, 80],
      [dimensions.baseSideB, 40],
      [dimensions.baseHeight, 30],
      [dimensions.baseShift, -20],
      [dimensions.baseSideC, 50],
      [dimensions.baseSideD, 30],
      [dimensions.height, 40],
      [dimensions.lateralEdge, 40],
      [dimensions.baseArea, 1800],
      [dimensions.volume, 72_000],
      [dimensions.lateralArea, 200 * 40],
      [dimensions.surfaceArea, 11_600],
    ] as const) {
      expect(value).toBeCloseTo(expected, 9);
    }

    const { mesh, measurements } = onlySolid({ shape, scale: L80 });
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(triangleCount(mesh)).toBe(12);
    [80, 30, 40].forEach((size, axis) => {
      expectRelativelyClose(measurements.size[axis], size);
    });
    expect(measurements.bounds.min[2]).toBe(0);
    expectRelativelyClose(measurements.volume, 72_000);
    expectRelativelyClose(measurements.surfaceArea, 11_600);
  });

  it('with b = a and δ = 0 reproduces the rectangular box, and with b = a a right parallelepiped', () => {
    // b/a = 1, t/a = 0,75, h/a = 0,5: the 80 × 60 × 40 mm box.
    const rectangle = onlySolid({ shape: trapezoidShape(1, 0.75, 0, 0.5), scale: L80 });
    const cuboid = onlySolid({ shape: { kind: 'cuboid', widthRatio: 0.75, heightRatio: 0.5 }, scale: L80 });
    for (const axis of [0, 1, 2] as const) {
      expect(rectangle.measurements.bounds.min[axis]).toBeCloseTo(cuboid.measurements.bounds.min[axis], 4);
      expect(rectangle.measurements.bounds.max[axis]).toBeCloseTo(cuboid.measurements.bounds.max[axis], 4);
    }
    expectRelativelyClose(rectangle.measurements.volume, cuboid.measurements.volume);

    // A parallelogram with sides a and b = a, height t and the shift δ: the parallelepiped with b' = √(t² + δ²) and
    // cos α = δ/b' has the same volume and area.
    const [t0, delta0] = [0.75, 0.6];
    const parallelogram = onlySolid({ shape: trapezoidShape(1, t0, delta0, 1), scale: L80 });
    const side = Math.hypot(t0, delta0);
    const angle = (Math.acos(delta0 / side) * 180) / Math.PI;
    const parallelepiped = onlySolid({
      shape: { kind: 'parallelepiped', baseSideRatio: side, baseAngleDeg: angle, heightRatio: 1 },
      scale: L80,
    });
    parallelogram.measurements.size.forEach((size, axis) => {
      expectRelativelyClose(size, parallelepiped.measurements.size[axis] as number);
    });
    expectRelativelyClose(parallelogram.measurements.volume, parallelepiped.measurements.volume);
    expectRelativelyClose(parallelogram.measurements.surfaceArea, parallelepiped.measurements.surfaceArea);
  });

  it('mirrors the shift: δ and −δ swap c and d and keep the area, volume and size', () => {
    const plus = trapezoidPrismDimensionsMm(trapezoidShape(0.5, 0.5, 0.6, 1), L80);
    const minus = trapezoidPrismDimensionsMm(trapezoidShape(0.5, 0.5, -0.6, 1), L80);
    expect(minus.baseSideC).toBeCloseTo(plus.baseSideD, 12);
    expect(minus.baseSideD).toBeCloseTo(plus.baseSideC, 12);
    expect(minus.baseArea).toBeCloseTo(plus.baseArea, 12);
    expect(minus.surfaceArea).toBeCloseTo(plus.surfaceArea, 9);
    const [first, second] = [0.6, -0.6].map(
      (delta) => onlySolid({ shape: trapezoidShape(0.5, 0.5, delta, 1), scale: L80 }).measurements,
    );
    first?.size.forEach((size, axis) => {
      expectRelativelyClose(second?.size[axis], size);
    });
    expectRelativelyClose(second?.volume, first?.volume as number);
  });
});
