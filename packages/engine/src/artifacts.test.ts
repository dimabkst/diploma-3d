import { defaultModelSpecs, type ModelSpecInput } from '@diploma-3d/schema';
import { type Accessor, WebIO } from '@gltf-transform/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildModelArtifacts,
  CONNECTOR_PREVIEW_GAP_RELATIVE,
  previewSeparation,
  SECTION_PREVIEW_GAP_RELATIVE,
} from './artifacts.ts';
import { InvalidModelSpecError } from './errors.ts';
import { toGltfPosition } from './export/glb.ts';
import { arrangeInRow } from './export/layout.ts';
import { readThreeMf } from './export/three-mf.test-helper.ts';
import { createThreeMf } from './export/three-mf.ts';
import { type GeometryKernel, loadGeometryKernel } from './kernel.ts';
import {
  cross,
  dot,
  findMeshDefects,
  measureMesh,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
} from './mesh.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

// Float32 metres resolve about 1e-9 m at this size; 7 digits (±5e-8 m) still exposes any unit or axis error.
const METRE_DIGITS = 7;

async function previewSurfacePositions(glb: Uint8Array): Promise<Accessor> {
  const mesh = (await new WebIO().readBinary(glb)).getRoot().listMeshes()[0];
  const positions = mesh?.listPrimitives()[0]?.getAttribute('POSITION');
  if (positions == null) throw new Error('No preview surface');
  return positions;
}

