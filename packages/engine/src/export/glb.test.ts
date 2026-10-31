import { defaultModelSpecs } from '@diploma-3d/schema';
import { type Accessor, type Document, type Primitive, WebIO } from '@gltf-transform/core';
import { strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { GeometryError } from '../errors.ts';
import { loadGeometryKernel } from '../kernel.ts';
import { cross, dot, subtract, type TriangleMesh, triangleAt, triangleCount, type Vec3, vertexAt } from '../mesh.ts';
import { generateModel } from '../model.ts';
import { rightTetrahedron } from '../test-fixtures.ts';
import { createPreviewGlb, toGltfPosition } from './glb.ts';

const TRIANGLES = 4;
const LINES = 1;

async function readPrimitives(
  glb: Uint8Array,
): Promise<{ document: Document; surface: Primitive; edges: Primitive | undefined }> {
  const document = await new WebIO().readBinary(glb);
  const [mesh] = document.getRoot().listMeshes();
  const primitives = mesh?.listPrimitives() ?? [];
  const surface = primitives.find((primitive) => primitive.getMode() === TRIANGLES);
  if (surface === undefined) throw new Error('No triangle primitive');
  return { document, surface, edges: primitives.find((primitive) => primitive.getMode() === LINES) };
}

const vectors = (accessor: Accessor | null): Vec3[] =>
  Array.from({ length: accessor?.getCount() ?? 0 }, (_, index) => accessor?.getElement(index, []) as unknown as Vec3);

/** JSON chunk of a GLB: 12-byte header, then chunk length, chunk type and the JSON text. */
function glbJson(glb: Uint8Array): { accessors: { min?: number[]; max?: number[] }[] } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(strFromU8(glb.subarray(20, 20 + jsonLength)));
}

// Float32 metres resolve about 1e-9 m at this size; 7 digits (±5e-8 m = 0.05 µm) still exposes any unit or axis error.
const METRE_DIGITS = 7;

const expectVectorClose = (actual: Vec3 | undefined, expected: Vec3) => {
  expected.forEach((component, axis) => {
    expect(actual?.[axis]).toBeCloseTo(component, METRE_DIGITS);
  });
};

describe('toGltfPosition', () => {
  it('maps Z-up millimetres to Y-up metres: +X stays, +Z becomes +Y, +Y becomes −Z', () => {
    expect(toGltfPosition([10, 0, 0])).toEqual([0.01, 0, -0]);
    expect(toGltfPosition([0, 20, 0])).toEqual([0, 0, -0.02]);
    expect(toGltfPosition([0, 0, 30])).toEqual([0, 0.03, -0]);
  });
});

describe('createPreviewGlb', () => {
  const tetrahedron = rightTetrahedron(10, 20, 30);

  it('converts every vertex of an asymmetric mesh with the axis and unit mapping', async () => {
    const { surface } = await readPrimitives(await createPreviewGlb([{ name: 'tetrahedron', mesh: tetrahedron }]));
    const positions = vectors(surface.getAttribute('POSITION'));

    expect(positions).toHaveLength(triangleCount(tetrahedron) * 3);
    for (let triangle = 0; triangle < triangleCount(tetrahedron); triangle += 1) {
      triangleAt(tetrahedron, triangle).forEach((vertex, corner) => {
        expectVectorClose(positions[triangle * 3 + corner], toGltfPosition(vertexAt(tetrahedron, vertex)));
      });
    }
  });

  it('writes POSITION bounds in metres with the 30 mm Z leg as the glTF up axis', async () => {
    const glb = await createPreviewGlb([{ name: 'tetrahedron', mesh: tetrahedron }]);
    const { document, surface } = await readPrimitives(glb);
    const positionIndex = document
      .getRoot()
      .listAccessors()
      .indexOf(surface.getAttribute('POSITION') as Accessor);
    expect(positionIndex).toBeGreaterThanOrEqual(0);
    const accessor = glbJson(glb).accessors[positionIndex];

    expectVectorClose(accessor?.min as unknown as Vec3, [0, 0, -0.02]);
    expectVectorClose(accessor?.max as unknown as Vec3, [0.01, 0.03, 0]);
  });

  it('preserves outward winding and writes matching outward unit normals', async () => {
    const { surface } = await readPrimitives(await createPreviewGlb([{ name: 'tetrahedron', mesh: tetrahedron }]));
    const positions = vectors(surface.getAttribute('POSITION'));
    const normals = vectors(surface.getAttribute('NORMAL'));
    const centroid = toGltfPosition([2.5, 5, 7.5]);

    let sixfoldVolume = 0;
    for (let corner = 0; corner < positions.length; corner += 3) {
      const [a, b, c] = positions.slice(corner, corner + 3) as [Vec3, Vec3, Vec3];
      sixfoldVolume += dot(a, cross(b, c));
      const faceNormal = cross(subtract(b, a), subtract(c, a));
      const normal = normals[corner] as Vec3;
      expect(Math.hypot(...normal)).toBeCloseTo(1, 6);
      expect(dot(normal, faceNormal)).toBeGreaterThan(0);
      expect(dot(normal, subtract(a, centroid))).toBeGreaterThan(0);
    }
    const expectedVolume = (10 * 20 * 30) / 6 / 1e9;
    expect(Math.abs(sixfoldVolume / 6 / expectedVolume - 1)).toBeLessThan(1e-6);
  });

  it('outlines the twelve cube edges, slightly outside the surface, but not the face diagonals', async () => {
    const kernel = await loadGeometryKernel();
    const cubeMesh = generateModel(kernel, defaultModelSpecs.cube).solids[0]?.mesh as TriangleMesh;
    const { edges } = await readPrimitives(await createPreviewGlb([{ name: 'cube', mesh: cubeMesh }]));
    const endpoints = vectors(edges?.getAttribute('POSITION') ?? null);
    const corners = Array.from({ length: cubeMesh.positions.length / 3 }, (_, vertex) =>
      toGltfPosition(vertexAt(cubeMesh, vertex)),
    );
    const distanceToNearestCorner = (point: Vec3) => Math.min(...corners.map((corner) => Math.hypot(...subtract(point, corner))));

    expect(endpoints).toHaveLength(24);
    for (let index = 0; index < endpoints.length; index += 2) {
      const delta = subtract(endpoints[index + 1] as Vec3, endpoints[index] as Vec3).map(Math.abs);
      expect(delta.filter((component) => component > 1e-9)).toHaveLength(1);
      expect(Math.max(...delta)).toBeCloseTo(0.08, METRE_DIGITS);
    }
    for (const endpoint of endpoints) {
      const distance = distanceToNearestCorner(endpoint);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(0.0003);
    }
  });

  it('refuses an empty preview and invalid meshes', async () => {
    await expect(createPreviewGlb([])).rejects.toBeInstanceOf(GeometryError);
    const open = { positions: tetrahedron.positions, triangles: Uint32Array.of(0, 2, 1) };
    await expect(createPreviewGlb([{ name: 'open', mesh: open }])).rejects.toThrow(/open-edge/);
  });
});
