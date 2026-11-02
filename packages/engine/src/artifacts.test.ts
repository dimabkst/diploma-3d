import { defaultModelSpecs, type ModelSpec } from '@diploma-3d/schema';
import { type Accessor, WebIO } from '@gltf-transform/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import { InvalidModelSpecError } from './errors.ts';
import { toGltfPosition } from './export/glb.ts';
import { readThreeMf } from './export/three-mf.test-helper.ts';
import { type GeometryKernel, loadGeometryKernel } from './kernel.ts';
import { cross, dot, findMeshDefects, measureMesh, triangleAt, triangleCount, type Vec3, vertexAt } from './mesh.ts';

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
    ['prism', 'prism-3-sided.3mf'],
    ['pyramid', 'pyramid-4-sided.3mf'],
    ['tetrahedron', 'tetrahedron.3mf'],
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

  describe('for a hexagonal pyramid with h/a = 2', () => {
    // The hexagon is two edges wide and h = 2a, so a = 40 mm and h = 80 mm.
    const spec: ModelSpec = { shape: { kind: 'pyramid', baseSides: 6, heightRatio: 2 }, scale: { longestDimensionMm: 80 } };
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
    const spec: ModelSpec = { shape: { kind: 'prism', baseSides: 6, heightRatio: 0.5 }, scale: { longestDimensionMm: 80 } };
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
    ['cuboid', { shape: { kind: 'cuboid', widthRatio: 5, heightRatio: 2 }, scale: { longestDimensionMm: 80 } }],
    ['prism', { shape: { kind: 'prism', baseSides: 9, heightRatio: 2 }, scale: { longestDimensionMm: 80 } }],
    ['pyramid', { shape: { kind: 'pyramid', baseSides: 9, heightRatio: 1 }, scale: { longestDimensionMm: 80 } }],
    ['tetrahedron', { shape: { kind: 'tetrahedron', heightRatio: 1 }, scale: { longestDimensionMm: 80 } }],
  ] as const)('produces no %s artifacts for invalid input', async (_, invalid) => {
    await expect(buildModelArtifacts(kernel, invalid as unknown as ModelSpec)).rejects.toBeInstanceOf(InvalidModelSpecError);
  });
});