describe('buildModelArtifacts', () => {
  it.each([
    ['cube', 'cube.3mf'],
    ['cuboid', 'cuboid.3mf'],
    ['parallelepiped', 'parallelepiped.3mf'],
    ['prism', 'prism-3-sided.3mf'],
    ['pyramid', 'pyramid-4-sided.3mf'],
    ['tetrahedron', 'tetrahedron.3mf'],
    ['octahedron', 'octahedron.3mf'],
    ['icosahedron', 'icosahedron.3mf'],
    ['dodecahedron', 'dodecahedron.3mf'],
    ['cylinder', 'cylinder.3mf'],
    ['cone', 'cone.3mf'],
    ['ball', 'ball.3mf'],
  ] as const)('derives the %s preview and print file %s from the same geometry', async (kind, fileName) => {
    const { model, previewGlb, printFile } = await buildModelArtifacts(kernel, defaultModelSpecs[kind]);
    expect(printFile.fileName).toBe(fileName);

    const printed = readThreeMf(printFile.bytes).model.objects[0]?.mesh;
    expect(printed).toEqual(model.solids[0]?.mesh);
    if (printed === undefined) throw new Error('No printed mesh');

    const previewPositions = await previewSurfacePositions(previewGlb);
    expect(previewPositions.getCount()).toBe(triangleCount(printed) * 3);
    for (let triangle = 0; triangle < triangleCount(printed); triangle += 1) {
      triangleAt(printed, triangle).forEach((vertex, corner) => {
        const expected = toGltfPosition(vertexAt(printed, vertex));
        const actual = previewPositions.getElement(triangle * 3 + corner, []);
        expected.forEach((component, axis) => {
          expect(actual[axis]).toBeCloseTo(component, METRE_DIGITS);
        });
      });
    }
  });

  describe('for the default 40 × 60 × 80 mm cuboid', () => {
    it('exports cuboid.3mf as one closed object in millimetres with a × b × c = 40 × 60 × 80', async () => {
      const { printFile } = await buildModelArtifacts(kernel, defaultModelSpecs.cuboid);
      const { model } = readThreeMf(printFile.bytes);

      expect(printFile.fileName).toBe('cuboid.3mf');
      expect(model.unit).toBe('millimeter');
      expect(model.objects.map(({ name, type }) => ({ name, type }))).toEqual([{ name: 'cuboid', type: 'model' }]);
      expect(model.buildItems).toEqual([{ objectId: model.objects[0]?.id }]);
      const mesh = model.objects[0]?.mesh;
      if (mesh === undefined) throw new Error('No exported mesh');
      expect(findMeshDefects(mesh)).toEqual([]);
      const measurements = measureMesh(mesh);
      expect(measurements.bounds).toEqual({ min: [-20, -30, 0], max: [20, 30, 80] });
      expect(measurements.volume).toBeCloseTo(40 * 60 * 80, 6);
      expect(measurements.surfaceArea).toBeCloseTo(2 * (40 * 60 + 40 * 80 + 60 * 80), 6);
    });

    it('previews a in glTF X, the height c in glTF Y and the width b in glTF −Z, in metres', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, defaultModelSpecs.cuboid);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const range = (axis: 0 | 1 | 2) => [Math.min(...points.map((p) => p[axis])), Math.max(...points.map((p) => p[axis]))];

      const expectedRanges = [
        [-0.02, 0.02],
        [0, 0.08],
        [-0.03, 0.03],
      ];
      ([0, 1, 2] as const).forEach((axis) => {
        const expected = expectedRanges[axis] as number[];
        const [min, max] = range(axis);
        expect(min).toBeCloseTo(expected[0] as number, METRE_DIGITS);
        expect(max).toBeCloseTo(expected[1] as number, METRE_DIGITS);
      });

      // A positive signed volume shows that the axis change kept a right-handed frame and outward winding.
      let sixfoldVolume = 0;
      for (let corner = 0; corner < points.length; corner += 3) {
        const [a, b, c] = points.slice(corner, corner + 3) as [Vec3, Vec3, Vec3];
        sixfoldVolume += dot(a, cross(b, c));
      }
      expect(sixfoldVolume / 6).toBeCloseTo(0.04 * 0.06 * 0.08, 9);
    });
  });

  describe('for a parallelepiped with b/a = 2, h/a = 0,5 and α = 120°', () => {
    // The base is 1 + |2·cos 120°| = 2 wide and 2·sin 120° = √3 deep in units of a, so a = 40 mm, b = 80 mm, h = 20 mm
    // and the base, with area a·b·sin 120° = 1600√3 mm², spans x ∈ [−40, 40] and y ∈ [−20√3, 20√3].
    const spec: ModelSpecInput = {
      shape: { kind: 'parallelepiped', baseSideRatio: 2, heightRatio: 0.5, baseAngleDeg: 120 },
      scale: { longestDimensionMm: 80 },
    };
    const baseArea = 1600 * Math.sqrt(3);
    const halfDepth = 20 * Math.sqrt(3);

    it('exports parallelepiped.3mf as one closed object in millimetres with the analytic bounds, volume and area', async () => {
      const { printFile } = await buildModelArtifacts(kernel, spec);
      const { model } = readThreeMf(printFile.bytes);
      expect(printFile.fileName).toBe('parallelepiped.3mf');
      expect(model.unit).toBe('millimeter');
      expect(model.objects.map(({ name, type }) => ({ name, type }))).toEqual([{ name: 'parallelepiped', type: 'model' }]);
      const mesh = model.objects[0]?.mesh;
      if (mesh === undefined) throw new Error('No exported mesh');
      expect(findMeshDefects(mesh)).toEqual([]);
      const { bounds, volume, surfaceArea } = measureMesh(mesh);
      [-40, -halfDepth, 0].forEach((value, axis) => {
        expect(bounds.min[axis]).toBeCloseTo(value, 4);
      });
      [40, halfDepth, 20].forEach((value, axis) => {
        expect(bounds.max[axis]).toBeCloseTo(value, 4);
      });
      expect(bounds.min[2]).toBe(0);
      expect(volume / (baseArea * 20)).toBeCloseTo(1, 6);
      expect(surfaceArea / (2 * baseArea + 2 * (40 + 80) * 20)).toBeCloseTo(1, 6);
    });

    it('previews the height in glTF Y and the base depth in glTF Z, in metres', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, spec);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const extent = (axis: 0 | 1 | 2) => [Math.min(...points.map((p) => p[axis])), Math.max(...points.map((p) => p[axis]))];
      [
        [-0.04, 0.04],
        [0, 0.02],
        [-halfDepth / 1000, halfDepth / 1000],
      ].forEach(([min, max], axis) => {
        const [actualMin, actualMax] = extent(axis as 0 | 1 | 2);
        expect(actualMin).toBeCloseTo(min as number, METRE_DIGITS);
        expect(actualMax).toBeCloseTo(max as number, METRE_DIGITS);
      });
    });
  });

  describe('for an oblique square prism with h/a = 1 and (dx0, dy0) = (1, 0,5)', () => {
    // The box is (1 + 1) × (1 + 0,5) × 1 in units of a, so a = h = 40 mm and the upper base is moved by (40, 20) mm:
    // x ∈ [−20, 60], y ∈ [−20, 40], z ∈ [0, 40]. Each lateral face spans a base edge e and v = (40, 20, 40) mm.
    const spec: ModelSpecInput = {
      shape: { kind: 'prism', baseSides: 4, heightRatio: 1, offsetXRatio: 1, offsetYRatio: 0.5 },
      scale: { longestDimensionMm: 80 },
    };
    const lateralArea = 2 * 40 * Math.hypot(20, 40) + 2 * 40 * Math.hypot(40, 40);

    it('exports prism-4-sided.3mf in millimetres with the sheared bounds, volume a²h and area 2a² + Σ|e × v|', async () => {
      const { printFile } = await buildModelArtifacts(kernel, spec);
      const { model } = readThreeMf(printFile.bytes);
      expect(printFile.fileName).toBe('prism-4-sided.3mf');
      expect(model.unit).toBe('millimeter');
      expect(model.objects.map(({ name }) => name)).toEqual(['prism-4-sided']);
      const mesh = model.objects[0]?.mesh;
      if (mesh === undefined) throw new Error('No exported mesh');
      expect(findMeshDefects(mesh)).toEqual([]);
      const { bounds, volume, surfaceArea } = measureMesh(mesh);
      [-20, -20, 0].forEach((value, axis) => {
        expect(bounds.min[axis]).toBeCloseTo(value, 4);
      });
      [60, 40, 40].forEach((value, axis) => {
        expect(bounds.max[axis]).toBeCloseTo(value, 4);
      });
      expect(bounds.min[2]).toBe(0);
      expect(volume / 64_000).toBeCloseTo(1, 6);
      expect(surfaceArea / (2 * 1600 + lateralArea)).toBeCloseTo(1, 6);
    });

    it('previews the shear in glTF: +X stays, the height is +Y and the Y offset points to −Z, in metres', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, spec);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const extent = (axis: 0 | 1 | 2) => [Math.min(...points.map((p) => p[axis])), Math.max(...points.map((p) => p[axis]))];
      [
        [-0.02, 0.06],
        [0, 0.04],
        [-0.04, 0.02],
      ].forEach(([min, max], axis) => {
        const [actualMin, actualMax] = extent(axis as 0 | 1 | 2);
        expect(actualMin).toBeCloseTo(min as number, METRE_DIGITS);
        expect(actualMax).toBeCloseTo(max as number, METRE_DIGITS);
      });
      // The top face, at glTF height 0,04 m, is the bottom square moved by (0,04, −0,02) in glTF X and Z.
      const top = points.filter((point) => point[1] > 0.04 - 1e-9);
      expect(Math.min(...top.map((point) => point[0]))).toBeCloseTo(0.02, METRE_DIGITS);
      expect(Math.max(...top.map((point) => point[2]))).toBeCloseTo(0, METRE_DIGITS);
    });
  });

  describe('for the right-triangle prism with b/a = 0,75, α = 90° and h/a = 1', () => {
    // a = 80, b = 60 and c = 100 mm, h = 80 mm; the centroid (80/3, 20) mm of the legs' triangle is at the origin.
    const spec: ModelSpecInput = {
      shape: { kind: 'prism', baseType: 'triangle', baseSideRatio: 0.75, baseAngleDeg: 90, heightRatio: 1 },
      scale: { longestDimensionMm: 80 },
    };

    it('exports prism-triangle.3mf as one closed 80 × 60 × 80 mm object with V = 192 000 mm³ and S = 24 000 mm²', async () => {
      const { printFile } = await buildModelArtifacts(kernel, spec);
      const { model } = readThreeMf(printFile.bytes);
      expect(printFile.fileName).toBe('prism-triangle.3mf');
      expect(model.unit).toBe('millimeter');
      expect(model.objects.map(({ name }) => name)).toEqual(['prism-triangle']);
      const mesh = model.objects[0]?.mesh;
      if (mesh === undefined) throw new Error('No exported mesh');
      expect(findMeshDefects(mesh)).toEqual([]);
      const { bounds, size, volume, surfaceArea } = measureMesh(mesh);
      [80, 60, 80].forEach((value, axis) => {
        expect(size[axis]).toBeCloseTo(value, 4);
      });
      [-80 / 3, -20, 0].forEach((value, axis) => {
        expect(bounds.min[axis]).toBeCloseTo(value, 4);
      });
      expect(volume / 192_000).toBeCloseTo(1, 6);
      expect(surfaceArea / 24_000).toBeCloseTo(1, 6);
    });

    it('previews the legs along glTF X and −Z and the height along glTF Y, in metres', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, spec);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const extent = (axis: 0 | 1 | 2) => [Math.min(...points.map((p) => p[axis])), Math.max(...points.map((p) => p[axis]))];
      [
        [-0.08 / 3, 0.16 / 3],
        [0, 0.08],
        [-0.04, 0.02],
      ].forEach(([min, max], axis) => {
        const [actualMin, actualMax] = extent(axis as 0 | 1 | 2);
        expect(actualMin).toBeCloseTo(min as number, METRE_DIGITS);
        expect(actualMax).toBeCloseTo(max as number, METRE_DIGITS);
      });
    });
  });

  describe('for the oblique right-trapezoid prism with b/a = 0,5, t/a = 0,375, δ/a = −0,25 and h/a = 0,5', () => {
    // Right: a = 80, b = 40, t = 30, h = 40 mm, the box 80 × 30 × 40 mm. With (dx0, dy0) = (0,25, −0,25) the box grows
    // to (1 + 0,25) × (0,375 + 0,25) × 0,5 in units of a, so a = 64 mm, t = 24 mm, h = 32 mm and V = 1152·32 mm³.
    const rightShape = {
      kind: 'prism',
      baseType: 'trapezoid',
      parallelSideRatio: 0.5,
      baseHeightRatio: 0.375,
      baseShiftRatio: -0.25,
      heightRatio: 0.5,
    } as const;
    const scale = { longestDimensionMm: 80 };
    const right: ModelSpecInput = { shape: rightShape, scale };
    const oblique: ModelSpecInput = { shape: { ...rightShape, offsetXRatio: 0.25, offsetYRatio: -0.25 }, scale };

    it.each([
      ['right', right, [80, 30, 40], 72_000],
      ['oblique', oblique, [80, 40, 32], 1152 * 32],
    ] as const)(
      'exports the %s prism as prism-trapezoid.3mf in millimetres with its size and volume',
      async (_, spec, size, volume) => {
        const { printFile } = await buildModelArtifacts(kernel, spec);
        const { model } = readThreeMf(printFile.bytes);
        expect(printFile.fileName).toBe('prism-trapezoid.3mf');
        expect(model.unit).toBe('millimeter');
        expect(model.objects.map(({ name }) => name)).toEqual(['prism-trapezoid']);
        const mesh = model.objects[0]?.mesh;
        if (mesh === undefined) throw new Error('No exported mesh');
        expect(findMeshDefects(mesh)).toEqual([]);
        const measurements = measureMesh(mesh);
        size.forEach((value, axis) => {
          expect(measurements.size[axis]).toBeCloseTo(value, 4);
        });
        expect(measurements.bounds.min[2]).toBe(0);
        expect(measurements.volume / volume).toBeCloseTo(1, 6);
      },
    );

    it('previews the right prism with the base depth t along glTF Z and the height along glTF Y, in metres', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, right);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const extent = (axis: 0 | 1 | 2) => Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]));
      [0.08, 0.04, 0.03].forEach((size, axis) => {
        expect(extent(axis as 0 | 1 | 2)).toBeCloseTo(size, METRE_DIGITS);
      });
      expect(Math.min(...points.map((p) => p[1]))).toBeCloseTo(0, METRE_DIGITS);
    });
  });

  describe('for pyramids with a displaced apex', () => {
    // The square pyramid with h = a and the apex above the corner (−a/2, −a/2): a 1 × 1 × 1 box, so a = h = 80 mm,
    // V = 80³/3 mm³ and S = 80²·(2 + √2) mm².
    const corner: ModelSpecInput = {
      shape: { kind: 'pyramid', baseSides: 4, heightRatio: 1, apexXRatio: -0.5, apexYRatio: -0.5 },
      scale: { longestDimensionMm: 80 },
    };
    // The rectangle-based parallelogram pyramid with the apex at (a, 0), outside the base: the box spans x from −a/2
    // to a, 1,5a wide, so a = h = 160/3 mm.
    const outside: ModelSpecInput = {
      shape: {
        kind: 'pyramid',
        baseType: 'parallelogram',
        baseSideRatio: 1,
        baseAngleDeg: 90,
        heightRatio: 1,
        apexXRatio: 1,
        apexYRatio: 0,
      },
      scale: { longestDimensionMm: 80 },
    };

    it.each([
      ['corner', corner, 'pyramid-4-sided.3mf', [-40, -40, 0], [40, 40, 80], 512_000 / 3, 6400 * (2 + Math.SQRT2)],
      [
        'outside',
        outside,
        'pyramid-parallelogram.3mf',
        [-80 / 3, -80 / 3, 0],
        [160 / 3, 80 / 3, 160 / 3],
        (160 / 3) ** 3 / 3,
        undefined,
      ],
    ] as const)(
      'exports the %s apex in millimetres with its bounds and volume',
      async (_, spec, fileName, min, max, volume, area) => {
        const { printFile } = await buildModelArtifacts(kernel, spec);
        const { model } = readThreeMf(printFile.bytes);
        expect(printFile.fileName).toBe(fileName);
        expect(model.unit).toBe('millimeter');
        const mesh = model.objects[0]?.mesh;
        if (mesh === undefined) throw new Error('No exported mesh');
        expect(findMeshDefects(mesh)).toEqual([]);
        const measurements = measureMesh(mesh);
        min.forEach((value, axis) => {
          expect(measurements.bounds.min[axis]).toBeCloseTo(value, 4);
        });
        max.forEach((value, axis) => {
          expect(measurements.bounds.max[axis]).toBeCloseTo(value, 4);
        });
        expect(measurements.volume / volume).toBeCloseTo(1, 6);
        if (area !== undefined) expect(measurements.surfaceArea / area).toBeCloseTo(1, 6);
      },
    );

    it('previews the apex of the outside pyramid at glTF (a, h, 0), in metres', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, outside);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const top = Math.max(...points.map((point) => point[1]));
      expect(top).toBeCloseTo(0.16 / 3, METRE_DIGITS);
      for (const point of points.filter((candidate) => candidate[1] > 1e-6)) {
        expect(point[0]).toBeCloseTo(0.16 / 3, METRE_DIGITS);
        expect(point[2]).toBeCloseTo(0, METRE_DIGITS);
      }
    });
  });

  describe('for the oblique cylinder and cone', () => {
    // Cylinder h/r = d/r = 1: the box is 3r × 2r × r, so r = h = d = 80/3 mm. Cone h/r = 1, d/r = 3: the apex widens
    // the box to 4r, so r = h = 20 mm and the apex is at (60, 0, 20) mm.
    const cylinder: ModelSpecInput = {
      shape: { kind: 'cylinder', heightRatio: 1, offsetRatio: 1 },
      scale: { longestDimensionMm: 80 },
    };
    const cone: ModelSpecInput = { shape: { kind: 'cone', heightRatio: 1, offsetRatio: 3 }, scale: { longestDimensionMm: 80 } };
    const polygonBase = (r: number) => (64 * r ** 2 * Math.sin((2 * Math.PI) / 64)) / 2;

    it.each([
      ['cylinder', cylinder, [-80 / 3, -80 / 3, 0], [160 / 3, 80 / 3, 80 / 3], polygonBase(80 / 3) * (80 / 3)],
      ['cone', cone, [-20, -20, 0], [60, 20, 20], (polygonBase(20) * 20) / 3],
    ] as const)(
      'exports the oblique %s in millimetres with its sheared bounds and volume',
      async (kind, spec, min, max, volume) => {
        const { printFile } = await buildModelArtifacts(kernel, spec);
        const { model } = readThreeMf(printFile.bytes);
        expect(printFile.fileName).toBe(`${kind}.3mf`);
        expect(model.unit).toBe('millimeter');
        const mesh = model.objects[0]?.mesh;
        if (mesh === undefined) throw new Error('No exported mesh');
        expect(findMeshDefects(mesh)).toEqual([]);
        const measurements = measureMesh(mesh);
        min.forEach((value, axis) => {
          expect(measurements.bounds.min[axis]).toBeCloseTo(value, 4);
        });
        max.forEach((value, axis) => {
          expect(measurements.bounds.max[axis]).toBeCloseTo(value, 4);
        });
        expect(measurements.volume / volume).toBeCloseTo(1, 6);
      },
    );

    it('previews the cone apex at glTF (60, 20, 0) mm, in metres', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, cone);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const apex = points.filter((point) => point[1] > 1e-6);
      expect(apex.length).toBeGreaterThan(0);
      for (const point of apex) {
        expect(point[0]).toBeCloseTo(0.06, METRE_DIGITS);
        expect(point[1]).toBeCloseTo(0.02, METRE_DIGITS);
        expect(point[2]).toBeCloseTo(0, METRE_DIGITS);
      }
    });
  });

  describe('for the octahedron, icosahedron and dodecahedron', () => {
    // a = 80 mm divided by the depth in edges: 2/√3, 2φ/√3 and 2·tan 54°; the heights 2·inradius follow from a.
    const phi = (1 + Math.sqrt(5)) / 2;
    const tan54 = Math.tan((54 * Math.PI) / 180);
    const cases = [
      ['octahedron', 40 * Math.sqrt(3), [1, 2 / Math.sqrt(3), Math.sqrt(2 / 3)], Math.SQRT2 / 3],
      [
        'icosahedron',
        (40 * Math.sqrt(3)) / phi,
        [phi, (2 * phi) / Math.sqrt(3), phi ** 2 / Math.sqrt(3)],
        (5 * (3 + Math.sqrt(5))) / 12,
      ],
      ['dodecahedron', 40 / tan54, [phi ** 2, 2 * tan54, Math.sqrt((25 + 11 * Math.sqrt(5)) / 10)], (15 + 7 * Math.sqrt(5)) / 4],
    ] as const;

    it.each(cases)(
      'exports the %s as one closed object in millimetres with the analytic box and volume',
      async (kind, a, box, volumeFactor) => {
        for (const longestDimensionMm of [80, 160]) {
          const factor = longestDimensionMm / 80;
          const { printFile } = await buildModelArtifacts(kernel, { shape: { kind }, scale: { longestDimensionMm } });
          const { model } = readThreeMf(printFile.bytes);
          expect(printFile.fileName).toBe(`${kind}.3mf`);
          expect(model.unit).toBe('millimeter');
          expect(model.objects.map(({ name }) => name)).toEqual([kind]);
          const mesh = model.objects[0]?.mesh;
          if (mesh === undefined) throw new Error('No exported mesh');
          expect(findMeshDefects(mesh)).toEqual([]);
          const { bounds, volume } = measureMesh(mesh);
          const size = box.map((value) => value * a * factor);
          expect(Math.max(...size)).toBeCloseTo(longestDimensionMm, 9);
          size.forEach((value, axis) => {
            expect(bounds.min[axis]).toBeCloseTo(axis === 2 ? 0 : -value / 2, 4);
            expect(bounds.max[axis]).toBeCloseTo(axis === 2 ? value : value / 2, 4);
          });
          expect(volume / (volumeFactor * (a * factor) ** 3)).toBeCloseTo(1, 6);
        }
      },
    );

    it.each(cases)('previews the %s resting on its face in the glTF ground plane, in metres', async (kind, a, box) => {
      const { previewGlb } = await buildModelArtifacts(kernel, defaultModelSpecs[kind]);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const heights = points.map((point) => point[1]);
      expect(Math.min(...heights)).toBe(0);
      expect(Math.max(...heights)).toBeCloseTo((box[2] * a) / 1000, METRE_DIGITS);
      // The Z-up depth, the largest dimension, becomes glTF −Z: 80 mm in all three cases.
      const depths = points.map((point) => point[2]);
      expect(Math.max(...depths) - Math.min(...depths)).toBeCloseTo(0.08, METRE_DIGITS);
      const ground = new Set(points.filter((point) => point[1] === 0).map((point) => point.join(',')));
      expect(ground.size).toBe(kind === 'dodecahedron' ? 5 : 3);
    });
  });

  describe('for the default ball', () => {
    it('exports ball.3mf as one closed 80 mm object in millimetres resting on the build plate', async () => {
      const { printFile } = await buildModelArtifacts(kernel, defaultModelSpecs.ball);
      const { model } = readThreeMf(printFile.bytes);
      expect(printFile.fileName).toBe('ball.3mf');
      expect(model.unit).toBe('millimeter');
      expect(model.objects.map(({ name }) => name)).toEqual(['ball']);
      const mesh = model.objects[0]?.mesh;
      if (mesh === undefined) throw new Error('No exported mesh');
      expect(findMeshDefects(mesh)).toEqual([]);
      const { bounds, volume } = measureMesh(mesh);
      [-40, -40, 0].forEach((value, axis) => {
        expect(bounds.min[axis]).toBeCloseTo(value, 4);
      });
      [40, 40, 80].forEach((value, axis) => {
        expect(bounds.max[axis]).toBeCloseTo(value, 4);
      });
      // Inscribed in the ideal ball and at most 0,05 mm inside it: between the balls of radius 39,95 and 40 mm.
      expect(volume).toBeLessThan((4 / 3) * Math.PI * 40 ** 3);
      expect(volume).toBeGreaterThan((4 / 3) * Math.PI * 39.95 ** 3);
    });

    it('previews the ball centred on the glTF up axis, from 0 to 0,08 m', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, defaultModelSpecs.ball);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const extent = (axis: 0 | 1 | 2) => [Math.min(...points.map((p) => p[axis])), Math.max(...points.map((p) => p[axis]))];
      [
        [-0.04, 0.04],
        [0, 0.08],
        [-0.04, 0.04],
      ].forEach(([min, max], axis) => {
        const [actualMin, actualMax] = extent(axis as 0 | 1 | 2);
        expect(actualMin).toBeCloseTo(min as number, METRE_DIGITS);
        expect(actualMax).toBeCloseTo(max as number, METRE_DIGITS);
      });
    });
  });

  describe.each([
    ['cylinder', 1],
    ['cone', 1 / 3],
  ] as const)('for a %s with h/r = 4', (kind, volumeShare) => {
    // r = 80 / 4 = 20 mm and h = 80 mm; the 64-gon inscribed in the base circle has area 64·r²·sin(2π/64) / 2.
    const spec: ModelSpecInput = { shape: { kind, heightRatio: 4 }, scale: { longestDimensionMm: 80 } };
    const polygonBase = (64 * 20 ** 2 * Math.sin((2 * Math.PI) / 64)) / 2;

    it(`exports ${kind}.3mf as one closed 40 × 40 × 80 mm object in millimetres`, async () => {
      const { printFile } = await buildModelArtifacts(kernel, spec);
      const { model } = readThreeMf(printFile.bytes);
      expect(printFile.fileName).toBe(`${kind}.3mf`);
      expect(model.unit).toBe('millimeter');
      expect(model.objects.map(({ name }) => name)).toEqual([kind]);
      const mesh = model.objects[0]?.mesh;
      if (mesh === undefined) throw new Error('No exported mesh');
      expect(findMeshDefects(mesh)).toEqual([]);
      const measurements = measureMesh(mesh);
      expect(measurements.bounds.min[2]).toBe(0);
      [40, 40, 80].forEach((size, axis) => {
        expect(measurements.size[axis]).toBeCloseTo(size, 4);
      });
      expect(measurements.volume / (polygonBase * 80 * volumeShare)).toBeCloseTo(1, 6);
    });

    it('previews the axis as glTF Y, in metres', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, spec);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const extent = (axis: 0 | 1 | 2) => [Math.min(...points.map((p) => p[axis])), Math.max(...points.map((p) => p[axis]))];
      expect(extent(0)[0]).toBeCloseTo(-0.02, METRE_DIGITS);
      expect(extent(0)[1]).toBeCloseTo(0.02, METRE_DIGITS);
      expect(extent(1)[0]).toBeCloseTo(0, METRE_DIGITS);
      expect(extent(1)[1]).toBeCloseTo(0.08, METRE_DIGITS);
      expect(extent(2)[0]).toBeCloseTo(-0.02, METRE_DIGITS);
      expect(extent(2)[1]).toBeCloseTo(0.02, METRE_DIGITS);
    });
  });

  describe('for a hexagonal pyramid with h/a = 2', () => {
    // The hexagon is two edges wide and h = 2a, so a = 40 mm and h = 80 mm.
    const spec: ModelSpecInput = { shape: { kind: 'pyramid', baseSides: 6, heightRatio: 2 }, scale: { longestDimensionMm: 80 } };
    const a = 40;
    const h = 80;
    const baseArea = ((3 * Math.sqrt(3)) / 2) * a ** 2;
    const apothem = (Math.sqrt(3) / 2) * a;

    it('exports pyramid-6-sided.3mf in millimetres with the analytic volume and surface area', async () => {
      const { printFile } = await buildModelArtifacts(kernel, spec);
      const { model } = readThreeMf(printFile.bytes);
      expect(printFile.fileName).toBe('pyramid-6-sided.3mf');
      expect(model.unit).toBe('millimeter');
      expect(model.objects.map(({ name }) => name)).toEqual(['pyramid-6-sided']);
      const mesh = model.objects[0]?.mesh;
      if (mesh === undefined) throw new Error('No exported mesh');
      expect(findMeshDefects(mesh)).toEqual([]);
      const measurements = measureMesh(mesh);
      expect(measurements.bounds.min[2]).toBe(0);
      [2 * a, Math.sqrt(3) * a, h].forEach((size, axis) => {
        expect(measurements.size[axis]).toBeCloseTo(size, 4);
      });
      expect(measurements.volume / ((baseArea * h) / 3)).toBeCloseTo(1, 6);
      expect(measurements.surfaceArea / (baseArea + 3 * a * Math.hypot(h, apothem))).toBeCloseTo(1, 6);
    });

    it('previews the apex on the glTF up axis above the base centre', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, spec);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const top = Math.max(...points.map((point) => point[1]));
      expect(top).toBeCloseTo(h / 1000, METRE_DIGITS);
      for (const point of points.filter((candidate) => candidate[1] > 1e-6)) {
        expect(point[0]).toBeCloseTo(0, METRE_DIGITS);
        expect(point[2]).toBeCloseTo(0, METRE_DIGITS);
      }
    });
  });

  describe('for a hexagonal prism with h/a = 0,5', () => {
    // The hexagon is two edges wide, so a = 80 / 2 = 40 mm, h = 20 mm and the base is 40√3 mm deep.
    const spec: ModelSpecInput = { shape: { kind: 'prism', baseSides: 6, heightRatio: 0.5 }, scale: { longestDimensionMm: 80 } };
    const a = 40;
    const h = 20;
    const baseArea = ((3 * Math.sqrt(3)) / 2) * a ** 2;

    it('exports prism-6-sided.3mf as one closed object in millimetres with the analytic size, volume and area', async () => {
      const { printFile } = await buildModelArtifacts(kernel, spec);
      const { model } = readThreeMf(printFile.bytes);

      expect(printFile.fileName).toBe('prism-6-sided.3mf');
      expect(model.unit).toBe('millimeter');
      expect(model.objects.map(({ name, type }) => ({ name, type }))).toEqual([{ name: 'prism-6-sided', type: 'model' }]);
      const mesh = model.objects[0]?.mesh;
      if (mesh === undefined) throw new Error('No exported mesh');
      expect(findMeshDefects(mesh)).toEqual([]);
      const measurements = measureMesh(mesh);
      expect(measurements.bounds.min[2]).toBe(0);
      [2 * a, Math.sqrt(3) * a, h].forEach((size, axis) => {
        expect(measurements.size[axis]).toBeCloseTo(size, 4);
      });
      expect(measurements.volume / (baseArea * h)).toBeCloseTo(1, 6);
      expect(measurements.surfaceArea / (2 * baseArea + 6 * a * h)).toBeCloseTo(1, 6);
    });

    it('previews the height in glTF Y and the base depth in glTF Z, in metres and outward-oriented', async () => {
      const { previewGlb } = await buildModelArtifacts(kernel, spec);
      const positions = await previewSurfacePositions(previewGlb);
      const points = Array.from(
        { length: positions.getCount() },
        (_, index) => positions.getElement(index, []) as unknown as Vec3,
      );
      const extent = (axis: 0 | 1 | 2) => [Math.min(...points.map((p) => p[axis])), Math.max(...points.map((p) => p[axis]))];
      const halfDepth = (Math.sqrt(3) * a) / 2 / 1000;
      [
        [-0.04, 0.04],
        [0, h / 1000],
        [-halfDepth, halfDepth],
      ].forEach(([min, max], axis) => {
        const [actualMin, actualMax] = extent(axis as 0 | 1 | 2);
        expect(actualMin).toBeCloseTo(min as number, METRE_DIGITS);
        expect(actualMax).toBeCloseTo(max as number, METRE_DIGITS);
      });
      let sixfoldVolume = 0;
      for (let corner = 0; corner < points.length; corner += 3) {
        const [p, q, r] = points.slice(corner, corner + 3) as [Vec3, Vec3, Vec3];
        sixfoldVolume += dot(p, cross(q, r));
      }
      expect(sixfoldVolume / 6 / ((baseArea * h) / 1e9)).toBeCloseTo(1, 5);
    });
  });

  it.each([
    ['cube', { shape: { kind: 'cube' }, scale: { longestDimensionMm: -1 } }],
    ['cuboid', { shape: { kind: 'cuboid', widthRatio: 9, heightRatio: 2 }, scale: { longestDimensionMm: 80 } }],
    [
      'parallelepiped',
      {
        shape: { kind: 'parallelepiped', baseSideRatio: 1, heightRatio: 1, baseAngleDeg: 170 },
        scale: { longestDimensionMm: 80 },
      },
    ],
    ['prism', { shape: { kind: 'prism', baseSides: 9, heightRatio: 2 }, scale: { longestDimensionMm: 80 } }],
    [
      'pyramid with an infinite apex coordinate',
      {
        shape: { kind: 'pyramid', baseSides: 4, heightRatio: 1, apexXRatio: Number.POSITIVE_INFINITY },
        scale: { longestDimensionMm: 80 },
      },
    ],
    [
      'trapezoid prism',
      {
        shape: {
          kind: 'prism',
          baseType: 'trapezoid',
          parallelSideRatio: 0.5,
          baseHeightRatio: 0.5,
          baseShiftRatio: 2.5,
          heightRatio: 1,
        },
        scale: { longestDimensionMm: 80 },
      },
    ],
    [
      'triangle prism',
      {
        shape: { kind: 'prism', baseType: 'triangle', baseSideRatio: 1, baseAngleDeg: 170, heightRatio: 1 },
        scale: { longestDimensionMm: 80 },
      },
    ],
    [
      'oblique prism with a NaN offset',
      { shape: { kind: 'prism', baseSides: 4, heightRatio: 1, offsetXRatio: Number.NaN }, scale: { longestDimensionMm: 80 } },
    ],
    ['pyramid', { shape: { kind: 'pyramid', baseSides: 9, heightRatio: 1 }, scale: { longestDimensionMm: 80 } }],
    ['tetrahedron', { shape: { kind: 'tetrahedron', heightRatio: 1 }, scale: { longestDimensionMm: 80 } }],
    ['cylinder', { shape: { kind: 'cylinder', heightRatio: 0 }, scale: { longestDimensionMm: 80 } }],
    ['cone', { shape: { kind: 'cone', heightRatio: Number.NaN }, scale: { longestDimensionMm: 80 } }],
    [
      'cylinder displaced infinitely',
      {
        shape: { kind: 'cylinder', heightRatio: 1, offsetRatio: Number.POSITIVE_INFINITY },
        scale: { longestDimensionMm: 80 },
      },
    ],
    ['cone displaced backwards', { shape: { kind: 'cone', heightRatio: 1, offsetRatio: -1 }, scale: { longestDimensionMm: 80 } }],
    ['ball', { shape: { kind: 'ball', radius: 40 }, scale: { longestDimensionMm: 80 } }],
  ] as const)('produces no %s artifacts for invalid input', async (_, invalid) => {
    await expect(buildModelArtifacts(kernel, invalid as unknown as ModelSpecInput)).rejects.toBeInstanceOf(InvalidModelSpecError);
  });
});

