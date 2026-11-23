import type { Manifold, Mesh } from 'manifold-3d';
import { GeometryError } from './errors.ts';

export type Vec3 = readonly [number, number, number];

/** Indexed triangle mesh in millimetres with Z up; triangles are counter-clockwise when viewed from outside. */
export interface TriangleMesh {
  /** x, y, z per vertex. */
  readonly positions: Float32Array;
  /** Three vertex indices per triangle. */
  readonly triangles: Uint32Array;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface MeshMeasurements {
  readonly bounds: Bounds;
  readonly size: Vec3;
  readonly volume: number;
  readonly surfaceArea: number;
}

export type MeshDefect =
  | 'empty'
  | 'malformed-buffers'
  | 'non-finite-vertex'
  | 'index-out-of-range'
  | 'degenerate-triangle'
  | 'open-edge'
  | 'inconsistent-orientation'
  | 'non-manifold-edge'
  | 'non-positive-volume';

// Relative to the squared bounding-box diagonal, so the check does not depend on the physical scale.
const DEGENERATE_AREA_TOLERANCE = 1e-12;

// A float32 coordinate rounds by half a unit in the last place, 2^-24 of its size; a few of those are no measurable height.
const ROUNDING_HEIGHT_RELATIVE = 4 * 2 ** -24;

/**
 * A triangle is degenerate when it is both tiny and flat, its height within the rounding of its coordinates: three points on
 * one line. A small triangle of good shape, such as the corner a plane cuts off just above a vertex of a fine mesh, is a face
 * like any other, however small against the whole solid.
 */
function degenerateTriangles(mesh: TriangleMesh): (triangle: number) => boolean {
  const { size, bounds } = measureMesh(mesh);
  const minimumDoubleArea = 2 * DEGENERATE_AREA_TOLERANCE * dot(size, size);
  const minimumHeight = ROUNDING_HEIGHT_RELATIVE * Math.max(...bounds.min.map(Math.abs), ...bounds.max.map(Math.abs));
  return (triangle) => {
    const doubleArea = length(triangleAreaVector(mesh, triangle));
    if (doubleArea > minimumDoubleArea) return false;
    const corners = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex));
    const longest = Math.max(...corners.map((corner, index) => length(subtract(corner, corners[(index + 1) % 3] as Vec3))));
    return longest === 0 || doubleArea / longest <= minimumHeight;
  };
}

export const vertexCount = (mesh: TriangleMesh): number => mesh.positions.length / 3;
export const triangleCount = (mesh: TriangleMesh): number => mesh.triangles.length / 3;

export function vertexAt(mesh: TriangleMesh, index: number): Vec3 {
  const { positions } = mesh;
  return [positions[index * 3] ?? Number.NaN, positions[index * 3 + 1] ?? Number.NaN, positions[index * 3 + 2] ?? Number.NaN];
}

export function triangleAt(mesh: TriangleMesh, index: number): Vec3 {
  const { triangles } = mesh;
  return [triangles[index * 3] ?? -1, triangles[index * 3 + 1] ?? -1, triangles[index * 3 + 2] ?? -1];
}

export const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** Twice the triangle area along the outward normal (right-hand rule). */
export function triangleAreaVector(mesh: TriangleMesh, triangle: number): Vec3 {
  const [a, b, c] = triangleAt(mesh, triangle);
  const origin = vertexAt(mesh, a);
  return cross(subtract(vertexAt(mesh, b), origin), subtract(vertexAt(mesh, c), origin));
}

/**
 * Copies a Manifold into an independent mesh with positions only. Manifold may split vertices along property seams;
 * its merge vectors map them back to one vertex per position, which keeps the topology closed.
 */
export function meshFromManifold(manifold: Manifold): TriangleMesh {
  return meshFromKernelMesh(manifold.getMesh());
}

/**
 * The mesh, and per triangle 1 where the face does not come from any of `originalIds`, the manifold-3d provenance IDs
 * of the solid before it was cut: faces made by the cut or by a connector. Booleans and transforms keep the ID of the
 * mesh each face came from, so this needs no geometric test.
 */
