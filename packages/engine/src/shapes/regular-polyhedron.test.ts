import { defaultModelSpecs, REGULAR_POLYHEDRON_KINDS, type RegularPolyhedronKind } from '@diploma-3d/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  cross,
  dot,
  findMeshDefects,
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
import { generateModel } from '../model.ts';
import { withScope } from '../scope.ts';
import {
  buildRegularPolyhedron,
  orientedRegularPolyhedronVertices,
  PHI,
  regularPolyhedronBoundingSize,
  regularPolyhedronMeasurements,
  regularPolyhedronScaleMm,
  unitRegularPolyhedronVertices,
} from './regular-polyhedron.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

const scale = (longestDimensionMm: number) => ({ longestDimensionMm });
const spec = (kind: RegularPolyhedronKind, longestDimensionMm = 80) => ({ shape: { kind }, scale: scale(longestDimensionMm) });

/**
 * Independent references. Counts: V − E + F = 2 with F·n = 2E. Face area of the regular n-gon with side a:
 * n·a²/(4·tan(π/n)). Bounding box with a = 1, resting on a face with an edge along X:
 * - octahedron: the opposite faces are √(2/3) apart; the outline seen from above is a regular hexagon with circumradius
 *   1/√3, two of its sides along X, so it is 1 wide and 2/√3 deep;
 * - icosahedron: 2·inradius = φ²/√3 high; seen from above, φ wide and 2φ/√3 deep;
 * - dodecahedron: 2·inradius = √((25 + 11√5)/10) high; seen from above, φ² wide and 2·tan 54° deep.
 */
const references = {
  octahedron: { vertices: 6, edges: 12, faces: 8, sides: 3, size: [1, 2 / Math.sqrt(3), Math.sqrt(2 / 3)] },
  icosahedron: {
    vertices: 12,
    edges: 30,
    faces: 20,
    sides: 3,
    size: [PHI, (2 * PHI) / Math.sqrt(3), PHI ** 2 / Math.sqrt(3)],
  },
  dodecahedron: {
    vertices: 20,
    edges: 30,
    faces: 12,
    sides: 5,
    size: [PHI ** 2, 2 * Math.tan((54 * Math.PI) / 180), Math.sqrt((25 + 11 * Math.sqrt(5)) / 10)],
  },
} as const satisfies Record<
  RegularPolyhedronKind,
  { vertices: number; edges: number; faces: number; sides: 3 | 5; size: readonly [number, number, number] }
>;

const faceArea = (sides: number, edge: number) => (sides * edge ** 2) / (4 * Math.tan(Math.PI / sides));

/**
 * Surface area F·(face area) and volume as F pyramids over the faces with the inradius, half the height between the
 * opposite parallel faces, as their height: independent of the closed-form factors in the module.
 */
function referenceMeasurements(kind: RegularPolyhedronKind, edge: number) {
  const { faces, sides, size } = references[kind];
  const face = faceArea(sides, edge);
  const inradius = (size[2] * edge) / 2;
  return { surfaceArea: faces * face, volume: (faces * face * inradius) / 3 };
}

const pairs = <T>(items: readonly T[]): [T, T][] =>
  items.flatMap((a, index) => items.slice(index + 1).map((b): [T, T] => [a, b]));
const distance = (a: Vec3, b: Vec3) => length(subtract(a, b));

const expectRelativelyClose = (actual: number, expected: number, tolerance: number) => {
  expect(Math.abs(actual / expected - 1)).toBeLessThan(tolerance);
};

