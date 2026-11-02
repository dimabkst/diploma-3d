import { Document, type GLTF, WebIO } from '@gltf-transform/core';
import { GeometryError } from '../errors.ts';
import {
  assertValidSolidMesh,
  cross,
  dot,
  length,
  measureMesh,
  subtract,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
} from '../mesh.ts';

export interface PreviewObject {
  readonly name: string;
  /** Millimetres, Z up. */
  readonly mesh: TriangleMesh;
  /**
   * Shade faces that meet at less than the feature-edge angle smoothly, as for the facets of a curved surface. Positions
   * stay the exported ones; only the display normals change. Polyhedra keep flat faces.
   */
  readonly smoothShading?: boolean;
}

export const GLB_MEDIA_TYPE = 'model/gltf-binary';

const METRES_PER_MILLIMETRE = 0.001;

// glTF primitive modes; Primitive.Mode is typed as a string record and would need non-null assertions.
const LINES: GLTF.MeshPrimitiveMode = 1;
const TRIANGLES: GLTF.MeshPrimitiveMode = 4;

// Linear RGB. A mid-tone matte surface keeps differently lit faces apart and stands out from the near-black background.
const SURFACE_COLOR = [0.2, 0.27, 0.4, 1] as const;
const EDGE_COLOR = [0.9, 0.92, 0.95, 1] as const;

// On a smoothly shaded solid, edges between faces meeting at a smaller angle are tessellation edges of a curved surface.
// Smooth shading blends exactly these faces, so outlined edges such as a cylinder's rims stay sharp.
const FEATURE_EDGE_MIN_ANGLE_DEG = 30;
const FEATURE_EDGE_MIN_COSINE = Math.cos((FEATURE_EDGE_MIN_ANGLE_DEG * Math.PI) / 180);

// A polyhedron's faces are planar, so every edge between non-coplanar triangles is a real edge, however flat: the lateral
// faces of a parallelepiped with α = 165° meet at 15°, those of a low octagonal pyramid at about 9°. Only the rounding
// noise between triangles of one face, far below this angle, is excluded.
const POLYHEDRON_EDGE_MIN_ANGLE_DEG = 1;
const POLYHEDRON_EDGE_MIN_COSINE = Math.cos((POLYHEDRON_EDGE_MIN_ANGLE_DEG * Math.PI) / 180);

// Lines exactly on the surface z-fight with it; running them this fraction of the bounding-box diagonal outside the
// adjacent faces keeps them visible without visibly detaching them from the solid.
export const EDGE_LIFT_RELATIVE = 0.002;

// At a sharp apex the point a full lift outside every face lies far beyond the tip. Longer offsets are shortened to
// this multiple of the lift; shortening keeps them outside every face, only closer to it.
const MAX_VERTEX_OFFSET_IN_LIFTS = 3;

/**
 * glTF is Y-up and in metres. Rotating −90° about X maps (x, y, z) to (x, z, −y); as a proper rotation it keeps the
 * triangle winding, so outward faces stay counter-clockwise.
 */
export function toGltfPosition([x, y, z]: Vec3): Vec3 {
  return [x * METRES_PER_MILLIMETRE, z * METRES_PER_MILLIMETRE, -y * METRES_PER_MILLIMETRE];
}

const toGltfDirection = ([x, y, z]: Vec3): Vec3 => [x, z, -y];

/** Builds a shaded preview with outlined feature edges from the same meshes that are exported for printing. */
export async function createPreviewGlb(objects: readonly PreviewObject[]): Promise<Uint8Array<ArrayBuffer>> {
  if (objects.length === 0) {
    throw new GeometryError('A preview needs at least one object.');
  }

  const document = new Document();
  document.getRoot().getAsset().generator = 'diploma-3d engine';
  const buffer = document.createBuffer();
  const scene = document.createScene('preview');
  const surfaceMaterial = document
    .createMaterial('surface')
    .setBaseColorFactor([...SURFACE_COLOR])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.75);
  const edgeMaterial = document.createMaterial('edges').setBaseColorFactor([...EDGE_COLOR]);

  for (const object of objects) {
    assertValidSolidMesh(object.mesh);
    const smooth = object.smoothShading ?? false;
    const { positions, normals } = shadedTriangles(object.mesh, smooth);
    const surface = document
      .createPrimitive()
      .setMode(TRIANGLES)
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
      .setMaterial(surfaceMaterial);
    const mesh = document.createMesh(object.name).addPrimitive(surface);

    const edgePositions = featureEdgeSegments(object.mesh, smooth ? FEATURE_EDGE_MIN_COSINE : POLYHEDRON_EDGE_MIN_COSINE);
    if (edgePositions.length > 0) {
      mesh.addPrimitive(
        document
          .createPrimitive()
          .setMode(LINES)
          .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(edgePositions).setBuffer(buffer))
          .setMaterial(edgeMaterial),
      );
    }
    scene.addChild(document.createNode(object.name).setMesh(mesh));
  }

  // glTF-Transform allocates a regular ArrayBuffer; its typings predate the ArrayBuffer type parameter.
  return (await new WebIO().writeBinary(document)) as Uint8Array<ArrayBuffer>;
}

/**
 * Unshared vertices per triangle, so that each corner has its own normal. Flat shading uses the face normal. Smooth
 * shading averages, weighted by their angles at the vertex, the normals of the faces around the vertex that lie within
 * the feature-edge angle of this face: the facets of a curved side blend, while a rim between the side and a flat cap
 * stays sharp. At a cone's apex each side triangle thus gets a normal close to its own instead of the axis direction.
 */
