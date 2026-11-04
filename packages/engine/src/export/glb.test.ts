import { defaultModelSpecs, type ModelSpecInput } from '@diploma-3d/schema';
import { type Accessor, type Document, type Primitive, WebIO } from '@gltf-transform/core';
import { strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { GeometryError } from '../errors.ts';
import { loadGeometryKernel } from '../kernel.ts';
import { cross, dot, subtract, type TriangleMesh, triangleAt, triangleCount, type Vec3, vertexAt } from '../mesh.ts';
import { generateModel } from '../model.ts';
import { regularPolyhedronMeasurements } from '../shapes/regular-polyhedron.ts';
import { rightTetrahedron } from '../test-fixtures.ts';
import { createPreviewGlb, EDGE_LIFT_RELATIVE, toGltfPosition } from './glb.ts';

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

  it('outlines the twelve cube edges, connected at the corners just outside the surface, but not the face diagonals', async () => {
    const kernel = await loadGeometryKernel();
    const cubeMesh = generateModel(kernel, defaultModelSpecs.cube).solids[0]?.mesh as TriangleMesh;
    const { edges } = await readPrimitives(await createPreviewGlb([{ name: 'cube', mesh: cubeMesh }]));
    const endpoints = vectors(edges?.getAttribute('POSITION') ?? null);
    // 0,2 % of the 80√3 mm diagonal, in metres.
    const lift = (EDGE_LIFT_RELATIVE * 80 * Math.sqrt(3)) / 1000;
    const centre = toGltfPosition([0, 0, 40]);
    const corners = Array.from({ length: cubeMesh.positions.length / 3 }, (_, vertex) =>
      toGltfPosition(vertexAt(cubeMesh, vertex)),
    );

    expect(endpoints).toHaveLength(24);
    for (let index = 0; index < endpoints.length; index += 2) {
      const delta = subtract(endpoints[index + 1] as Vec3, endpoints[index] as Vec3).map(Math.abs);
      expect(delta.filter((component) => component > 1e-9)).toHaveLength(1);
      expect(Math.max(...delta)).toBeCloseTo(0.08 + 2 * lift, METRE_DIGITS);
    }
    // Every corner has a single lifted point, lift outside each of its three faces, shared by its three edges.
    for (const corner of corners) {
      const [dx, dy, dz] = subtract(corner, centre);
      const lifted: Vec3 = [corner[0] + lift * Math.sign(dx), corner[1] + lift * Math.sign(dy), corner[2] + lift * Math.sign(dz)];
      const matches = endpoints.filter((endpoint) => Math.hypot(...subtract(endpoint, lifted)) < 1e-8);
      expect(matches).toHaveLength(3);
    }
  });

  it('lifts every edge of a slanted solid the same distance off both adjacent faces and joins them at the vertices', async () => {
    const { edges } = await readPrimitives(await createPreviewGlb([{ name: 'tetrahedron', mesh: tetrahedron }]));
    // Back to Z-up millimetres: glTF (x, y, z) in metres is (x, −z, y) × 1000.
    const endpoints = vectors(edges?.getAttribute('POSITION') ?? null).map(([x, y, z]): Vec3 => [x * 1000, -z * 1000, y * 1000]);
    const lift = EDGE_LIFT_RELATIVE * Math.hypot(10, 20, 30);
    const vertices = Array.from({ length: 4 }, (_, vertex) => vertexAt(tetrahedron, vertex));
    const nearestVertex = (point: Vec3) =>
      vertices.reduce(
        (best, vertex, index) =>
          Math.hypot(...subtract(point, vertex)) < Math.hypot(...subtract(point, vertices[best] as Vec3)) ? index : best,
        0,
      );

    // All six edges of the tetrahedron are feature edges; three of them end at each lifted vertex.
    expect(endpoints).toHaveLength(12);
    const liftedVertices = new Map<number, Vec3>();
    for (const endpoint of endpoints) {
      const vertex = nearestVertex(endpoint);
      const known = liftedVertices.get(vertex) ?? endpoint;
      expect(Math.hypot(...subtract(endpoint, known))).toBeLessThan(1e-5);
      liftedVertices.set(vertex, known);
    }
    expect(liftedVertices.size).toBe(4);

    // A lifted vertex lies the same distance outside each face meeting there. Putting the vertices at (0, 20, 0) and
    // (0, 0, 30) a full lift outside the slanted face (unit normal (6, 3, 2) / 7) and both coordinate planes would need
    // offsets of √27 and √66 lifts, so they are shortened to the 3-lift cap, which scales those distances by
    // 3/√27 and 3/√66. The right-angle vertex (√3 lifts) and the vertex (10, 0, 0) (√6 lifts) are exact.
    const expectedDistances = [1, 1, 3 / Math.sqrt(27), 3 / Math.sqrt(66)].map((share) => share * lift);
    for (let triangle = 0; triangle < triangleCount(tetrahedron); triangle += 1) {
      const corners = triangleAt(tetrahedron, triangle);
      const [a, b, c] = corners.map((vertex) => vertexAt(tetrahedron, vertex)) as [Vec3, Vec3, Vec3];
      const normal = cross(subtract(b, a), subtract(c, a));
      const unit = normal.map((component) => component / Math.hypot(...normal)) as unknown as Vec3;
      for (const vertex of corners) {
        expect(dot(unit, subtract(liftedVertices.get(vertex) as Vec3, a))).toBeCloseTo(expectedDistances[vertex] as number, 5);
      }
    }
  });

  it('refuses an empty preview and invalid meshes', async () => {
    await expect(createPreviewGlb([])).rejects.toBeInstanceOf(GeometryError);
    const open = { positions: tetrahedron.positions, triangles: Uint32Array.of(0, 2, 1) };
    await expect(createPreviewGlb([{ name: 'open', mesh: open }])).rejects.toThrow(/open-edge/);
  });
});