describe('regular polyhedron vertices with edge 1', () => {
  it.each(REGULAR_POLYHEDRON_KINDS)('the %s has the expected number of distinct vertices, centred and on one sphere', (kind) => {
    const vertices = unitRegularPolyhedronVertices(kind);
    expect(vertices).toHaveLength(references[kind].vertices);
    expect(new Set(vertices.map((vertex) => vertex.join(','))).size).toBe(references[kind].vertices);
    const centroid = vertices.reduce<Vec3>((sum, [x, y, z]) => [sum[0] + x, sum[1] + y, sum[2] + z], [0, 0, 0]);
    for (const component of centroid) expect(component).toBeCloseTo(0, 12);
    const radii = vertices.map((vertex) => length(vertex));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0] as number, 12);
  });

  // In a convex regular polyhedron the edges are exactly the pairs of nearest vertices.
  it.each(REGULAR_POLYHEDRON_KINDS)('the %s has E edges of length 1 and every vertex has 2E/V of them', (kind) => {
    const vertices = unitRegularPolyhedronVertices(kind);
    const lengths = pairs(vertices).map(([a, b]) => distance(a, b));
    const shortest = Math.min(...lengths);
    expect(shortest).toBeCloseTo(1, 12);
    const edges = pairs(vertices.map((_, index) => index)).filter(
      ([a, b]) => distance(vertices[a] as Vec3, vertices[b] as Vec3) < 1 + 1e-9,
    );
    expect(edges).toHaveLength(references[kind].edges);
    // The next distance, e.g. a pentagon's diagonal φ, is far from the edge.
    expect(Math.min(...lengths.filter((value) => value > 1 + 1e-9))).toBeGreaterThan(1.4);
    const degree = (2 * references[kind].edges) / references[kind].vertices;
    vertices.forEach((_, vertex) => {
      expect(edges.filter((edge) => edge.includes(vertex))).toHaveLength(degree);
    });
  });

  it('octahedron, icosahedron and dodecahedron satisfy Euler’s formula with the reference counts', () => {
    for (const { vertices, edges, faces, sides } of Object.values(references)) {
      expect(vertices - edges + faces).toBe(2);
      expect(faces * sides).toBe(2 * edges);
    }
  });
});

describe('orientation resting on a face', () => {
  it.each(REGULAR_POLYHEDRON_KINDS)('the %s is moved by a proper rigid motion', (kind) => {
    const raw = unitRegularPolyhedronVertices(kind);
    const oriented = orientedRegularPolyhedronVertices(kind);
    expect(oriented).toHaveLength(raw.length);
    for (const [a, b] of pairs(raw.map((_, index) => index))) {
      expect(distance(oriented[a] as Vec3, oriented[b] as Vec3)).toBeCloseTo(distance(raw[a] as Vec3, raw[b] as Vec3), 12);
    }
    // The centre moves to (0, 0, h/2), and the triple product of three centred vertices keeps its sign and value.
    const centre: Vec3 = [0, 0, references[kind].size[2] / 2];
    const triple = ([a, b, c]: Vec3[]) => dot(a as Vec3, cross(b as Vec3, c as Vec3));
    // The first vertex, the next one not opposite to it, and the first one off their plane through the centre.
    const second = raw.findIndex((vertex) => length(cross(raw[0] as Vec3, vertex)) > 0.1);
    const third = raw.findIndex((vertex) => Math.abs(dot(vertex, cross(raw[0] as Vec3, raw[second] as Vec3))) > 0.1);
    const indices = [0, second, third];
    const before = triple(indices.map((index) => raw[index] as Vec3));
    const after = triple(indices.map((index) => subtract(oriented[index] as Vec3, centre)));
    expect(Math.abs(before)).toBeGreaterThan(0.1);
    expect(after).toBeCloseTo(before, 12);
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s rests on a whole face in z = 0 with an edge of that face along X', (kind) => {
    const vertices = orientedRegularPolyhedronVertices(kind);
    const { sides, size } = references[kind];
    expect(Math.min(...vertices.map(([, , z]) => z))).toBe(0);
    const bottom = vertices.filter(([, , z]) => z === 0);
    expect(bottom).toHaveLength(sides);
    // Every other vertex is clearly above the face; the opposite parallel face is on top.
    expect(vertices.filter(([, , z]) => z !== 0).every(([, , z]) => z > 0.5)).toBe(true);
    expect(vertices.filter(([, , z]) => Math.abs(z - size[2]) < 1e-12)).toHaveLength(sides);

    const bottomEdges = pairs(bottom).filter(([a, b]) => Math.abs(distance(a, b) - 1) < 1e-12);
    expect(bottomEdges).toHaveLength(sides);
    const alongX = bottomEdges.filter(([a, b]) => Math.abs(Math.abs(a[0] - b[0]) - 1) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12);
    expect(alongX).toHaveLength(1);
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s keeps its centre on the Z axis and its box centred in XY', (kind) => {
    const vertices = orientedRegularPolyhedronVertices(kind);
    for (const axis of [0, 1] as const) {
      const values = vertices.map((vertex) => vertex[axis]);
      expect(values.reduce((sum, value) => sum + value, 0) / values.length).toBeCloseTo(0, 12);
      expect(Math.max(...values) + Math.min(...values)).toBeCloseTo(0, 12);
    }
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s has the analytic bounding box and is deterministic', (kind) => {
    regularPolyhedronBoundingSize(kind).forEach((value, axis) => {
      expect(value).toBeCloseTo(references[kind].size[axis] as number, 12);
    });
    expect(orientedRegularPolyhedronVertices(kind)).toEqual(orientedRegularPolyhedronVertices(kind));
  });
});

