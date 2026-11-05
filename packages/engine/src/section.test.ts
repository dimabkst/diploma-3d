import {
  type CylinderShape,
  type ModelSpecInput,
  maxTiltDisplacement,
  ROUND_HEIGHT_LIMITS,
  ROUND_OFFSET_LIMITS,
  SECTION_POSITION_LIMITS,
} from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GeometryError, InvalidModelSpecError } from './errors.ts';
import { type GeometryKernel, loadGeometryKernel } from './kernel.ts';
import {
  findMeshDefects,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  vertexAt,
  vertexCount,
} from './mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from './model.ts';
import { withScope } from './scope.ts';
import { sectionPlane, splitByPlane } from './section.ts';
import { circularSegments, roundDimensionsMm } from './shapes/round.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const L = 80;
const cylinder = (heightRatio: number, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const sectioned = (shape: CylinderShape, positionPercent: number, longestDimensionMm = L): ModelSpecInput => ({
  shape,
  scale: { longestDimensionMm },
  section: { type: 'parallel-to-bases', positionPercent },
});

function partsOf(model: GeneratedModel): { lower: Solid; upper: Solid } {
  const [lower, upper] = model.solids;
  if (lower === undefined || upper === undefined) throw new Error('Expected two parts');
  expect([lower.part, upper.part]).toEqual(['lower', 'upper']);
  return { lower, upper };
}

/** The number of edge-connected pieces of the mesh, by union–find over the triangles' vertices. */
function componentCount(mesh: TriangleMesh): number {
  const parent = Array.from({ length: vertexCount(mesh) }, (_, vertex) => vertex);
  const root = (vertex: number): number => {
    let current = vertex;
    while (parent[current] !== current) current = parent[current] as number;
    return current;
  };
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [a, b, c] = triangleAt(mesh, triangle).map(root) as [number, number, number];
    parent[b] = a;
    parent[root(c)] = a;
  }
  return new Set(Array.from({ length: vertexCount(mesh) }, (_, vertex) => root(vertex))).size;
}

// Float32 vertices at up to 80 mm are exact to about 5e-6 mm.
const PLANE_TOLERANCE_MM = 1e-4;

/** The triangles in the plane z = zCut, with their summed area vector, and the vertices of their boundary. */
function cutFace(mesh: TriangleMesh, zCut: number) {
  const area: [number, number, number] = [0, 0, 0];
  const vertices = new Set<string>();
  let triangles = 0;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle);
    if (!corners.every((vertex) => Math.abs(vertexAt(mesh, vertex)[2] - zCut) <= PLANE_TOLERANCE_MM)) continue;
    triangles += 1;
    triangleAreaVector(mesh, triangle).forEach((component, axis) => {
      area[axis as 0 | 1 | 2] += component / 2;
    });
    for (const vertex of corners) vertices.add(vertexAt(mesh, vertex).join(','));
  }
  const points = [...vertices].map((key) => key.split(',').map(Number) as [number, number, number]);
  return { triangles, area, points, keys: [...vertices].sort() };
}

/** The inscribed regular N-gon, which the exported circle is; not the ideal circle's πr². */
const polygonArea = (segments: number, r: number) => (segments * r ** 2 * Math.sin((2 * Math.PI) / segments)) / 2;

const relativeError = (actual: number, expected: number) => Math.abs(actual / expected - 1);

// Right and oblique cylinders, including the extremes of h/r and the flattest allowed lean at each.
const cylinders: readonly (readonly [string, CylinderShape])[] = [
  ['the default right cylinder, h/r = 2', cylinder(2)],
  ['the flattest right cylinder, h/r = 0,5', cylinder(ROUND_HEIGHT_LIMITS.min)],
  ['the tallest right cylinder, h/r = 8', cylinder(ROUND_HEIGHT_LIMITS.max)],
  ['an oblique cylinder, h/r = 1, d/r = 1,5', cylinder(1, 1.5)],
  ['the flattest oblique cylinder, h/r = 0,5 at β = 15°', cylinder(0.5, maxTiltDisplacement(0.5))],
  ['the tallest oblique cylinder, h/r = 8, d/r = 4', cylinder(ROUND_HEIGHT_LIMITS.max, ROUND_OFFSET_LIMITS.max)],
];
const positions = [SECTION_POSITION_LIMITS.min, 50, 62.5, SECTION_POSITION_LIMITS.max];