describe('createPreviewGlb shading', () => {
  async function shadedCorners(spec: ModelSpecInput, smoothShading?: boolean) {
    const kernel = await loadGeometryKernel();
    const solid = generateModel(kernel, spec).solids[0];
    if (solid === undefined) throw new Error('No solid');
    const object = smoothShading === undefined ? solid : { ...solid, smoothShading };
    const { surface, edges } = await readPrimitives(await createPreviewGlb([object]));
    const positions = vectors(surface.getAttribute('POSITION'));
    const normals = vectors(surface.getAttribute('NORMAL'));
    const faces = Array.from({ length: positions.length / 3 }, (_, triangle) => {
      const [a, b, c] = positions.slice(triangle * 3, triangle * 3 + 3) as [Vec3, Vec3, Vec3];
      const n = cross(subtract(b, a), subtract(c, a));
      return n.map((component) => component / Math.hypot(...n)) as unknown as Vec3;
    });
    return { positions, normals, faces, edgeSegments: vectors(edges?.getAttribute('POSITION') ?? null).length / 2 };
  }

  const cylinder: ModelSpecInput = { shape: { kind: 'cylinder', heightRatio: 2 }, scale: { longestDimensionMm: 80 } };
  const cone: ModelSpecInput = { shape: { kind: 'cone', heightRatio: 2 }, scale: { longestDimensionMm: 80 } };

  it('shades the cylinder side smoothly along the radius while caps stay flat and rims stay sharp', async () => {
    const { positions, normals, faces, edgeSegments } = await shadedCorners(cylinder);
    let sideCorners = 0;
    positions.forEach((position, corner) => {
      const normal = normals[corner] as Vec3;
      const face = faces[Math.floor(corner / 3)] as Vec3;
      expect(Math.hypot(...normal)).toBeCloseTo(1, 6);
      if (Math.abs(face[1]) > 0.999) {
        // Caps (glTF ±Y): exactly the cap normal, not tilted by the side.
        expect(normal[1]).toBeCloseTo(face[1], 6);
      } else {
        // Side: horizontal and along the radius through the vertex, unlike the facet normal.
        sideCorners += 1;
        expect(Math.abs(normal[1])).toBeLessThan(1e-6);
        const radial = [position[0], 0, position[2]] as Vec3;
        expect(dot(normal, radial) / Math.hypot(...radial)).toBeGreaterThan(0.99999);
      }
    });
    expect(sideCorners).toBe(64 * 2 * 3);
    // Only the two 64-segment rims are outlined, not the lines between side facets.
    expect(edgeSegments).toBe(128);
  });

  it('shades each cone side corner like its neighbourhood, so the apex does not take the axis direction', async () => {
    const { positions, normals, faces } = await shadedCorners(cone);
    const apexHeight = Math.max(...positions.map((position) => position[1]));
    positions.forEach((position, corner) => {
      const normal = normals[corner] as Vec3;
      const face = faces[Math.floor(corner / 3)] as Vec3;
      if (face[1] < -0.999) {
        expect(normal[1]).toBeCloseTo(-1, 6);
      } else {
        expect(dot(normal, face)).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
        if (position[1] === apexHeight) expect(normal[1]).toBeLessThan(0.9);
      }
    });
  });

  it('shades the whole ball smoothly, with radial normals and no outlined edges', async () => {
    const ball: ModelSpecInput = { shape: { kind: 'ball' }, scale: { longestDimensionMm: 80 } };
    const { positions, normals, faces, edgeSegments } = await shadedCorners(ball);
    // The centre (0, 0, 40) mm lies at (0, 0,04, 0) m in glTF.
    let closerThanFacet = 0;
    positions.forEach((position, corner) => {
      const radial = subtract(position, [0, 0.04, 0]);
      const unitRadial = radial.map((component) => component / Math.hypot(...radial)) as unknown as Vec3;
      const normal = normals[corner] as Vec3;
      expect(dot(normal, unitRadial)).toBeGreaterThan(0.9999);
      if (dot(faces[Math.floor(corner / 3)] as Vec3, unitRadial) < dot(normal, unitRadial)) closerThanFacet += 1;
    });
    // The smoothed normals follow the sphere more closely than the facet normals at almost every corner.
    expect(closerThanFacet / positions.length).toBeGreaterThan(0.99);
    expect(edgeSegments).toBe(0);
  });

  it.each([
    // Lateral faces meeting at 15° along the edges at the obtuse base angles, and at 165° at the acute ones.
    ['a parallelepiped with α = 165°', { kind: 'parallelepiped', baseSideRatio: 1, heightRatio: 1, baseAngleDeg: 165 }, 12],
    ['a parallelepiped with α = 15°', { kind: 'parallelepiped', baseSideRatio: 4, heightRatio: 0.25, baseAngleDeg: 15 }, 12],
    // Adjacent lateral faces meet at about 9°: 8 base edges and 8 lateral edges.
    ['a low octagonal pyramid', { kind: 'pyramid', baseSides: 8, heightRatio: 0.25 }, 16],
  ])('outlines every edge of %s, also between faces meeting at a small angle, but no face diagonal', async (_, shape, count) => {
    const { edgeSegments } = await shadedCorners({ shape, scale: { longestDimensionMm: 80 } } as ModelSpecInput);
    expect(edgeSegments).toBe(count);
  });

  it('gives an oblique prism the normals of its sheared faces, not those of the right prism', async () => {
    // Square base, h = a, upper base moved by a along X: the faces through the base edges along Y lean by 45°, with
    // outward normals (±1, 0, ∓1)/√2 in Z-up, that is (±1, ∓1, 0)/√2 in glTF.
    const spec: ModelSpecInput = {
      shape: { kind: 'prism', baseSides: 4, heightRatio: 1, offsetXRatio: 1, offsetYRatio: 0 },
      scale: { longestDimensionMm: 80 },
    };
    const { normals, faces, edgeSegments } = await shadedCorners(spec);
    normals.forEach((normal, corner) => {
      expect(dot(normal, faces[Math.floor(corner / 3)] as Vec3)).toBeGreaterThan(1 - 1e-6);
    });
    const leaning = normals.filter((normal) => Math.abs(Math.abs(normal[0]) - Math.SQRT1_2) < 1e-6);
    expect(leaning).toHaveLength(2 * 2 * 3);
    for (const normal of leaning) expect(normal[1]).toBeCloseTo(-normal[0], 6);
    expect(edgeSegments).toBe(12);
  });

  it.each([
    ['a leaning cylinder', { kind: 'cylinder', heightRatio: 1, offsetRatio: 1 }],
    ['a strongly leaning cylinder', { kind: 'cylinder', heightRatio: 0.25, offsetRatio: 4 }],
  ] as const)('shades %s along the sheared surface normals, with flat caps and only the rims outlined', async (_, shape) => {
    const { positions, normals, faces, edgeSegments } = await shadedCorners({ shape, scale: { longestDimensionMm: 80 } });
    const k = shape.offsetRatio / shape.heightRatio;
    let sideCorners = 0;
    let shallowestSide = 0;
    positions.forEach((position, corner) => {
      const normal = normals[corner] as Vec3;
      const face = faces[Math.floor(corner / 3)] as Vec3;
      expect(Math.hypot(...normal)).toBeCloseTo(1, 6);
      // Every normal faces the same way as its triangle.
      expect(dot(normal, face)).toBeGreaterThan(0);
      if (Math.abs(face[1]) > 1 - 1e-9) {
        // Caps (glTF ±Y): exactly the cap normal.
        expect(normal[1]).toBeCloseTo(face[1], 9);
        return;
      }
      sideCorners += 1;
      if (face[1] < 0) shallowestSide = Math.max(shallowestSide, -face[1]);
      // Back to Z-up millimetres; before the shear the corner lies at the angle θ on the circle, and the surface normal
      // there, (cos θ, sin θ, 0) mapped by the inverse transpose of the shear, is (cos θ, sin θ, −k·cos θ).
      const [x, y, z] = [position[0] * 1000, -position[2] * 1000, position[1] * 1000];
      const theta = Math.atan2(y, x - k * z);
      const analytic: Vec3 = [Math.cos(theta), Math.sin(theta), -k * Math.cos(theta)];
      const gltf: Vec3 = [analytic[0], analytic[2], -analytic[1]];
      expect(dot(normal, gltf) / Math.hypot(...gltf)).toBeGreaterThan(0.99999);
    });
    expect(sideCorners).toBe(64 * 2 * 3);
    // Only the two 64-segment rims, even where the leaning side meets the base at well under 30°.
    expect(edgeSegments).toBe(128);
    if (k > 1) expect(shallowestSide).toBeGreaterThan(Math.cos((30 * Math.PI) / 180));
  });

  it('shades an oblique cone with its apex outside the base with finite normals and a sharp base rim', async () => {
    const shape = { kind: 'cone', heightRatio: 0.5, offsetRatio: 4 } as const;
    const { positions, normals, faces, edgeSegments } = await shadedCorners({ shape, scale: { longestDimensionMm: 80 } });
    const apexHeight = Math.max(...positions.map((position) => position[1]));
    let apexCorners = 0;
    positions.forEach((position, corner) => {
      const normal = normals[corner] as Vec3;
      const face = faces[Math.floor(corner / 3)] as Vec3;
      expect(normal.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...normal)).toBeCloseTo(1, 6);
      expect(dot(normal, face)).toBeGreaterThan(0);
      if (face[1] < -1 + 1e-9) expect(normal[1]).toBeCloseTo(-1, 9);
      if (position[1] === apexHeight) apexCorners += 1;
    });
    expect(apexCorners).toBe(64);
    expect(edgeSegments).toBe(64);
  });

  it('keeps exactly flat normals for polyhedra and when smooth shading is off', async () => {
    for (const [spec, smoothShading] of [
      [{ shape: { kind: 'prism', baseSides: 8, heightRatio: 0.25 }, scale: { longestDimensionMm: 80 } }, undefined],
      [{ shape: { kind: 'pyramid', baseSides: 8, heightRatio: 0.25 }, scale: { longestDimensionMm: 80 } }, undefined],
      [defaultModelSpecs.parallelepiped, undefined],
      [cylinder, false],
    ] as const) {
      const { normals, faces } = await shadedCorners(spec as ModelSpecInput, smoothShading);
      normals.forEach((normal, corner) => {
        expect(dot(normal, faces[Math.floor(corner / 3)] as Vec3)).toBeGreaterThan(1 - 1e-6);
      });
    }
  });

  it.each([
    ['octahedron', 8, 12],
    ['icosahedron', 20, 30],
    ['dodecahedron', 12, 30],
  ] as const)(
    'shades the %s with one normal per face and outlines its edges but no triangulation diagonals',
    async (kind, faceCount, edgeCount) => {
      const { normals, faces } = await shadedCorners(defaultModelSpecs[kind]);
      // Flat: every corner takes its triangle's normal.
      normals.forEach((normal, corner) => {
        expect(dot(normal, faces[Math.floor(corner / 3)] as Vec3)).toBeGreaterThan(1 - 1e-6);
      });
      // The triangles of one face, such as the three of a pentagon, share their normal up to float32 rounding, far below
      // a visible seam; distinct faces are at least the icosahedron's 41,8° apart. The sine of the angle, |n₁ × n₂|, stays
      // accurate for tiny angles, where acos(n₁·n₂) of float32 normals only resolves about 2e-4 rad.
      const faceNormals: Vec3[] = [];
      for (const normal of normals) {
        const same = faceNormals.find((candidate) => dot(candidate, normal) > Math.cos((1 * Math.PI) / 180));
        if (same === undefined) faceNormals.push(normal);
        else expect(Math.hypot(...cross(same, normal))).toBeLessThan(1e-5);
      }
      expect(faceNormals).toHaveLength(faceCount);

      const kernel = await loadGeometryKernel();
      const solid = generateModel(kernel, defaultModelSpecs[kind]).solids[0];
      if (solid === undefined) throw new Error('No solid');
      const { edges } = await readPrimitives(await createPreviewGlb([solid]));
      const endpoints = vectors(edges?.getAttribute('POSITION') ?? null);
      expect(endpoints).toHaveLength(2 * edgeCount);
      // Lifted alike at every vertex, all outlines have one length, close to the edge a and far from a diagonal φa.
      const edge = regularPolyhedronMeasurements(kind, defaultModelSpecs[kind].scale).edge / 1000;
      const lift = (EDGE_LIFT_RELATIVE * Math.hypot(...solid.measurements.size)) / 1000;
      const lengths = Array.from({ length: edgeCount }, (_, segment) =>
        Math.hypot(...subtract(endpoints[2 * segment + 1] as Vec3, endpoints[2 * segment] as Vec3)),
      );
      for (const value of lengths) {
        expect(value).toBeCloseTo(lengths[0] as number, METRE_DIGITS);
        expect(Math.abs(value - edge)).toBeLessThan(6 * lift);
      }
    },
  );
});