describe('physical scale and exact measurements', () => {
  it('fits the largest box dimension, the depth in all three cases, to L', () => {
    // Octahedron: 2a/√3 = 80 mm, so a = 40√3 mm, S = 2√3·a² = 9600√3 mm² and V = √2/3·a³ = 64 000√6 mm³.
    const octahedron = regularPolyhedronMeasurements('octahedron', scale(80));
    expect(octahedron.edge).toBeCloseTo(40 * Math.sqrt(3), 12);
    expect(octahedron.surfaceArea).toBeCloseTo(9600 * Math.sqrt(3), 8);
    expect(octahedron.volume).toBeCloseTo(64000 * Math.sqrt(6), 7);
    // Icosahedron: 2φa/√3 = 80 mm; dodecahedron: 2·tan 54°·a = 80 mm.
    expect(regularPolyhedronScaleMm('icosahedron', scale(80))).toBeCloseTo((40 * Math.sqrt(3)) / PHI, 12);
    expect(regularPolyhedronScaleMm('dodecahedron', scale(80))).toBeCloseTo(40 / Math.tan((54 * Math.PI) / 180), 12);
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s has S and V of the closed forms, matching the face-by-face references', (kind) => {
    for (const longest of [1, 12.5, 80, 1000]) {
      const measured = regularPolyhedronMeasurements(kind, scale(longest));
      expect(measured.edge).toBeCloseTo(longest / Math.max(...references[kind].size), 12);
      const reference = referenceMeasurements(kind, measured.edge);
      expectRelativelyClose(measured.surfaceArea, reference.surfaceArea, 1e-13);
      expectRelativelyClose(measured.volume, reference.volume, 1e-13);
      expect([measured.vertexCount, measured.edgeCount, measured.faceCount, measured.faceSides]).toEqual([
        references[kind].vertices,
        references[kind].edges,
        references[kind].faces,
        references[kind].sides,
      ]);
    }
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s scales uniformly: 2L doubles a, quadruples S and multiplies V by 8', (kind) => {
    const single = regularPolyhedronMeasurements(kind, scale(80));
    const double = regularPolyhedronMeasurements(kind, scale(160));
    expect(double.edge / single.edge).toBeCloseTo(2, 14);
    expect(double.surfaceArea / single.surfaceArea).toBeCloseTo(4, 13);
    expect(double.volume / single.volume).toBeCloseTo(8, 13);
  });
});

/** Mesh vertices keyed by position, so that duplicated rendering vertices would count once. */
const positionKey = (vertex: Vec3) => vertex.map((component) => component.toFixed(4)).join(',');

/**
 * The geometric faces: triangles grouped by their plane. Float32 positions tilt coplanar triangles by about 1e-7 rad,
 * while adjacent faces of these solids meet at least 41,8° apart (the icosahedron's exterior dihedral angle).
 */
