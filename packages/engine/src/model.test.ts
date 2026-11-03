import { type CuboidShape, DEFAULT_LONGEST_DIMENSION_MM, defaultModelSpecs, type ModelSpecInput } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GeometryError, InvalidModelSpecError } from './errors.ts';
import { type GeometryKernel, loadGeometryKernel } from './kernel.ts';
import { findMeshDefects, type TriangleMesh, triangleAreaVector, triangleAt, triangleCount, vertexAt } from './mesh.ts';
import { generateModel } from './model.ts';
import { boxEdgeLengthsMm } from './shapes/box.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const scale = (longestDimensionMm: number) => ({ longestDimensionMm });
const cube = (longestDimensionMm: number): ModelSpecInput => ({ shape: { kind: 'cube' }, scale: scale(longestDimensionMm) });
const cuboid = (widthRatio: number, heightRatio: number, longestDimensionMm = 80): ModelSpecInput => ({
  shape: { kind: 'cuboid', widthRatio, heightRatio },
  scale: scale(longestDimensionMm),
});

const RELATIVE_TOLERANCE = 1e-6;
const expectRelativelyClose = (actual: number | undefined, expected: number) => {
  expect(Math.abs((actual ?? Number.NaN) / expected - 1)).toBeLessThan(RELATIVE_TOLERANCE);
};

const onlySolid = (spec: ModelSpecInput) => {
  const [solid] = generateModel(kernel, spec).solids;
  if (solid === undefined) throw new Error('No solid');
  return solid;
};

/** Vertex positions as an order-independent multiset, so comparisons do not depend on the kernel's vertex order. */
const sortedVertices = (mesh: TriangleMesh) =>
  Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex).join(',')).sort();

/**
 * Checks that the mesh consists of six axis-aligned rectangular faces of a box with edges a, b, c along X, Y, Z: each
 * face has four corners spanning its two edges and an area equal to their product.
 */
function expectBoxFaces(mesh: TriangleMesh, edges: readonly [number, number, number]) {
  const faces = new Map<string, { area: number; vertices: Set<number> }>();
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const areaVector = triangleAreaVector(mesh, triangle);
    expect(areaVector.filter((component) => component !== 0)).toHaveLength(1);
    const axis = areaVector.findIndex((component) => component !== 0);
    const key = `${(areaVector[axis] as number) > 0 ? '+' : '-'}${'xyz'[axis]}`;
    const face = faces.get(key) ?? { area: 0, vertices: new Set<number>() };
    face.area += Math.abs(areaVector[axis] as number) / 2;
    for (const vertex of triangleAt(mesh, triangle)) face.vertices.add(vertex);
    faces.set(key, face);
  }

  expect([...faces.keys()].sort()).toEqual(['+x', '+y', '+z', '-x', '-y', '-z']);
  for (const [key, face] of faces) {
    const normalAxis = 'xyz'.indexOf(key[1] as string);
    const inPlaneAxes = [0, 1, 2].filter((axis) => axis !== normalAxis);
    expect(face.vertices.size).toBe(4);
    expectRelativelyClose(
      face.area,
      inPlaneAxes.reduce((product, axis) => product * (edges[axis] as number), 1),
    );
    for (const axis of inPlaneAxes) {
      const coordinates = [...face.vertices].map((vertex) => vertexAt(mesh, vertex)[axis] as number);
      expectRelativelyClose(Math.max(...coordinates) - Math.min(...coordinates), edges[axis] as number);
    }
  }
}

