import { DEFAULT_CUBE_EDGE_LENGTH_MM, defaultModelSpecs, type ModelSpec } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GeometryError, InvalidModelSpecError } from './errors.ts';
import { type GeometryKernel, loadGeometryKernel } from './kernel.ts';
import { findMeshDefects, type TriangleMesh, triangleAreaVector, triangleAt, triangleCount, vertexAt } from './mesh.ts';
import { generateModel } from './model.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const cube = (unitLengthMm: number): ModelSpec => ({ shape: { kind: 'cube' }, scale: { unitLengthMm } });

/** Groups triangles into planar faces by their outward axis direction, e.g. "+z". */
function axisAlignedFaces(mesh: TriangleMesh): Map<string, { area: number; vertices: Set<number> }> {
  const faces = new Map<string, { area: number; vertices: Set<number> }>();
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const areaVector = triangleAreaVector(mesh, triangle);
    const axis = areaVector.findIndex((component) => Math.abs(component) > 0);
    expect(areaVector.filter((component) => component !== 0)).toHaveLength(1);
    const key = `${(areaVector[axis] as number) > 0 ? '+' : '-'}${'xyz'[axis]}`;
    const face = faces.get(key) ?? { area: 0, vertices: new Set<number>() };
    face.area += Math.abs(areaVector[axis] as number) / 2;
    for (const vertex of triangleAt(mesh, triangle)) face.vertices.add(vertex);
    faces.set(key, face);
  }
  return faces;
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
      DEFAULT_CUBE_EDGE_LENGTH_MM,
      DEFAULT_CUBE_EDGE_LENGTH_MM,
      DEFAULT_CUBE_EDGE_LENGTH_MM,
    ]);
    expect(solid?.mesh.positions).toHaveLength(8 * 3);
    expect(solid?.mesh.triangles).toHaveLength(12 * 3);
  });

  it.each([1, 12.5, 80, 333.3])('has volume a³, surface area 6a² and three equal dimensions for a = %s mm', (a) => {
    const [solid] = generateModel(kernel, cube(a)).solids;
    if (solid === undefined) throw new Error('No solid');
    const relativeTolerance = 1e-6;
    expect(Math.abs(solid.measurements.volume / a ** 3 - 1)).toBeLessThan(relativeTolerance);
    expect(Math.abs(solid.measurements.surfaceArea / (6 * a ** 2) - 1)).toBeLessThan(relativeTolerance);
    for (const dimension of solid.measurements.size) {
      expect(Math.abs(dimension / a - 1)).toBeLessThan(relativeTolerance);
    }
  });

  it('produces a closed, consistently outward-oriented mesh', () => {
    const [solid] = generateModel(kernel, defaultModelSpecs.cube).solids;
    expect(findMeshDefects(solid?.mesh as TriangleMesh)).toEqual([]);
  });

  it('has six square faces of area a², one per axis direction', () => {
    const a = DEFAULT_CUBE_EDGE_LENGTH_MM;
    const mesh = generateModel(kernel, defaultModelSpecs.cube).solids[0]?.mesh as TriangleMesh;
    const faces = axisAlignedFaces(mesh);
    expect([...faces.keys()].sort()).toEqual(['+x', '+y', '+z', '-x', '-y', '-z']);
    for (const [key, face] of faces) {
      expect(face.area).toBeCloseTo(a ** 2, 6);
      // Four corners spanning a × a in the face plane, together with area a², make the face a square of side a.
      expect(face.vertices.size).toBe(4);
      const normalAxis = 'xyz'.indexOf(key[1] as string);
      for (const axis of [0, 1, 2].filter((candidate) => candidate !== normalAxis)) {
        const coordinates = [...face.vertices].map((vertex) => vertexAt(mesh, vertex)[axis] as number);
        expect(Math.max(...coordinates) - Math.min(...coordinates)).toBeCloseTo(a, 6);
      }
    }
  });

  it('is deterministic', () => {
    const first = generateModel(kernel, defaultModelSpecs.cube).solids[0]?.mesh;
    const second = generateModel(kernel, defaultModelSpecs.cube).solids[0]?.mesh;
    expect(second).toEqual(first);
  });

  it.each([
    ['zero', cube(0)],
    ['negative', cube(-80)],
    ['NaN', cube(Number.NaN)],
    ['infinite', cube(Number.POSITIVE_INFINITY)],
    ['independent dimensions', { shape: { kind: 'cube', width: 1, height: 2 }, scale: { unitLengthMm: 80 } }],
    ['an unknown shape', { shape: { kind: 'torus' }, scale: { unitLengthMm: 80 } }],
    ['a missing scale', { shape: { kind: 'cube' } }],
  ])('rejects a %s specification before allocating geometry', (_, spec) => {
    const cubeConstructor = vi.spyOn(kernel.Manifold, 'cube');
    expect(() => generateModel(kernel, spec as ModelSpec)).toThrow(InvalidModelSpecError);
    expect(cubeConstructor).not.toHaveBeenCalled();
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
      const { cube: originalCube } = kernel.Manifold;
      const { translate, scale } = prototype;
      vi.spyOn(kernel.Manifold, 'cube').mockImplementation((...args) => record(originalCube.apply(kernel.Manifold, args)));
      vi.spyOn(prototype, 'translate').mockImplementation(function (this: Manifold, ...args) {
        return record(translate.apply(this, args));
      });
      vi.spyOn(prototype, 'scale').mockImplementation(function (this: Manifold, ...args) {
        return record(scale.apply(this, args));
      });
      return { created, prototype };
    }

    const isDeleted = (manifold: Manifold) => (manifold as unknown as { isDeleted(): boolean }).isDeleted();

    it('after successful generation', () => {
      const { created } = trackCreatedManifolds();
      generateModel(kernel, defaultModelSpecs.cube);
      expect(created).toHaveLength(3);
      expect(created.every(isDeleted)).toBe(true);
    });

    it('when the kernel reports an invalid result', () => {
      const { created, prototype } = trackCreatedManifolds();
      vi.spyOn(prototype, 'status').mockReturnValue('NotManifold');
      expect(() => generateModel(kernel, defaultModelSpecs.cube)).toThrow(GeometryError);
      expect(created).toHaveLength(3);
      expect(created.every(isDeleted)).toBe(true);
    });

    it('when a kernel operation throws midway', () => {
      const { created, prototype } = trackCreatedManifolds();
      vi.spyOn(prototype, 'scale').mockImplementation(() => {
        throw new Error('out of memory');
      });
      expect(() => generateModel(kernel, defaultModelSpecs.cube)).toThrow('out of memory');
      expect(created).toHaveLength(2);
      expect(created.every(isDeleted)).toBe(true);
    });
  });
});