describe('a section of a cylinder parallel to its bases', () => {
  describe.each(cylinders)('of %s', (_, shape) => {
    const whole = () => generateModel(kernel, { shape, scale: { longestDimensionMm: L } });
    const { radius: r, height: h, offset: d } = roundDimensionsMm(shape, { longestDimensionMm: L });
    const segments = circularSegments(r);

    it.each(positions)('at %s %% of h splits it into two closed parts that fill it exactly', (percent) => {
      const t = percent / 100;
      const zCut = t * h;
      const model = generateModel(kernel, sectioned(shape, percent));
      const { lower, upper } = partsOf(model);
      expect(model.section?.plane).toEqual({ normal: [0, 0, 1], offset: zCut });

      for (const part of [lower, upper]) {
        expect(findMeshDefects(part.mesh)).toEqual([]);
        expect(componentCount(part.mesh)).toBe(1);
        expect(part.measurements.volume).toBeGreaterThan(0);
      }
      // Each part on its side of the plane; together they span the whole height.
      expect(lower.measurements.bounds.min[2]).toBe(0);
      expect(Math.abs(lower.measurements.bounds.max[2] - zCut)).toBeLessThan(PLANE_TOLERANCE_MM);
      expect(Math.abs(upper.measurements.bounds.min[2] - zCut)).toBeLessThan(PLANE_TOLERANCE_MM);
      expect(upper.measurements.bounds.max[2]).toBeCloseTo(h, 4);

      // Every horizontal section of the sheared polygonal cylinder is the same N-gon, so the volume below z is A·z.
      const volume = whole().solids[0]?.measurements.volume ?? Number.NaN;
      expect(relativeError(lower.measurements.volume + upper.measurements.volume, volume)).toBeLessThan(1e-6);
      expect(relativeError(lower.measurements.volume, t * volume)).toBeLessThan(1e-6);
      expect(relativeError(upper.measurements.volume, (1 - t) * volume)).toBeLessThan(1e-6);
      expect(relativeError(volume, polygonArea(segments, r) * h)).toBeLessThan(1e-6);
    });

    it.each(positions)(
      'at %s %% of h caps both parts with the same N-gon of radius r, facing away from each other',
      (percent) => {
        const t = percent / 100;
        const { lower, upper } = partsOf(generateModel(kernel, sectioned(shape, percent)));
        const lowerCut = cutFace(lower.mesh, t * h);
        const upperCut = cutFace(upper.mesh, t * h);
        // The same boundary vertices in the assembled position: the plane has no thickness and leaves no gap.
        expect(lowerCut.keys).toEqual(upperCut.keys);
        expect(lowerCut.points).toHaveLength(segments);
        // The lower part's cap faces up, the upper part's down; both enclose the N-gon's area.
        expect(relativeError(lowerCut.area[2], polygonArea(segments, r))).toBeLessThan(1e-6);
        expect(relativeError(-upperCut.area[2], polygonArea(segments, r))).toBeLessThan(1e-6);
        for (const cut of [lowerCut, upperCut]) {
          expect(Math.abs(cut.area[0]) + Math.abs(cut.area[1])).toBeLessThan(1e-6 * polygonArea(segments, r));
        }
        // Its centre is the lower base's centre moved by t·d along X; its vertices lie on the circle of radius r there.
        const xs = lowerCut.points.map(([x]) => x);
        const ys = lowerCut.points.map(([, y]) => y);
        expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(t * d, 4);
        expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 4);
        for (const [x, y] of lowerCut.points) expect(Math.hypot(x - t * d, y)).toBeCloseTo(r, 4);
      },
    );

    it('keeps the radius, height and bounds of the whole solid at every position', () => {
      const reference = whole();
      for (const percent of positions) {
        const model = generateModel(kernel, sectioned(shape, percent));
        expect(model.bounds).toEqual(reference.bounds);
        expect(model.size).toEqual(reference.size);
        expect(model.size[2]).toBeCloseTo(h, 4);
        expect(model.size[1]).toBeCloseTo(2 * r, 4);
      }
    });
  });

  it('shifts the section of an oblique cylinder by t·(dx, dy): (12, 0) mm at 30 % of h/r = 1, d/r = 1,5', () => {
    // The box is (2 + 1,5)r × 2r × r, so r = 80/3,5 mm and d = 1,5r; at t = 0,3 the centre is 0,45r from the base's.
    const r = L / 3.5;
    const { lower } = partsOf(generateModel(kernel, sectioned(cylinder(1, 1.5), 30)));
    const xs = cutFace(lower.mesh, 0.3 * r).points.map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(0.45 * r - r, 4);
    expect(Math.max(...xs)).toBeCloseTo(0.45 * r + r, 4);
  });

  it('scales both parts with the print size by the same factor, as the whole', () => {
    const shape = cylinder(1, 1.5);
    const [small, large] = [40, 80].map((size) => partsOf(generateModel(kernel, sectioned(shape, 40, size))));
    for (const part of ['lower', 'upper'] as const) {
      const [a, b] = [small?.[part], large?.[part]];
      a?.measurements.size.forEach((value, axis) => {
        expect(value * 2).toBeCloseTo(b?.measurements.size[axis] ?? Number.NaN, 4);
      });
      expect(relativeError((a?.measurements.volume ?? 0) * 8, b?.measurements.volume ?? 0)).toBeLessThan(1e-6);
    }
  });

  it('names the model and its parts after the solid and the section', () => {
    const model = generateModel(kernel, sectioned(cylinder(2), 50));
    expect(model.name).toBe('cylinder-parallel-section');
    expect(model.solids.map((solid) => solid.name)).toEqual(['cylinder-lower-part', 'cylinder-upper-part']);
    // The parts keep the cylinder's smooth shading.
    expect(model.solids.every((solid) => solid.smoothShading)).toBe(true);
  });

  it.each([9.99, 90.01, 0, 100, Number.NaN, Number.POSITIVE_INFINITY])('refuses the position %s %%', (positionPercent) => {
    expect(() => generateModel(kernel, sectioned(cylinder(2), positionPercent))).toThrow(InvalidModelSpecError);
  });

  it('refuses the section for solids that do not offer it yet, and unknown section types', () => {
    const section = { type: 'parallel-to-bases', positionPercent: 50 } as const;
    for (const shape of [
      { kind: 'cone', heightRatio: 2, offsetRatio: 0 },
      { kind: 'prism', baseSides: 4, heightRatio: 1 },
      { kind: 'cube' },
    ] as const) {
      expect(() => generateModel(kernel, { shape, scale: { longestDimensionMm: L }, section })).toThrow(InvalidModelSpecError);
    }
    const axial = { type: 'axial', positionPercent: 50 } as unknown as typeof section;
    expect(() => generateModel(kernel, { ...sectioned(cylinder(2), 50), section: axial })).toThrow(InvalidModelSpecError);
  });
});