export function meshWithNewFaces(
  manifold: Manifold,
  originalIds: ReadonlySet<number>,
): { mesh: TriangleMesh; newFaces: Uint8Array } {
  const kernelMesh = manifold.getMesh();
  const newFaces = new Uint8Array(kernelMesh.triVerts.length / 3);
  const { runIndex, runOriginalID } = kernelMesh;
  for (let run = 0; run < runOriginalID.length; run += 1) {
    if (originalIds.has(runOriginalID[run] as number)) continue;
    // Run boundaries index triVerts, three entries per triangle.
    newFaces.fill(1, (runIndex[run] as number) / 3, (runIndex[run + 1] as number) / 3);
  }
  return { mesh: meshFromKernelMesh(kernelMesh), newFaces };
}

/** The provenance IDs of the solid's faces, see `meshWithNewFaces`. */
export const originalIdsOf = (manifold: Manifold): Set<number> => new Set(manifold.getMesh().runOriginalID);

function meshFromKernelMesh({ numProp, vertProperties, triVerts, mergeFromVert, mergeToVert }: Mesh): TriangleMesh {
  const sourceVertexCount = vertProperties.length / numProp;
  const canonical = new Uint32Array(sourceVertexCount);
  for (let vertex = 0; vertex < sourceVertexCount; vertex += 1) {
    canonical[vertex] = vertex;
  }
  for (let index = 0; index < (mergeFromVert?.length ?? 0); index += 1) {
    canonical[mergeFromVert[index] as number] = mergeToVert[index] as number;
  }

  const compactIndex = new Int32Array(sourceVertexCount).fill(-1);
  const positions: number[] = [];
  const triangles = new Uint32Array(triVerts.length);
  for (let corner = 0; corner < triVerts.length; corner += 1) {
    const vertex = canonical[triVerts[corner] as number] as number;
    if ((compactIndex[vertex] as number) < 0) {
      compactIndex[vertex] = positions.length / 3;
      const offset = vertex * numProp;
      // Adding 0 turns −0, which the kernel emits for some on-axis coordinates, into 0, as the exported text has it.
      positions.push(
        (vertProperties[offset] as number) + 0,
        (vertProperties[offset + 1] as number) + 0,
        (vertProperties[offset + 2] as number) + 0,
      );
    }
    triangles[corner] = compactIndex[vertex] as number;
  }

  return { positions: Float32Array.from(positions), triangles };
}

export function meshBounds(mesh: TriangleMesh): Bounds {
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
    const point = vertexAt(mesh, vertex);
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}

/** Signed volume by the divergence theorem; positive when triangles face outwards. */
export function meshVolume(mesh: TriangleMesh): number {
  // Tetrahedra are taken from the first vertex instead of the origin to limit cancellation for distant meshes.
  const apex = vertexAt(mesh, 0);
  let sixfoldVolume = 0;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [a, b, c] = triangleAt(mesh, triangle).map((vertex) => subtract(vertexAt(mesh, vertex), apex)) as [Vec3, Vec3, Vec3];
    sixfoldVolume += dot(a, cross(b, c));
  }
  return sixfoldVolume / 6;
}

export function meshSurfaceArea(mesh: TriangleMesh): number {
  let doubleArea = 0;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    doubleArea += length(triangleAreaVector(mesh, triangle));
  }
  return doubleArea / 2;
}

export function measureMesh(mesh: TriangleMesh): MeshMeasurements {
  const bounds = meshBounds(mesh);
  return {
    bounds,
    size: subtract(bounds.max, bounds.min),
    volume: meshVolume(mesh),
    surfaceArea: meshSurfaceArea(mesh),
  };
}

/**
 * Checks that the mesh is a closed, consistently oriented edge-manifold with positive volume: every edge is shared by
 * exactly two triangles that traverse it in opposite directions. Self-intersections are not detected here.
 */
// An edge this much shorter than the mesh's largest coordinate lies within a few float32 rounding steps of nothing.
export const ROUNDING_EDGE_RELATIVE = 1e-6;

/**
 * Removes the slivers that rounding leaves in a part: a plane through a vertex can leave the kernel a copy of it a
 * billionth of a millimetre away, which float32 keeps as a separate vertex, one rounding step apart, with zero-area
 * triangles between them. The shortest edge of each degenerate triangle collapses, if it is no longer than a few rounding
 * steps: no geometry that a print could show moves. A mesh without such slivers comes back as it is, and so does one that
 * the collapse would not leave a valid closed solid, for the validation to report.
 */