describe('generateModel for a cube', () => {
  it('builds the default 80 mm cube resting on the build plate and centred in XY', () => {
    const { kind, solids } = generateModel(kernel, defaultModelSpecs.cube);
    expect(kind).toBe('cube');
    expect(solids).toHaveLength(1);
    const [solid] = solids;
    expect(solid?.name).toBe('cube');
    expect(solid?.measurements.bounds).toEqual({ min: [-40, -40, 0], max: [40, 40, 80] });
    expect(solid?.measurements.size).toEqual([
      DEFAULT_LONGEST_DIMENSION_MM,
      DEFAULT_LONGEST_DIMENSION_MM,
      DEFAULT_LONGEST_DIMENSION_MM,
    ]);
    expect(solid?.mesh.positions).toHaveLength(8 * 3);
    expect(solid?.mesh.triangles).toHaveLength(12 * 3);
  });

  it.each([1, 12.5, 80, 333.3])('has volume a³, surface area 6a² and three equal dimensions for a = %s mm', (a) => {
    const { measurements } = onlySolid(cube(a));
    expectRelativelyClose(measurements.volume, a ** 3);
    expectRelativelyClose(measurements.surfaceArea, 6 * a ** 2);
    for (const dimension of measurements.size) {
      expectRelativelyClose(dimension, a);
    }
  });

  it('produces a closed, consistently outward-oriented mesh', () => {
    expect(findMeshDefects(onlySolid(defaultModelSpecs.cube).mesh)).toEqual([]);
  });

  it('has six square faces of area a², one per axis direction', () => {
    const a = DEFAULT_LONGEST_DIMENSION_MM;
    expectBoxFaces(onlySolid(defaultModelSpecs.cube).mesh, [a, a, a]);
  });

  it('is deterministic', () => {
    expect(onlySolid(defaultModelSpecs.cube).mesh).toEqual(onlySolid(defaultModelSpecs.cube).mesh);
  });

  it.each([
    ['zero', cube(0)],
    ['negative', cube(-80)],
    ['NaN', cube(Number.NaN)],
    ['infinite', cube(Number.POSITIVE_INFINITY)],
    ['independent dimensions', { shape: { kind: 'cube', width: 1, height: 2 }, scale: scale(80) }],
    ['an unknown shape', { shape: { kind: 'torus' }, scale: scale(80) }],
    ['a missing scale', { shape: { kind: 'cube' } }],
  ])('rejects a %s specification before allocating geometry', (_, spec) => {
    const cubeConstructor = vi.spyOn(kernel.Manifold, 'cube');
    expect(() => generateModel(kernel, spec as ModelSpecInput)).toThrow(InvalidModelSpecError);
    expect(cubeConstructor).not.toHaveBeenCalled();
  });
});

describe('generateModel for a rectangular cuboid', () => {
  it('builds the default 40 × 60 × 80 mm cuboid (b/a = 1.5, c/a = 2, L = 80 mm) on the build plate', () => {
    const { kind, solids } = generateModel(kernel, defaultModelSpecs.cuboid);
    expect(kind).toBe('cuboid');
    expect(solids.map((solid) => solid.name)).toEqual(['cuboid']);
    expect(solids[0]?.measurements.bounds).toEqual({ min: [-20, -30, 0], max: [20, 30, 80] });
    expect(boxEdgeLengthsMm(defaultModelSpecs.cuboid.shape, defaultModelSpecs.cuboid.scale)).toEqual([40, 60, 80]);
  });

  // [b/a, c/a, L, expected a × b × c]: the longest edge is c, b, a and b respectively.
  it.each([
    [1.5, 2, 80, [40, 60, 80]],
    [2.5, 0.5, 80, [32, 80, 16]],
    [0.25, 0.5, 50, [50, 12.5, 25]],
    [4, 0.25, 120, [30, 120, 7.5]],
    [0.75, 3, 90, [30, 22.5, 90]],
  ] as const)('b/a = %s, c/a = %s, L = %s mm gives a × b × c = %j mm', (widthRatio, heightRatio, longest, edges) => {
    const spec = cuboid(widthRatio, heightRatio, longest);
    const [a, b, c] = edges;
    const { mesh, measurements } = onlySolid(spec);

    boxEdgeLengthsMm(spec.shape as CuboidShape, spec.scale).forEach((length, axis) => {
      expectRelativelyClose(length, edges[axis] as number);
    });
    measurements.size.forEach((length, axis) => {
      expectRelativelyClose(length, edges[axis] as number);
    });
    expect(Math.max(...measurements.size)).toBeCloseTo(longest, 4);
    expectRelativelyClose(measurements.volume, a * b * c);
    expectRelativelyClose(measurements.surfaceArea, 2 * (a * b + a * c + b * c));
    expect(measurements.bounds.min[2]).toBe(0);
    expect(measurements.bounds.min[0]).toBeCloseTo(-measurements.bounds.max[0], 5);
    expect(measurements.bounds.min[1]).toBeCloseTo(-measurements.bounds.max[1], 5);
    expect(findMeshDefects(mesh)).toEqual([]);
    expectBoxFaces(mesh, edges);
  });

  it.each([80, 37.5])('with equal ratios reproduces the cube geometry at L = %s mm', (longest) => {
    const fromCuboid = onlySolid(cuboid(1, 1, longest));
    const fromCube = onlySolid(cube(longest));
    expect(sortedVertices(fromCuboid.mesh)).toEqual(sortedVertices(fromCube.mesh));
    expect(fromCuboid.measurements).toEqual(fromCube.measurements);
  });

  it.each([
    ['a zero ratio', cuboid(0, 2)],
    ['a negative ratio', cuboid(1.5, -2)],
    ['a NaN ratio', cuboid(Number.NaN, 2)],
    ['an infinite ratio', cuboid(1.5, Number.POSITIVE_INFINITY)],
    ['a ratio below the minimum', cuboid(0.2, 2)],
    ['a ratio above the maximum', cuboid(1.5, 4.5)],
    ['a missing ratio', { shape: { kind: 'cuboid', widthRatio: 1.5 }, scale: scale(80) }],
    ['a string ratio', { shape: { kind: 'cuboid', widthRatio: '1.5', heightRatio: 2 }, scale: scale(80) }],
  ])('rejects %s before allocating geometry', (_, spec) => {
    const cubeConstructor = vi.spyOn(kernel.Manifold, 'cube');
    expect(() => generateModel(kernel, spec as ModelSpecInput)).toThrow(InvalidModelSpecError);
    expect(cubeConstructor).not.toHaveBeenCalled();
  });
});