describe('for a cylinder cut parallel to its bases', () => {
  // h/r = 1, d/r = 1,5: the box is 3,5r × 2r × r, so r = h = 80/3,5 mm. At 25 % of h the parts are h/4 and 3h/4 high.
  const r = 80 / 3.5;
  const spec: ModelSpecInput = {
    shape: { kind: 'cylinder', heightRatio: 1, offsetRatio: 1.5 },
    scale: { longestDimensionMm: 80 },
    section: { type: 'parallel-to-bases', positionPercent: 25 },
  };

  it('exports both parts as separate closed objects in millimetres, side by side on the build plate', async () => {
    const { model, printFile } = await buildModelArtifacts(kernel, spec);
    const parsed = readThreeMf(printFile.bytes).model;
    expect(printFile.fileName).toBe('cylinder-parallel-section.3mf');
    expect(parsed.unit).toBe('millimeter');
    expect(parsed.title).toBe('cylinder-parallel-section');
    expect(parsed.objects.map(({ id, name, type }) => ({ id, name, type }))).toEqual([
      { id: '1', name: 'cylinder-lower-part', type: 'model' },
      { id: '2', name: 'cylinder-upper-part', type: 'model' },
    ]);
    expect(parsed.buildItems).toEqual([{ objectId: '1' }, { objectId: '2' }]);

    const [lower, upper] = parsed.objects.map(({ mesh }) => {
      expect(findMeshDefects(mesh)).toEqual([]);
      return measureMesh(mesh);
    });
    if (lower === undefined || upper === undefined) throw new Error('Expected two objects');
    // Translated only: each keeps its size and volume and rests on z = 0.
    [lower, upper].forEach((printed, index) => {
      const solid = model.solids[index]?.measurements;
      printed.size.forEach((value, axis) => {
        expect(value).toBeCloseTo(solid?.size[axis] ?? Number.NaN, 4);
      });
      expect(printed.volume / (solid?.volume ?? Number.NaN)).toBeCloseTo(1, 6);
      expect(printed.bounds.min[2]).toBe(0);
    });
    // The lower part spans its base circle and the cut circle moved by 0,25d = 0,375r; the upper part the cut circle
    // and the upper base moved by d = 1,5r. Heights h/4 and 3h/4.
    expect(lower.size[0]).toBeCloseTo(2.375 * r, 4);
    expect(upper.size[0]).toBeCloseTo(3.125 * r, 4);
    expect(lower.size[2]).toBeCloseTo(r / 4, 4);
    expect(upper.size[2]).toBeCloseTo((3 * r) / 4, 4);
    // 5 mm apart along X, without overlapping in XY.
    expect(upper.bounds.min[0] - lower.bounds.max[0]).toBeCloseTo(5, 4);
    expect(lower.bounds.min[1]).toBeCloseTo(upper.bounds.min[1], 4);
  });

  it('previews the parts assembled, with the cut faces in their own material, and moves the upper one apart only in a second preview', async () => {
    const { model, previewGlb, separatedPreviewGlb, printFile } = await buildModelArtifacts(kernel, spec);
    if (separatedPreviewGlb === undefined) throw new Error('No separated preview');
    const read = async (glb: Uint8Array) => (await new WebIO().readBinary(glb)).getRoot();
    const [assembled, separated] = [await read(previewGlb), await read(separatedPreviewGlb)];
    expect(assembled.listNodes().map((node) => [node.getName(), node.getTranslation()])).toEqual([
      ['cylinder-lower-part', [0, 0, 0]],
      ['cylinder-upper-part', [0, 0, 0]],
    ]);
    // 0,15 of the longest side, 80 mm, along the plane's normal +Z, which is glTF +Y, in metres.
    const gap = SECTION_PREVIEW_GAP_RELATIVE * 80;
    const [, lift] = separated.listNodes().map((node) => node.getTranslation());
    expect(lift?.[0]).toBe(0);
    expect(lift?.[1]).toBeCloseTo(gap / 1000, 9);
    expect(lift?.[2]).toBe(0);
    expect(separated.listNodes()[0]?.getTranslation()).toEqual([0, 0, 0]);

    // The same triangles in both previews: only the node moved.
    const arrays = (root: typeof assembled) =>
      root
        .listMeshes()
        .flatMap((mesh) => mesh.listPrimitives().map((primitive) => primitive.getAttribute('POSITION')?.getArray()));
    expect(arrays(separated)).toEqual(arrays(assembled));

    // Each part has one cut face in the plane z = h/4, glTF y = h/4000, covering the polygon's area.
    for (const mesh of assembled.listMeshes()) {
      const cut = mesh.listPrimitives().filter((primitive) => primitive.getMaterial()?.getName() === 'cut');
      expect(cut).toHaveLength(1);
      const positions = cut[0]?.getAttribute('POSITION');
      for (let index = 0; index < (positions?.getCount() ?? 0); index += 1) {
        expect(positions?.getElement(index, [])[1]).toBeCloseTo(r / 4000, METRE_DIGITS);
      }
    }
    // The print file does not depend on either preview: it holds the parts laid out for printing.
    expect(printFile.bytes).toEqual(createThreeMf(arrangeInRow(model.solids), { title: model.name }));
  });

  it('keeps a single object and no separated preview without a section', async () => {
    const { model, previewGlb, separatedPreviewGlb, printFile } = await buildModelArtifacts(kernel, {
      ...spec,
      section: undefined,
    });
    expect(separatedPreviewGlb).toBeUndefined();
    expect(model.section).toBeUndefined();
    expect(printFile.fileName).toBe('cylinder.3mf');
    expect(readThreeMf(printFile.bytes).model.objects).toHaveLength(1);
    const root = (await new WebIO().readBinary(previewGlb)).getRoot();
    expect(root.listMaterials().map((material) => material.getName())).not.toContain('cut');
  });
});