describe('sectionPlane', () => {
  it('puts the plane at zBottom + t·h with the normal +Z, whatever the XY extent', () => {
    const bounds = { min: [-3, -40, 10], max: [70, 5, 50] } as const;
    expect(
      sectionPlane({ type: 'parallel-to-bases', positionPercent: 25 }, { min: [...bounds.min], max: [...bounds.max] }),
    ).toEqual({
      normal: [0, 0, 1],
      offset: 20,
    });
  });
});

describe('splitByPlane', () => {
  it('returns the part on the normal’s side as positive and refuses a plane that misses the solid', () => {
    withScope((track) => {
      const cube = track(kernel.Manifold.cube([10, 10, 10]));
      const { positive, negative } = splitByPlane(track, cube, { normal: [0, 0, 1], offset: 3 });
      expect(positive.boundingBox()).toEqual({ min: [0, 0, 3], max: [10, 10, 10] });
      expect(negative.boundingBox()).toEqual({ min: [0, 0, 0], max: [10, 10, 3] });
      expect(positive.volume() + negative.volume()).toBeCloseTo(1000, 9);
      expect(() => splitByPlane(track, cube, { normal: [0, 0, 1], offset: 12 })).toThrow(GeometryError);
    });
  });
});

describe('a section releases its Manifold objects', () => {
  const isDeleted = (manifold: Manifold) => (manifold as unknown as { isDeleted(): boolean }).isDeleted();

  /** Records the parts that splitByPlane returns, besides the cylinder and its shear. */
  function trackSplits() {
    const created: Manifold[] = [];
    const probe = kernel.Manifold.cube(1);
    const prototype = Object.getPrototypeOf(probe) as Manifold;
    probe.delete();
    const { splitByPlane: split, transform } = prototype;
    const { cylinder: originalCylinder } = kernel.Manifold;
    vi.spyOn(kernel.Manifold, 'cylinder').mockImplementation((...args) => {
      const result = originalCylinder.apply(kernel.Manifold, args);
      created.push(result);
      return result;
    });
    vi.spyOn(prototype, 'transform').mockImplementation(function (this: Manifold, ...args) {
      const result = transform.apply(this, args);
      created.push(result);
      return result;
    });
    vi.spyOn(prototype, 'splitByPlane').mockImplementation(function (this: Manifold, ...args) {
      const result = split.apply(this, args);
      created.push(...result);
      return result;
    });
    return { created, prototype };
  }

  it.each([
    ['a right cylinder', cylinder(2), 3],
    ['an oblique cylinder', cylinder(1, 1.5), 4],
  ] as const)('after splitting %s', (_, shape, objects) => {
    const { created } = trackSplits();
    generateModel(kernel, sectioned(shape, 50));
    expect(created).toHaveLength(objects);
    expect(created.every(isDeleted)).toBe(true);
  });

  it('when a part is invalid', () => {
    const { created, prototype } = trackSplits();
    const status = vi.spyOn(prototype, 'status');
    // The cylinder is valid; the first part is not.
    status.mockReturnValueOnce('NoError').mockReturnValue('NotManifold');
    expect(() => generateModel(kernel, sectioned(cylinder(2), 50))).toThrow(GeometryError);
    expect(created).toHaveLength(3);
    expect(created.every(isDeleted)).toBe(true);
  });

  it('when the split throws', () => {
    const { created, prototype } = trackSplits();
    vi.spyOn(prototype, 'splitByPlane').mockImplementation(() => {
      throw new Error('out of memory');
    });
    expect(() => generateModel(kernel, sectioned(cylinder(1, 1.5), 50))).toThrow('out of memory');
    expect(created).toHaveLength(2);
    expect(created.every(isDeleted)).toBe(true);
  });

  it('when copying a part out of the kernel throws', () => {
    const { created, prototype } = trackSplits();
    const getMesh = prototype.getMesh;
    let calls = 0;
    vi.spyOn(prototype, 'getMesh').mockImplementation(function (this: Manifold, ...args) {
      calls += 1;
      if (calls === 2) throw new Error('out of memory');
      return getMesh.apply(this, args);
    });
    expect(() => generateModel(kernel, sectioned(cylinder(2), 50))).toThrow('out of memory');
    expect(created).toHaveLength(3);
    expect(created.every(isDeleted)).toBe(true);
  });
});