export function collapseRoundingSlivers<Marked extends { readonly mesh: TriangleMesh; readonly newFaces: Uint8Array }>(
  marked: Marked,
): Marked {
  const { mesh, newFaces } = marked;
  const isDegenerate = degenerateTriangles(mesh);
  const { bounds } = measureMesh(mesh);
  const shortest = ROUNDING_EDGE_RELATIVE * Math.max(...bounds.min.map(Math.abs), ...bounds.max.map(Math.abs));
  const parent = Array.from({ length: vertexCount(mesh) }, (_, vertex) => vertex);
  const rootOf = (vertex: number): number => {
    let root = vertex;
    while (parent[root] !== root) root = parent[root] as number;
    return root;
  };
  let collapsed = false;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    if (!isDegenerate(triangle)) continue;
    const corners = triangleAt(mesh, triangle);
    const edges = corners.map((vertex, corner) => {
      const next = corners[(corner + 1) % 3] as number;
      return { vertex, next, size: length(subtract(vertexAt(mesh, vertex), vertexAt(mesh, next))) };
    });
    const smallest = edges.reduce((best, edge) => (edge.size < best.size ? edge : best));
    if (smallest.size > shortest) continue;
    parent[rootOf(smallest.next)] = rootOf(smallest.vertex);
    collapsed = true;
  }
  if (!collapsed) return marked;
  const kept = Array.from({ length: triangleCount(mesh) }, (_, triangle) => triangle).filter((triangle) => {
    const [a, b, c] = triangleAt(mesh, triangle).map(rootOf) as [number, number, number];
    return a !== b && b !== c && c !== a;
  });
  const newIndex = new Map<number, number>();
  const positions: number[] = [];
  const indexOf = (vertex: number) => {
    const root = rootOf(vertex);
    let index = newIndex.get(root);
    if (index === undefined) {
      index = newIndex.size;
      newIndex.set(root, index);
      positions.push(...vertexAt(mesh, root));
    }
    return index;
  };
  const triangles = kept.flatMap((triangle) => triangleAt(mesh, triangle).map(indexOf));
  const result = { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles) };
  if (findMeshDefects(result).length > 0) return marked;
  return { ...marked, mesh: result, newFaces: Uint8Array.from(kept, (triangle) => newFaces[triangle] as number) };
}

export function findMeshDefects(mesh: TriangleMesh): MeshDefect[] {
  const defects = new Set<MeshDefect>();
  const { positions, triangles } = mesh;
  if (positions.length % 3 !== 0 || triangles.length % 3 !== 0) {
    return ['malformed-buffers'];
  }
  if (positions.length === 0 || triangles.length === 0) {
    return ['empty'];
  }
  if (!positions.every(Number.isFinite)) {
    return ['non-finite-vertex'];
  }
  const verticesInMesh = vertexCount(mesh);
  if (!triangles.every((vertex) => vertex < verticesInMesh)) {
    return ['index-out-of-range'];
  }

  const isDegenerate = degenerateTriangles(mesh);
  const directedEdges = new Map<number, number>();
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle);
    if (isDegenerate(triangle)) {
      defects.add('degenerate-triangle');
    }
    for (let corner = 0; corner < 3; corner += 1) {
      const key = edgeKey(corners[corner] as number, corners[(corner + 1) % 3] as number, verticesInMesh);
      directedEdges.set(key, (directedEdges.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of directedEdges) {
    const from = Math.floor(key / verticesInMesh);
    const to = key % verticesInMesh;
    const reverseCount = directedEdges.get(edgeKey(to, from, verticesInMesh)) ?? 0;
    if (count === 1 && reverseCount === 1) continue;
    if (count + reverseCount === 1) defects.add('open-edge');
    else if (count + reverseCount === 2) defects.add('inconsistent-orientation');
    else defects.add('non-manifold-edge');
  }

  if (!(meshVolume(mesh) > 0)) {
    defects.add('non-positive-volume');
  }
  return [...defects];
}

export function assertValidSolidMesh(mesh: TriangleMesh): void {
  const defects = findMeshDefects(mesh);
  if (defects.length > 0) {
    throw new GeometryError(`Mesh is not a valid closed solid: ${defects.join(', ')}.`);
  }
}

const edgeKey = (from: number, to: number, verticesInMesh: number): number => from * verticesInMesh + to;