describe('for a cylinder joined by a dovetail', () => {
  // h/r = 2, r = 40 mm, H = 80 mm, cut at 25 %: the lower part is 20 mm high with a 2 mm tongue, the upper part 60 mm.
  const spec: ModelSpecInput = {
    shape: { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 },
    scale: { longestDimensionMm: 80 },
    section: {
      type: 'parallel-to-bases',
      positionPercent: 25,
      connector: { type: 'dovetail', sizeFactor: 1, lengthPercent: 50, clearanceMm: 0.2 },
    },
  };

  /** The area of the mesh's faces in the plane z = height that face up (+1) or down (−1). */
  function horizontalArea(mesh: TriangleMesh, height: number, facing: 1 | -1): number {
    let area = 0;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const corners = triangleAt(mesh, triangle);
      if (!corners.every((vertex) => Math.abs(vertexAt(mesh, vertex)[2] - height) < 1e-4)) continue;
      const z = triangleAreaVector(mesh, triangle)[2] / 2;
      if (Math.sign(z) === facing) area += Math.abs(z);
    }
    return area;
  }

  it('exports both parts with their connector faces up, on the bed and side by side, at the scale of the whole', async () => {
    const { model, printFile } = await buildModelArtifacts(kernel, spec);
    const parsed = readThreeMf(printFile.bytes).model;
    expect(parsed.unit).toBe('millimeter');
    expect(parsed.objects.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: '1', name: 'cylinder-lower-part' },
      { id: '2', name: 'cylinder-upper-part' },
    ]);
    expect(parsed.buildItems).toEqual([{ objectId: '1' }, { objectId: '2' }]);
    const [lowerMesh, upperMesh] = parsed.objects.map(({ mesh }) => mesh) as [TriangleMesh, TriangleMesh];
    const [lower, upper] = [lowerMesh, upperMesh].map((mesh) => {
      expect(findMeshDefects(mesh)).toEqual([]);
      return measureMesh(mesh);
    }) as [ReturnType<typeof measureMesh>, ReturnType<typeof measureMesh>];
    // Rigid placement only: sizes and volumes of the generated parts.
    [lower, upper].forEach((printed, index) => {
      const solid = model.solids[index]?.measurements;
      printed.size.forEach((value, axis) => {
        expect(value).toBeCloseTo(solid?.size[axis] ?? Number.NaN, 4);
      });
      expect(printed.volume / (solid?.volume ?? Number.NaN)).toBeCloseTo(1, 6);
      expect(printed.bounds.min[2]).toBe(0);
    });
    expect(lower.size[2]).toBeCloseTo(22, 4);
    expect(upper.size[2]).toBeCloseTo(60, 4);
    expect(upper.bounds.min[0] - lower.bounds.max[0]).toBeCloseTo(5, 4);

    // The lower part stands on its full base; the tongue's head is its top. The upper part stands on its former upper
    // base, so its full circle is down and the cut face, with the groove's opening, is up.
    const circle = (64 * 40 ** 2 * Math.sin((2 * Math.PI) / 64)) / 2;
    expect(horizontalArea(lowerMesh, 0, -1)).toBeCloseTo(circle, 1);
    expect(horizontalArea(upperMesh, 0, -1)).toBeCloseTo(circle, 1);
    const cutFace = horizontalArea(upperMesh, 60, 1);
    expect(cutFace).toBeGreaterThan(0.8 * circle);
    expect(cutFace).toBeLessThan(circle - 100);
    // The head's top: B wide from −L/2 to the lead-in chamfer, 10 × 39,5 mm².
    const plan = model.section?.connector;
    if (plan?.type !== 'dovetail') throw new Error('Expected a dovetail');
    expect(horizontalArea(lowerMesh, 22, 1)).toBeCloseTo((plan?.headWidth ?? 0) * ((plan?.length ?? 0) - (plan?.leadIn ?? 0)), 3);
  });

  it('previews the parts slid apart along the sliding direction, off the tongue, without moving them along n', async () => {
    const { model, previewGlb, separatedPreviewGlb, printFile } = await buildModelArtifacts(kernel, spec);
    const plan = model.section?.connector;
    if (separatedPreviewGlb === undefined || plan?.type !== 'dovetail') throw new Error('Expected a joined section');
    const nodes = (await new WebIO().readBinary(separatedPreviewGlb)).getRoot().listNodes();
    const distance = plan.exitDistance + SECTION_PREVIEW_GAP_RELATIVE * 80;
    // u = +Y is glTF −Z; nothing along glTF Y, the plane's normal.
    expect(nodes.map((node) => node.getTranslation()[1])).toEqual([0, 0]);
    expect(nodes[1]?.getTranslation()[2]).toBeCloseTo(-distance / 1000, 9);
    expect(plan.exitDistance).toBeGreaterThan(40 + plan.length / 2);
    // Tongue, groove and cut faces share the cut colour; the exterior keeps the surface colour.
    const meshes = (await new WebIO().readBinary(previewGlb)).getRoot().listMeshes();
    for (const mesh of meshes) {
      const materials = mesh.listPrimitives().map((primitive) => primitive.getMaterial()?.getName());
      expect(materials).toEqual(['surface', 'cut', 'edges']);
    }
    // The preview's separation is not in the print file.
    expect(printFile.bytes).toEqual((await buildModelArtifacts(kernel, spec)).printFile.bytes);
  });
});

