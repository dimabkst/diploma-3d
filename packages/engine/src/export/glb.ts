import { Document, type GLTF, WebIO } from '@gltf-transform/core';
import { GeometryError } from '../errors.ts';
import {
  assertValidSolidMesh,
  dot,
  length,
  measureMesh,
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
}

export const GLB_MEDIA_TYPE = 'model/gltf-binary';

const METRES_PER_MILLIMETRE = 0.001;

// glTF primitive modes; Primitive.Mode is typed as a string record and would need non-null assertions.
const LINES: GLTF.MeshPrimitiveMode = 1;
const TRIANGLES: GLTF.MeshPrimitiveMode = 4;

// Linear RGB. A mid-tone matte surface keeps differently lit faces apart and stands out from the near-black background.
const SURFACE_COLOR = [0.2, 0.27, 0.4, 1] as const;
const EDGE_COLOR = [0.9, 0.92, 0.95, 1] as const;

// Edges between faces meeting at a smaller angle are tessellation edges of one face or of a curved surface.
const FEATURE_EDGE_MIN_ANGLE_DEG = 30;

// Lines exactly on the surface z-fight with it; lifting them along the bisector of the adjacent face normals by a small
// fraction of the bounding-box diagonal keeps them visible without visibly detaching them from the solid.
const EDGE_LIFT_RELATIVE = 0.002;

/**
 * glTF is Y-up and in metres. Rotating −90° about X maps (x, y, z) to (x, z, −y); as a proper rotation it keeps the
 * triangle winding, so outward faces stay counter-clockwise.
 */
export function toGltfPosition([x, y, z]: Vec3): Vec3 {
  return [x * METRES_PER_MILLIMETRE, z * METRES_PER_MILLIMETRE, -y * METRES_PER_MILLIMETRE];
}

const toGltfDirection = ([x, y, z]: Vec3): Vec3 => [x, z, -y];

/** Builds a flat-shaded preview with outlined feature edges from the same meshes that are exported for printing. */
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
    const { positions, normals } = flatShadedTriangles(object.mesh);
    const surface = document
      .createPrimitive()
      .setMode(TRIANGLES)
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
      .setMaterial(surfaceMaterial);
    const mesh = document.createMesh(object.name).addPrimitive(surface);

    const edgePositions = featureEdgeSegments(object.mesh);
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

/** Unshared vertices per triangle so that each planar face is lit uniformly. */
function flatShadedTriangles(mesh: TriangleMesh): { positions: Float32Array<ArrayBuffer>; normals: Float32Array<ArrayBuffer> } {
  const positions = new Float32Array(triangleCount(mesh) * 9);
  const normals = new Float32Array(triangleCount(mesh) * 9);
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const normal = toGltfDirection(unitNormal(mesh, triangle));
    triangleAt(mesh, triangle).forEach((vertex, corner) => {
      const offset = triangle * 9 + corner * 3;
      positions.set(toGltfPosition(vertexAt(mesh, vertex)), offset);
      normals.set(normal, offset);
    });
  }
  return { positions, normals };
}

function featureEdgeSegments(mesh: TriangleMesh): Float32Array<ArrayBuffer> {
  const firstTriangleOfEdge = new Map<string, number>();
  const segments: number[] = [];
  const minimumCosine = Math.cos((FEATURE_EDGE_MIN_ANGLE_DEG * Math.PI) / 180);
  const lift = EDGE_LIFT_RELATIVE * length(measureMesh(mesh).size);

  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle);
    for (let corner = 0; corner < 3; corner += 1) {
      const from = corners[corner] as number;
      const to = corners[(corner + 1) % 3] as number;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const neighbour = firstTriangleOfEdge.get(key);
      if (neighbour === undefined) {
        firstTriangleOfEdge.set(key, triangle);
      } else if (dot(unitNormal(mesh, triangle), unitNormal(mesh, neighbour)) < minimumCosine) {
        const bisector = add(unitNormal(mesh, triangle), unitNormal(mesh, neighbour));
        const offset = scale(bisector, lift / length(bisector));
        segments.push(...toGltfPosition(add(vertexAt(mesh, from), offset)), ...toGltfPosition(add(vertexAt(mesh, to), offset)));
      }
    }
  }
  return Float32Array.from(segments);
}

function unitNormal(mesh: TriangleMesh, triangle: number): Vec3 {
  const areaVector = triangleAreaVector(mesh, triangle);
  return scale(areaVector, 1 / length(areaVector));
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
