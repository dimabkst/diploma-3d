import type { PhysicalScale, RegularPolyhedronKind } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { GeometryError } from '../errors.ts';
import type { GeometryKernel } from '../kernel.ts';
import { cross, dot, length, subtract, type Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';

export const PHI = (1 + Math.sqrt(5)) / 2;

interface RegularPolyhedronDefinition {
  /** Coordinate families; every non-zero coordinate takes both signs independently, and no permutations are added. */
  readonly families: readonly Vec3[];
  /** The edge length of the raw vertices. */
  readonly rawEdge: number;
  /** Raw vertices A, B, C of one face, with AB a genuine edge; for the pentagon, three consecutive vertices. */
  readonly supportFace: readonly [Vec3, Vec3, Vec3];
  readonly faceSides: 3 | 5;
  readonly vertexCount: number;
  readonly edgeCount: number;
  readonly faceCount: number;
  /** S/a². */
  readonly areaFactor: number;
  /** V/a³. */
  readonly volumeFactor: number;
}

const definitions: Readonly<Record<RegularPolyhedronKind, RegularPolyhedronDefinition>> = {
  octahedron: {
    families: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    rawEdge: Math.SQRT2,
    supportFace: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    faceSides: 3,
    vertexCount: 6,
    edgeCount: 12,
    faceCount: 8,
    areaFactor: 2 * Math.sqrt(3),
    volumeFactor: Math.SQRT2 / 3,
  },
  icosahedron: {
    families: [
      [0, 1, PHI],
      [1, PHI, 0],
      [PHI, 0, 1],
    ],
    rawEdge: 2,
    supportFace: [
      [0, 1, PHI],
      [1, PHI, 0],
      [-1, PHI, 0],
    ],
    faceSides: 3,
    vertexCount: 12,
    edgeCount: 30,
    faceCount: 20,
    areaFactor: 5 * Math.sqrt(3),
    volumeFactor: (5 * (3 + Math.sqrt(5))) / 12,
  },
  dodecahedron: {
    families: [
      [1, 1, 1],
      [0, 1 / PHI, PHI],
      [1 / PHI, PHI, 0],
      [PHI, 0, 1 / PHI],
    ],
    rawEdge: 2 / PHI,
    supportFace: [
      [1, 1, 1],
      [0, 1 / PHI, PHI],
      [-1, 1, 1],
    ],
    faceSides: 5,
    vertexCount: 20,
    edgeCount: 30,
    faceCount: 12,
    areaFactor: 3 * Math.sqrt(25 + 10 * Math.sqrt(5)),
    volumeFactor: (15 + 7 * Math.sqrt(5)) / 4,
  },
};

// In units of the edge. The rotated vertices of the supporting face differ in z by rounding noise of order 1e-16, while
// the next layer of vertices lies at least 0.57 edges higher (the icosahedron's, at 1/√3).
const COPLANAR_TOLERANCE = 1e-9;

/** All sign variants of a coordinate family, in a fixed order; a zero coordinate yields a single variant. */
function signVariants(family: Vec3): Vec3[] {
  const variants = family.reduce<number[][]>(
    (points, coordinate) =>
      points.flatMap((point) =>
        coordinate === 0
          ? [[...point, 0]]
          : [
              [...point, coordinate],
              [...point, -coordinate],
            ],
      ),
    [[]],
  );
  return variants.map(([x = 0, y = 0, z = 0]): Vec3 => [x, y, z]);
}

const scaled = (point: Vec3, factor: number): Vec3 => [point[0] * factor, point[1] * factor, point[2] * factor];
const normalized = (vector: Vec3): Vec3 => scaled(vector, 1 / length(vector));

export interface RegularPolyhedronFacts {
  readonly faceSides: 3 | 5;
  readonly vertexCount: number;
  readonly edgeCount: number;
  readonly faceCount: number;
}

export const regularPolyhedronFacts = (kind: RegularPolyhedronKind): RegularPolyhedronFacts => {
  const { faceSides, vertexCount, edgeCount, faceCount } = definitions[kind];
  return { faceSides, vertexCount, edgeCount, faceCount };
};

/** The raw vertices divided by the raw edge length: edge a0 = 1, centred at the origin, in the defining orientation. */
export function unitRegularPolyhedronVertices(kind: RegularPolyhedronKind): Vec3[] {
  const { families, rawEdge } = definitions[kind];
  return families.flatMap(signVariants).map((point) => scaled(point, 1 / rawEdge));
}

/**
 * The unit-edge vertices resting on a face. The rotation (dot(p, ex), dot(p, ey), dot(p, ez)) with ex along the edge AB,
 * ez the inward normal of the face ABC and ey = ez × ex is proper, since ex × ey = ez; it turns that face's outward
 * normal to −Z with AB parallel to X. The solid is then lifted so that the face lies in z = 0, its vertices exactly, and
 * the centre stays on the Z axis.
 */
export function orientedRegularPolyhedronVertices(kind: RegularPolyhedronKind): Vec3[] {
  const { rawEdge, supportFace, faceSides } = definitions[kind];
  const [a, b, c] = supportFace.map((point) => scaled(point, 1 / rawEdge)) as [Vec3, Vec3, Vec3];
  const ex = normalized(subtract(b, a));
  const normal = normalized(cross(subtract(b, a), subtract(c, a)));
  const ez = scaled(normal, dot(normal, a) < 0 ? 1 : -1);
  const ey = cross(ez, ex);

  const rotated = unitRegularPolyhedronVertices(kind).map((point): Vec3 => [dot(point, ex), dot(point, ey), dot(point, ez)]);
  const minZ = Math.min(...rotated.map(([, , z]) => z));
  const onFace = (z: number) => z - minZ <= COPLANAR_TOLERANCE;
  const bottomCount = rotated.filter(([, , z]) => onFace(z)).length;
  if (bottomCount !== faceSides) {
    throw new GeometryError(`The ${kind} rests on ${bottomCount} vertices instead of a face with ${faceSides}.`);
  }
  return rotated.map(([x, y, z]): Vec3 => [x, y, onFace(z) ? 0 : z - minZ]);
}

/** The unscaled bounding box of the oriented solid, measured on its vertices. */
export function regularPolyhedronBoundingSize(kind: RegularPolyhedronKind): Vec3 {
  const vertices = orientedRegularPolyhedronVertices(kind);
  const extent = (axis: 0 | 1 | 2) =>
    Math.max(...vertices.map((vertex) => vertex[axis])) - Math.min(...vertices.map((vertex) => vertex[axis]));
  return [extent(0), extent(1), extent(2)];
}

/** Millimetres per unit edge, which is also the physical edge a: the longest bounding-box dimension becomes L. */
export const regularPolyhedronScaleMm = (kind: RegularPolyhedronKind, scale: PhysicalScale): number =>
  scale.longestDimensionMm / Math.max(...regularPolyhedronBoundingSize(kind));

export const regularPolyhedronVerticesMm = (kind: RegularPolyhedronKind, scale: PhysicalScale): Vec3[] => {
  const factor = regularPolyhedronScaleMm(kind, scale);
  return orientedRegularPolyhedronVertices(kind).map((vertex) => scaled(vertex, factor));
};

export interface RegularPolyhedronMeasurements extends RegularPolyhedronFacts {
  readonly edge: number;
  readonly surfaceArea: number;
  readonly volume: number;
}

/** Exact measurements from the physical edge a and the closed-form factors, independent of the mesh. */
export function regularPolyhedronMeasurements(kind: RegularPolyhedronKind, scale: PhysicalScale): RegularPolyhedronMeasurements {
  const { areaFactor, volumeFactor } = definitions[kind];
  const edge = regularPolyhedronScaleMm(kind, scale);
  return { ...regularPolyhedronFacts(kind), edge, surfaceArea: areaFactor * edge ** 2, volume: volumeFactor * edge ** 3 };
}

/** The convex hull of the physical vertices: manifold-3d triangulates every face, the pentagons into three triangles. */
export function buildRegularPolyhedron(
  kernel: GeometryKernel,
  track: Track,
  kind: RegularPolyhedronKind,
  scale: PhysicalScale,
): Manifold {
  const points = regularPolyhedronVerticesMm(kind, scale).map(([x, y, z]): [number, number, number] => [x, y, z]);
  return track(kernel.Manifold.hull(points));
}