describe('for a cylinder joined by plugs or dowels', () => {
  const round = (connector: Record<string, unknown>): ModelSpecInput => ({
    shape: { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 },
    scale: { longestDimensionMm: 80 },
    section: {
      type: 'parallel-to-bases',
      positionPercent: 50,
      connector: { diameterFactor: 1, depthFactor: 1, ...connector } as never,
    },
  });
  const plugs = (count: 1 | 2) =>
    round({ type: 'plug', count, holeClearanceMm: 0.2, ...(count === 2 ? { spacingPercent: 45 } : {}) });
  const dowels = (count: 1 | 2) =>
    round({
      type: 'dowel',
      count,
      lowerClearanceMm: 0.1,
      upperClearanceMm: 0.2,
      ...(count === 2 ? { spacingPercent: 45 } : {}),
    });

  it.each([
    ['one plug', plugs(1), ['cylinder-lower-part', 'cylinder-upper-part']],
    ['two plugs', plugs(2), ['cylinder-lower-part', 'cylinder-upper-part']],
    ['one dowel', dowels(1), ['cylinder-lower-part', 'cylinder-upper-part', 'cylinder-dowel-1']],
    ['two dowels', dowels(2), ['cylinder-lower-part', 'cylinder-upper-part', 'cylinder-dowel-1', 'cylinder-dowel-2']],
  ] as const)(
    'exports %s as independent objects on the bed, in a row 5 mm apart, at the scale of the whole',
    async (_, spec, names) => {
      const { model, printFile } = await buildModelArtifacts(kernel, spec);
      const parsed = readThreeMf(printFile.bytes).model;
      expect(parsed.unit).toBe('millimeter');
      expect(parsed.objects.map(({ name }) => name)).toEqual(names);
      expect(parsed.buildItems).toEqual(parsed.objects.map(({ id }) => ({ objectId: id })));
      expect(new Set(parsed.objects.map(({ id }) => id)).size).toBe(names.length);
      const printed = parsed.objects.map(({ mesh }) => {
        expect(findMeshDefects(mesh)).toEqual([]);
        return measureMesh(mesh);
      });
      printed.forEach((measured, index) => {
        expect(measured.bounds.min[2]).toBe(0);
        const solid = model.solids[index]?.measurements;
        measured.size.forEach((value, axis) => {
          expect(value).toBeCloseTo(solid?.size[axis] ?? Number.NaN, 4);
        });
        expect(measured.volume / (solid?.volume ?? Number.NaN)).toBeCloseTo(1, 6);
        if (index > 0) expect(measured.bounds.min[0] - (printed[index - 1]?.bounds.max[0] ?? 0)).toBeCloseTo(5, 4);
      });
      // Both halves stand on their full bases: the lower part 40 mm high, plus a 4 mm plug; the upper part flipped.
      expect(printed[0]?.size[2]).toBeCloseTo(spec.section?.connector?.type === 'plug' ? 44 : 40, 4);
      expect(printed[1]?.size[2]).toBeCloseTo(40, 4);
      // Dowels stand upright: 2e = 8 mm high, d and 0,8d wide.
      printed.slice(2).forEach((dowel, index) => {
        expect(dowel.size[2]).toBeCloseTo(8, 4);
        expect(dowel.size[0]).toBeCloseTo([5, 4][index] ?? Number.NaN, 4);
      });
    },
  );

  it('turns the upper part over, so that its hole openings face up', async () => {
    const { printFile } = await buildModelArtifacts(kernel, plugs(1));
    const upper = readThreeMf(printFile.bytes).model.objects[1]?.mesh as TriangleMesh;
    const { bounds } = measureMesh(upper);
    const centre = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
    // Vertices of the hole, 2,6 mm in radius and 3 mm at its chamfered entrance, lie between the top, where it opens,
    // and 4,3 mm below it.
    const nearAxis = Array.from({ length: upper.positions.length / 3 }, (_, vertex) => vertexAt(upper, vertex)).filter(
      ([x, y]) => Math.hypot(x - (centre[0] ?? 0), y - (centre[1] ?? 0)) < 3.05,
    );
    const heights = nearAxis.map(([, , z]) => z);
    expect(Math.max(...heights)).toBeCloseTo(40, 4);
    expect(Math.min(...heights)).toBeCloseTo(40 - 4.3, 4);
  });

  it('previews the halves apart along the normal with the dowels seated in the lower part, as separate nodes', async () => {
    const { previewGlb, separatedPreviewGlb, printFile } = await buildModelArtifacts(kernel, dowels(2));
    if (separatedPreviewGlb === undefined) throw new Error('Expected a separated preview');
    const nodes = (await new WebIO().readBinary(separatedPreviewGlb)).getRoot().listNodes();
    expect(nodes.map((node) => node.getName())).toEqual([
      'cylinder-lower-part',
      'cylinder-upper-part',
      'cylinder-dowel-1',
      'cylinder-dowel-2',
    ]);
    // +Z, the cut's normal, is glTF +Y; only the upper part moves, by 0,5 × 80 mm, enough to uncover the dowels.
    expect(CONNECTOR_PREVIEW_GAP_RELATIVE).toBe(0.5);
    expect(nodes.map((node) => node.getTranslation())).toEqual([
      [0, 0, 0],
      [0, 0.04, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const assembled = (await new WebIO().readBinary(previewGlb)).getRoot().listNodes();
    expect(assembled.map((node) => node.getTranslation())).toEqual(nodes.map(() => [0, 0, 0]));
    // Dowels are entirely new faces, shown in the cut colour; the preview's separation is not in the print file.
    const dowelMaterials = assembled[2]
      ?.getMesh()
      ?.listPrimitives()
      .map((primitive) => primitive.getMaterial()?.getName());
    expect(dowelMaterials?.[0]).toBe('cut');
    expect(printFile.bytes).toEqual((await buildModelArtifacts(kernel, dowels(2))).printFile.bytes);
  });
  it.each([
    // A 30 mm plug on a 40 mm lower part: 30 mm above the cut, plus the flat cut's 0,15 × 80 = 12 mm gap.
    ['a 30 mm plug', { type: 'plug', count: 1, depthFactor: 7.5, holeClearanceMm: 0.2 }, 30 + 12],
    // A 60 mm dowel seated in the lower part reaches 30 mm above the cut.
    ['a 60 mm dowel', { type: 'dowel', count: 1, depthFactor: 7.5, lowerClearanceMm: 0.1, upperClearanceMm: 0.2 }, 30 + 12],
    // The default 4 mm plug keeps the 0,5 × 80 = 40 mm minimum.
    ['the default plug', { type: 'plug', count: 1, holeClearanceMm: 0.2 }, 40],
  ])('raises the upper part far enough to clear %s, measured on the generated parts', async (_, connector, distance) => {
    const spec = round(connector);
    const { model, separatedPreviewGlb, printFile } = await buildModelArtifacts(kernel, spec);
    expect(previewSeparation(model)).toBeCloseTo(distance, 4);
    const nodes = (await new WebIO().readBinary(separatedPreviewGlb as Uint8Array)).getRoot().listNodes();
    expect(nodes[1]?.getTranslation()[1]).toBeCloseTo(distance / 1000, 6);
    // Display only: the print file is the one built for the same specification, whatever the separation.
    expect(printFile.bytes).toEqual((await buildModelArtifacts(kernel, spec)).printFile.bytes);
  });
});

describe('for a cylinder cut vertically', () => {
  const vertical = (
    shape: { heightRatio: number; offsetRatio: number },
    connector?: Record<string, unknown>,
  ): ModelSpecInput => ({
    shape: { kind: 'cylinder', ...shape },
    scale: { longestDimensionMm: 80 },
    section: {
      type: 'vertical',
      offsetPercent: 25,
      ...(connector === undefined ? {} : { connector: connector as never }),
    },
  });
  const right = { heightRatio: 2, offsetRatio: 0 };
  const oblique = { heightRatio: 2, offsetRatio: 1 };
  const round = { diameterFactor: 1, depthFactor: 1 };
  const plug = (count: 1 | 2) => ({
    type: 'plug',
    ...round,
    count,
    holeClearanceMm: 0.2,
    ...(count === 2 ? { spacingPercent: 45 } : {}),
  });
  const dowel = (count: 1 | 2) => ({
    type: 'dowel',
    ...round,
    count,
    lowerClearanceMm: 0.1,
    upperClearanceMm: 0.2,
    ...(count === 2 ? { spacingPercent: 45 } : {}),
  });
  const dovetail = { type: 'dovetail', sizeFactor: 1, lengthPercent: 50, clearanceMm: 0.2 };
  const translations = async (glb: Uint8Array) =>
    Object.fromEntries(
      (await new WebIO().readBinary(glb))
        .getRoot()
        .listNodes()
        .map((node) => [node.getName(), node.getTranslation()]),
    );

  it.each([
    ['a smooth cut', right, undefined, ['cylinder-part-1', 'cylinder-part-2']],
    ['one plug', right, plug(1), ['cylinder-part-1', 'cylinder-part-2']],
    ['two plugs', oblique, plug(2), ['cylinder-part-1', 'cylinder-part-2']],
    ['a dovetail', right, dovetail, ['cylinder-part-1', 'cylinder-part-2']],
    ['an oblique dovetail', oblique, dovetail, ['cylinder-part-1', 'cylinder-part-2']],
    ['one dowel', right, dowel(1), ['cylinder-part-1', 'cylinder-part-2', 'cylinder-dowel-1']],
    ['two dowels', oblique, dowel(2), ['cylinder-part-1', 'cylinder-part-2', 'cylinder-dowel-1', 'cylinder-dowel-2']],
  ] as const)(
    'exports %s as separate upright objects at the original scale, in a row without overlaps',
    async (_, shape, connector, names) => {
      const { model, printFile } = await buildModelArtifacts(kernel, vertical(shape, connector));
      expect(printFile.fileName).toBe('cylinder-vertical-section.3mf');
      const parsed = readThreeMf(printFile.bytes).model;
      expect(parsed.unit).toBe('millimeter');
      expect(parsed.objects.map(({ name }) => name)).toEqual([...names]);
      const printed = parsed.objects.map(({ mesh }) => {
        expect(findMeshDefects(mesh)).toEqual([]);
        return measureMesh(mesh);
      });
      printed.forEach((measured, index) => {
        expect(measured.bounds.min[2]).toBe(0);
        if (index > 0) expect(measured.bounds.min[0] - (printed[index - 1]?.bounds.max[0] ?? 0)).toBeCloseTo(5, 4);
        expect(measured.volume / (model.solids[index]?.measurements.volume ?? Number.NaN)).toBeCloseTo(1, 6);
      });
      // The parts stay upright, translated only: as high and wide as in the model, not turned onto another face.
      for (const index of [0, 1]) {
        for (const axis of [0, 1, 2] as const) {
          expect(printed[index]?.size[axis]).toBeCloseTo(model.solids[index]?.measurements.size[axis] ?? Number.NaN, 4);
        }
      }
      expect(printed[0]?.size[2]).toBeCloseTo(model.size[2], 4);
      // Removable pins stand on an end face: 2e = 8 mm high, d and 0,8d wide, not lying along the normal as assembled.
      printed.slice(2).forEach((pin, index) => {
        expect(pin.size[2]).toBeCloseTo(8, 3);
        expect(pin.size[0]).toBeCloseTo([5, 4][index] ?? Number.NaN, 3);
        expect(pin.size[1]).toBeCloseTo([5, 4][index] ?? Number.NaN, 3);
      });
    },
  );

  it('separates a smooth cut, plugs and dowels along the normal, moving part 2 only', async () => {
    const smooth = await buildModelArtifacts(kernel, vertical(right));
    expect(await translations(smooth.separatedPreviewGlb as Uint8Array)).toEqual({
      // +Y, the plane's normal, is glTF −Z; by 0,15 × 80 mm.
      'cylinder-part-1': [0, 0, 0],
      'cylinder-part-2': [0, 0, expect.closeTo(-0.012, 6)],
    });
    const dowels = await buildModelArtifacts(kernel, vertical(right, dowel(2)));
    expect(await translations(dowels.separatedPreviewGlb as Uint8Array)).toEqual({
      'cylinder-part-1': [0, 0, 0],
      'cylinder-part-2': [0, 0, expect.closeTo(-0.04, 6)],
      'cylinder-dowel-1': [0, 0, 0],
      'cylinder-dowel-2': [0, 0, 0],
    });
  });

  it.each([
    ['a right cylinder', right],
    ['an oblique cylinder', oblique],
  ] as const)('lifts part 1, with the tongue, off the groove of %s, and holds part 2 still', async (_, shape) => {
    const { model, separatedPreviewGlb, previewGlb } = await buildModelArtifacts(kernel, vertical(shape, dovetail));
    const plan = model.section?.connector;
    if (plan?.type !== 'dovetail') throw new Error('Expected a dovetail');
    const lift = plan.exitDistance + SECTION_PREVIEW_GAP_RELATIVE * 80;
    // Up in Z is glTF +Y, by the distance that takes the tongue beyond part 2, and the gap.
    expect(await translations(separatedPreviewGlb as Uint8Array)).toEqual({
      'cylinder-part-1': [0, expect.closeTo(lift / 1000, 6), 0],
      'cylinder-part-2': [0, 0, 0],
    });
    expect(await translations(previewGlb)).toEqual({ 'cylinder-part-1': [0, 0, 0], 'cylinder-part-2': [0, 0, 0] });
    // The seated tongue's lowest end clears the whole of part 2 at that height.
    const tongueBottom = plan.frame.origin[2] - plan.length / 2;
    expect(tongueBottom + lift).toBeGreaterThan(model.size[2]);
  });

  it('keeps the separation out of the geometry and the print file', async () => {
    for (const connector of [undefined, plug(2), dowel(2), dovetail]) {
      const first = await buildModelArtifacts(kernel, vertical(right, connector));
      const second = await buildModelArtifacts(kernel, vertical(right, connector));
      expect(first.printFile.bytes).toEqual(second.printFile.bytes);
      // Each preview draws the same meshes, whether the parts are apart or together.
      const positionsOf = async (glb: Uint8Array) =>
        (await new WebIO().readBinary(glb))
          .getRoot()
          .listMeshes()
          .map((mesh) => Array.from(mesh.listPrimitives()[0]?.getAttribute('POSITION')?.getArray() ?? []));
      expect(await positionsOf(first.separatedPreviewGlb as Uint8Array)).toEqual(await positionsOf(first.previewGlb));
    }
  });

  it('raises part 2 further for a long plug, from the generated parts', async () => {
    const { model } = await buildModelArtifacts(kernel, vertical(right, { ...plug(1), depthFactor: 2 }));
    expect(previewSeparation(model)).toBeCloseTo(40, 6);
    const long = await buildModelArtifacts(kernel, {
      ...vertical(right, { ...plug(1), depthFactor: 7 }),
      section: { type: 'vertical', offsetPercent: -25, connector: { ...plug(1), depthFactor: 7 } as never },
    });
    // 28 mm above the cut, plus the flat cut's 0,15 × 80 = 12 mm gap.
    expect(previewSeparation(long.model)).toBeCloseTo(28 + 12, 3);
    const longer = await buildModelArtifacts(kernel, {
      ...vertical(right, { ...plug(1), depthFactor: 8 }),
      section: { type: 'vertical', offsetPercent: -25, connector: { ...plug(1), depthFactor: 8 } as never },
    });
    expect(previewSeparation(longer.model)).toBeCloseTo(32 + 12, 3);
  });
});