function shadedTriangles(
  mesh: TriangleMesh,
  smooth: boolean,
): { positions: Float32Array<ArrayBuffer>; normals: Float32Array<ArrayBuffer> } {
  const faceNormals = Array.from({ length: triangleCount(mesh) }, (_, triangle) => unitNormal(mesh, triangle));
  const cornersOfVertex = new Map<number, { triangle: number; angle: number }[]>();
  if (smooth) {
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const corners = triangleAt(mesh, triangle);
      corners.forEach((vertex, corner) => {
        const at = vertexAt(mesh, vertex);
        const toNext = subtract(vertexAt(mesh, corners[(corner + 1) % 3] as number), at);
        const toPrevious = subtract(vertexAt(mesh, corners[(corner + 2) % 3] as number), at);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(toNext, toPrevious) / (length(toNext) * length(toPrevious)))));
        const list = cornersOfVertex.get(vertex) ?? [];
        list.push({ triangle, angle });
        cornersOfVertex.set(vertex, list);
      });
    }
  }

  const positions = new Float32Array(triangleCount(mesh) * 9);
  const normals = new Float32Array(triangleCount(mesh) * 9);
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const faceNormal = faceNormals[triangle] as Vec3;
    triangleAt(mesh, triangle).forEach((vertex, corner) => {
      let normal = faceNormal;
      if (smooth) {
        let sum: Vec3 = [0, 0, 0];
        for (const neighbour of cornersOfVertex.get(vertex) ?? []) {
          const neighbourNormal = faceNormals[neighbour.triangle] as Vec3;
          if (dot(neighbourNormal, faceNormal) >= FEATURE_EDGE_MIN_COSINE)
            sum = add(sum, scale(neighbourNormal, neighbour.angle));
        }
        normal = scale(sum, 1 / length(sum));
      }
      const offset = triangle * 9 + corner * 3;
      positions.set(toGltfPosition(vertexAt(mesh, vertex)), offset);
      normals.set(toGltfDirection(normal), offset);
    });
  }
  return { positions, normals };
}

/**
 * Feature edges, lifted off the surface. Each vertex gets one offset shared by all its edges, so that the lines stay
 * connected at corners; offsetting every edge along its own normal bisector would leave gaps there.
 */
function featureEdgeSegments(mesh: TriangleMesh, minCosine: number): Float32Array<ArrayBuffer> {
  const firstTriangleOfEdge = new Map<string, number>();
  const edges: [number, number][] = [];
  const adjacentNormals = new Map<number, Vec3[]>();

  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle);
    for (let corner = 0; corner < 3; corner += 1) {
      const from = corners[corner] as number;
      const to = corners[(corner + 1) % 3] as number;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const neighbour = firstTriangleOfEdge.get(key);
      if (neighbour === undefined) {
        firstTriangleOfEdge.set(key, triangle);
      } else if (dot(unitNormal(mesh, triangle), unitNormal(mesh, neighbour)) < minCosine) {
        edges.push([from, to]);
        for (const vertex of [from, to]) {
          const normals = adjacentNormals.get(vertex) ?? [];
          normals.push(unitNormal(mesh, triangle), unitNormal(mesh, neighbour));
          adjacentNormals.set(vertex, normals);
        }
      }
    }
  }

  const lift = EDGE_LIFT_RELATIVE * length(measureMesh(mesh).size);
  const liftedPoints = new Map(
    [...adjacentNormals].map(([vertex, normals]) => [
      vertex,
      toGltfPosition(add(vertexAt(mesh, vertex), vertexOffset(normals, lift))),
    ]),
  );
  return Float32Array.from(edges.flatMap(([from, to]) => [...(liftedPoints.get(from) ?? []), ...(liftedPoints.get(to) ?? [])]));
}

/**
 * The offset o that puts a vertex `lift` outside the plane of every given face: n·o = lift for each unit normal n.
 * This is exact for up to three independent planes, such as at a box corner (o = lift·(±1, ±1, ±1)) or along a straight
 * edge, and a least-squares compromise where more faces meet. The solution of the regularised normal equations
 * (NᵀN + εI) o = Nᵀ·lift tends to the shortest such offset when the planes leave a direction free.
 */
function vertexOffset(normals: readonly Vec3[], lift: number): Vec3 {
  const epsilon = 1e-6 * normals.length;
  const rows: [Vec3, Vec3, Vec3] = [
    [epsilon, 0, 0],
    [0, epsilon, 0],
    [0, 0, epsilon],
  ];
  let target: Vec3 = [0, 0, 0];
  for (const normal of normals) {
    rows.forEach((row, index) => {
      rows[index] = add(row, scale(normal, normal[index] as number));
    });
    target = add(target, scale(normal, lift));
  }
  // Cramer's rule for the symmetric 3 × 3 system: the inverse's columns are the cross products of row pairs.
  const [r0, r1, r2] = rows;
  const offset = scale(
    add(add(scale(cross(r1, r2), target[0]), scale(cross(r2, r0), target[1])), scale(cross(r0, r1), target[2])),
    1 / dot(r0, cross(r1, r2)),
  );
  const offsetLength = length(offset);
  const maximum = MAX_VERTEX_OFFSET_IN_LIFTS * lift;
  return offsetLength > maximum ? scale(offset, maximum / offsetLength) : offset;
}

function unitNormal(mesh: TriangleMesh, triangle: number): Vec3 {
  const areaVector = triangleAreaVector(mesh, triangle);
  return scale(areaVector, 1 / length(areaVector));
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