describe('releases Manifold objects', () => {
  // Instances use the embind prototype, which differs from the wrapper's `Manifold.prototype`.
  function instancePrototype(): Manifold {
    const probe = kernel.Manifold.cube(1);
    const prototype = Object.getPrototypeOf(probe) as Manifold;
    probe.delete();
    return prototype;
  }

  function trackCreatedManifolds(): { created: Manifold[]; prototype: Manifold } {
    const created: Manifold[] = [];
    const record = <T extends Manifold>(manifold: T): T => {
      created.push(manifold);
      return manifold;
    };
    const prototype = instancePrototype();
    const { cube: originalCube, extrude: originalExtrude, cylinder: originalCylinder, sphere: originalSphere } = kernel.Manifold;
    const { translate, scale, transform } = prototype;
    vi.spyOn(kernel.Manifold, 'cube').mockImplementation((...args) => record(originalCube.apply(kernel.Manifold, args)));
    vi.spyOn(kernel.Manifold, 'extrude').mockImplementation((...args) => record(originalExtrude.apply(kernel.Manifold, args)));
    vi.spyOn(kernel.Manifold, 'cylinder').mockImplementation((...args) => record(originalCylinder.apply(kernel.Manifold, args)));
    vi.spyOn(kernel.Manifold, 'sphere').mockImplementation((...args) => record(originalSphere.apply(kernel.Manifold, args)));
    vi.spyOn(prototype, 'translate').mockImplementation(function (this: Manifold, ...args) {
      return record(translate.apply(this, args));
    });
    vi.spyOn(prototype, 'scale').mockImplementation(function (this: Manifold, ...args) {
      return record(scale.apply(this, args));
    });
    vi.spyOn(prototype, 'transform').mockImplementation(function (this: Manifold, ...args) {
      return record(transform.apply(this, args));
    });
    return { created, prototype };
  }

  const isDeleted = (manifold: Manifold) => (manifold as unknown as { isDeleted(): boolean }).isDeleted();

  const oblique = {
    prism: {
      shape: { kind: 'prism', baseSides: 5, heightRatio: 1, offsetXRatio: -0.5, offsetYRatio: 1 },
      scale: { longestDimensionMm: 80 },
    },
    parallelepiped: {
      shape: { kind: 'parallelepiped', baseSideRatio: 2, heightRatio: 1, baseAngleDeg: 60, offsetXRatio: 1, offsetYRatio: 0 },
      scale: { longestDimensionMm: 80 },
    },
  } as const satisfies Record<string, ModelSpecInput>;
  const pyramids = {
    triangle: {
      shape: { kind: 'pyramid', baseType: 'triangle', baseSideRatio: 2, baseAngleDeg: 120, heightRatio: 1 },
      scale: { longestDimensionMm: 80 },
    },
    displaced: {
      shape: {
        kind: 'pyramid',
        baseType: 'trapezoid',
        parallelSideRatio: 0.5,
        baseHeightRatio: 0.5,
        baseShiftRatio: 0.25,
        heightRatio: 1,
        apexXRatio: 2,
        apexYRatio: -1,
      },
      scale: { longestDimensionMm: 80 },
    },
  } as const satisfies Record<string, ModelSpecInput>;
  const trapezoid = {
    right: {
      shape: {
        kind: 'prism',
        baseType: 'trapezoid',
        parallelSideRatio: 0.5,
        baseHeightRatio: 0.375,
        baseShiftRatio: -0.25,
        heightRatio: 0.5,
      },
      scale: { longestDimensionMm: 80 },
    },
    oblique: {
      shape: {
        kind: 'prism',
        baseType: 'trapezoid',
        parallelSideRatio: 2,
        baseHeightRatio: 1,
        baseShiftRatio: 0.5,
        heightRatio: 1,
        offsetXRatio: 1,
        offsetYRatio: -0.5,
      },
      scale: { longestDimensionMm: 80 },
    },
  } as const satisfies Record<string, ModelSpecInput>;
  const triangle = {
    right: {
      shape: { kind: 'prism', baseType: 'triangle', baseSideRatio: 0.75, baseAngleDeg: 90, heightRatio: 1 },
      scale: { longestDimensionMm: 80 },
    },
    oblique: {
      shape: {
        kind: 'prism',
        baseType: 'triangle',
        baseSideRatio: 2,
        baseAngleDeg: 120,
        heightRatio: 1,
        offsetXRatio: -1,
        offsetYRatio: 0.5,
      },
      scale: { longestDimensionMm: 80 },
    },
  } as const satisfies Record<string, ModelSpecInput>;
  // Boxes: cube, translate onto the build plate, scale to millimetres. Right prisms, parallelepipeds and pyramids:
  // extrude, scale. Oblique prisms and parallelepipeds: extrude, shear, scale.
  const polyhedra: readonly (readonly [string, ModelSpecInput, number])[] = [
    ['cube', defaultModelSpecs.cube, 3],
    ['cuboid', defaultModelSpecs.cuboid, 3],
    ['parallelepiped', defaultModelSpecs.parallelepiped, 2],
    ['oblique parallelepiped', oblique.parallelepiped, 3],
    ['prism', defaultModelSpecs.prism, 2],
    ['oblique prism', oblique.prism, 3],
    ['triangle prism', triangle.right, 2],
    ['oblique triangle prism', triangle.oblique, 3],
    ['trapezoid prism', trapezoid.right, 2],
    ['triangle pyramid', pyramids.triangle, 2],
    ['pyramid with a displaced apex', pyramids.displaced, 3],
    ['oblique trapezoid prism', trapezoid.oblique, 3],
    ['pyramid', defaultModelSpecs.pyramid, 2],
    ['tetrahedron', defaultModelSpecs.tetrahedron, 2],
  ];
  // Built by manifold-3d at their physical size: cylinders and cones in one step, the ball as sphere and translate.
  const obliqueRound = {
    cylinder: { shape: { kind: 'cylinder', heightRatio: 1, offsetRatio: 1.5 }, scale: { longestDimensionMm: 80 } },
    cone: { shape: { kind: 'cone', heightRatio: 0.5, offsetRatio: 3 }, scale: { longestDimensionMm: 80 } },
  } as const satisfies Record<string, ModelSpecInput>;
  const curvedSolids: readonly (readonly [string, ModelSpecInput, number])[] = [
    ['cylinder', defaultModelSpecs.cylinder, 1],
    ['cone', defaultModelSpecs.cone, 1],
    // Oblique: the right solid, then the shear.
    ['oblique cylinder', obliqueRound.cylinder, 2],
    ['oblique cone', obliqueRound.cone, 2],
    ['ball', defaultModelSpecs.ball, 2],
  ];
  const solids = [...polyhedra, ...curvedSolids];

  it.each(solids)('after successful generation of a %s', (_, spec, objects) => {
    const { created } = trackCreatedManifolds();
    generateModel(kernel, spec);
    expect(created).toHaveLength(objects);
    expect(created.every(isDeleted)).toBe(true);
  });

  it.each(solids)('when the kernel reports an invalid %s', (_, spec, objects) => {
    const { created, prototype } = trackCreatedManifolds();
    vi.spyOn(prototype, 'status').mockReturnValue('NotManifold');
    expect(() => generateModel(kernel, spec)).toThrow(GeometryError);
    expect(created).toHaveLength(objects);
    expect(created.every(isDeleted)).toBe(true);
  });

  it.each(polyhedra)('when a kernel operation throws midway through a %s', (_, spec, objects) => {
    const { created, prototype } = trackCreatedManifolds();
    vi.spyOn(prototype, 'scale').mockImplementation(() => {
      throw new Error('out of memory');
    });
    expect(() => generateModel(kernel, spec)).toThrow('out of memory');
    expect(created).toHaveLength(objects - 1);
    expect(created.every(isDeleted)).toBe(true);
  });

  it.each([
    ['an oblique prism', oblique.prism],
    ['an oblique cone', obliqueRound.cone],
    ['a pyramid with a displaced apex', pyramids.displaced],
  ])('when the shear of %s throws', (_, spec) => {
    const { created, prototype } = trackCreatedManifolds();
    vi.spyOn(prototype, 'transform').mockImplementation(() => {
      throw new Error('out of memory');
    });
    expect(() => generateModel(kernel, spec)).toThrow('out of memory');
    expect(created).toHaveLength(1);
    expect(created.every(isDeleted)).toBe(true);
  });

  it.each(curvedSolids)('when copying the mesh of a %s out of the kernel throws', (_, spec, objects) => {
    const { created, prototype } = trackCreatedManifolds();
    vi.spyOn(prototype, 'getMesh').mockImplementation(() => {
      throw new Error('out of memory');
    });
    expect(() => generateModel(kernel, spec)).toThrow('out of memory');
    expect(created).toHaveLength(objects);
    expect(created.every(isDeleted)).toBe(true);
  });
});