function geometricFaces(mesh: TriangleMesh) {
  const faces: { normal: Vec3; area: number; vertices: Set<string>; triangles: number[] }[] = [];
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const areaVector = triangleAreaVector(mesh, triangle);
    const normal: Vec3 = [
      areaVector[0] / length(areaVector),
      areaVector[1] / length(areaVector),
      areaVector[2] / length(areaVector),
    ];
    let face = faces.find((candidate) => dot(candidate.normal, normal) > 1 - 1e-6);
    if (face === undefined) {
      face = { normal, area: 0, vertices: new Set(), triangles: [] };
      faces.push(face);
    }
    face.area += length(areaVector) / 2;
    face.triangles.push(triangle);
    for (const vertex of triangleAt(mesh, triangle)) face.vertices.add(positionKey(vertexAt(mesh, vertex)));
  }
  return faces;
}

/** Undirected mesh edges between triangles of different faces: the polyhedron's edges, without triangulation diagonals. */
function geometricEdges(mesh: TriangleMesh) {
  const faceOf = new Map<number, number>();
  geometricFaces(mesh).forEach((face, index) => {
    for (const triangle of face.triangles) faceOf.set(triangle, index);
  });
  const sides = new Map<string, { ends: [Vec3, Vec3]; faces: number[] }>();
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex));
    corners.forEach((from, corner) => {
      const to = corners[(corner + 1) % 3] as Vec3;
      const key = [positionKey(from), positionKey(to)].sort().join('|');
      const side = sides.get(key) ?? { ends: [from, to], faces: [] };
      side.faces.push(faceOf.get(triangle) as number);
      sides.set(key, side);
    });
  }
  return [...sides.values()].filter(({ faces }) => faces[0] !== faces[1]);
}

describe('generated regular polyhedra', () => {
  const solidOf = (kind: RegularPolyhedronKind, longest = 80) => {
    const [solid] = generateModel(kernel, spec(kind, longest)).solids;
    if (solid === undefined) throw new Error('No solid');
    return solid;
  };

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s is one connected, closed manifold solid of genus 0', (kind) => {
    withScope((track) => {
      const solid = buildRegularPolyhedron(kernel, track, kind, scale(80));
      expect(solid.status()).toBe('NoError');
      expect(solid.isEmpty()).toBe(false);
      expect(solid.genus()).toBe(0);
      expect(solid.numVert()).toBe(references[kind].vertices);
      const parts = solid.decompose();
      expect(parts).toHaveLength(1);
      for (const part of parts) part.delete();
      expect(solid.volume()).toBeGreaterThan(0);
    });
    expect(findMeshDefects(solidOf(kind).mesh)).toEqual([]);
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s mesh has V distinct vertices, F flat faces and E equal edges', (kind) => {
    const { mesh } = solidOf(kind);
    const { edge } = regularPolyhedronMeasurements(kind, scale(80));
    const { vertices, edges, faces, sides } = references[kind];

    const positions = new Set(
      Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => positionKey(vertexAt(mesh, vertex))),
    );
    expect(positions.size).toBe(vertices);

    const meshFaces = geometricFaces(mesh);
    expect(meshFaces).toHaveLength(faces);
    for (const face of meshFaces) {
      expect(face.vertices.size).toBe(sides);
      expectRelativelyClose(face.area, faceArea(sides, edge), 1e-6);
    }

    const meshEdges = geometricEdges(mesh);
    expect(meshEdges).toHaveLength(edges);
    for (const { ends, faces: adjacent } of meshEdges) {
      expect(adjacent).toHaveLength(2);
      expectRelativelyClose(distance(...ends), edge, 1e-6);
    }
    expect(positions.size - meshEdges.length + meshFaces.length).toBe(2);
  });

  it('triangulates each pentagon of the dodecahedron with two diagonals that are not reported as edges', () => {
    const { mesh } = solidOf('dodecahedron');
    const { edge } = regularPolyhedronMeasurements('dodecahedron', scale(80));
    expect(triangleCount(mesh)).toBe(36);
    const sides = new Map<string, number>();
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const corners = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex));
      corners.forEach((from, corner) => {
        const to = corners[(corner + 1) % 3] as Vec3;
        const key = [positionKey(from), positionKey(to)].sort().join('|');
        sides.set(key, distance(from, to));
      });
    }
    const lengths = [...sides.values()];
    expect(lengths).toHaveLength(30 + 12 * 2);
    expect(lengths.filter((value) => Math.abs(value / edge - 1) < 1e-6)).toHaveLength(30);
    expect(lengths.filter((value) => Math.abs(value / (PHI * edge) - 1) < 1e-6)).toHaveLength(24);
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s mesh area and volume agree with the analytic formulas', (kind) => {
    for (const longest of [1, 80, 1000]) {
      const { measurements } = solidOf(kind, longest);
      const exact = regularPolyhedronMeasurements(kind, scale(longest));
      // Float32 vertices: about 1e-7 relative per coordinate.
      expectRelativelyClose(measurements.surfaceArea, exact.surfaceArea, 1e-6);
      expectRelativelyClose(measurements.volume, exact.volume, 1e-6);
    }
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s lies on the build plate with its largest dimension L', (kind) => {
    for (const longest of [12.5, 80, 333.3]) {
      const { mesh, measurements } = solidOf(kind, longest);
      const expected = references[kind].size.map((value) => value * regularPolyhedronScaleMm(kind, scale(longest)));
      measurements.size.forEach((value, axis) => {
        expectRelativelyClose(value, expected[axis] as number, 1e-6);
      });
      expectRelativelyClose(Math.max(...measurements.size), longest, 1e-6);
      expect(measurements.bounds.min[2]).toBe(0);
      expect(measurements.bounds.min[0] + measurements.bounds.max[0]).toBeCloseTo(0, 4);
      expect(measurements.bounds.min[1] + measurements.bounds.max[1]).toBeCloseTo(0, 4);

      // The supporting face: its triangles face −Z and add up to one whole face in z = 0.
      const bottom = geometricFaces(mesh).filter((face) => face.normal[2] < -1 + 1e-9);
      expect(bottom).toHaveLength(1);
      const [face] = bottom;
      expect(face?.vertices.size).toBe(references[kind].sides);
      expectRelativelyClose(
        face?.area ?? 0,
        faceArea(references[kind].sides, regularPolyhedronScaleMm(kind, scale(longest))),
        1e-6,
      );
      for (const triangle of face?.triangles ?? []) {
        for (const vertex of triangleAt(mesh, triangle)) expect(vertexAt(mesh, vertex)[2]).toBe(0);
      }
      // One of its edges runs along X.
      const along = geometricEdges(mesh).filter(
        ({ ends: [a, b] }) => a[2] === 0 && b[2] === 0 && Math.abs(a[1] - b[1]) < 1e-6 * longest,
      );
      expect(along).toHaveLength(1);
    }
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s doubles every coordinate at twice the export size', (kind) => {
    const single = solidOf(kind, 80);
    const double = solidOf(kind, 160);
    const sorted = (mesh: TriangleMesh, factor: number) =>
      Array.from({ length: mesh.positions.length / 3 }, (_, vertex) =>
        vertexAt(mesh, vertex)
          .map((value) => value * factor)
          .join(','),
      ).sort();
    expect(sorted(double.mesh, 1)).toEqual(sorted(single.mesh, 2));
    expectRelativelyClose(double.measurements.surfaceArea / single.measurements.surfaceArea, 4, 1e-6);
    expectRelativelyClose(double.measurements.volume / single.measurements.volume, 8, 1e-6);
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('the %s is a flat-shaded solid named after its kind', (kind) => {
    const model = generateModel(kernel, defaultModelSpecs[kind]);
    expect(model.name).toBe(kind);
    expect(model.solids).toHaveLength(1);
    expect(model.solids[0]?.smoothShading).toBe(false);
    expect(model.solids[0]?.smoothingShear).toBeUndefined();
    expect(measureMesh(model.solids[0]?.mesh as TriangleMesh)).toEqual(model.solids[0]?.measurements);
  });
});
