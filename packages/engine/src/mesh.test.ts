import { describe, expect, it } from 'vitest';
import {
  assertValidSolidMesh,
  collapseRoundingSlivers,
  findMeshDefects,
  measureMesh,
  meshVolume,
  type TriangleMesh,
  triangleCount,
  vertexCount,
} from './mesh.ts';
import { rightTetrahedron, rightTetrahedronSurfaceArea, translated } from './test-fixtures.ts';

const withTriangles = (mesh: TriangleMesh, triangles: readonly number[]): TriangleMesh => ({
  positions: mesh.positions,
  triangles: Uint32Array.from(triangles),
});

describe('mesh measurements', () => {
  it('match the analytical volume, surface area and bounds of an asymmetric tetrahedron', () => {
    const measurements = measureMesh(rightTetrahedron(10, 20, 30));
    expect(measurements.volume).toBeCloseTo((10 * 20 * 30) / 6, 9);
    expect(measurements.surfaceArea).toBeCloseTo(rightTetrahedronSurfaceArea(10, 20, 30), 9);
    expect(measurements.bounds).toEqual({ min: [0, 0, 0], max: [10, 20, 30] });
    expect(measurements.size).toEqual([10, 20, 30]);
  });

  it('keeps the volume independent of the position of the mesh', () => {
    expect(meshVolume(translated(rightTetrahedron(), [500, -700, 300]))).toBeCloseTo(1000, 6);
  });
});

describe('findMeshDefects', () => {
  const tetrahedron = rightTetrahedron();

  it('accepts a closed, outward-oriented mesh', () => {
    expect(findMeshDefects(tetrahedron)).toEqual([]);
    expect(() => assertValidSolidMesh(tetrahedron)).not.toThrow();
  });

  it('detects a missing triangle as an open mesh', () => {
    expect(findMeshDefects(withTriangles(tetrahedron, [0, 2, 1, 0, 1, 3, 0, 3, 2]))).toContain('open-edge');
  });

  it('detects a single flipped triangle', () => {
    expect(findMeshDefects(withTriangles(tetrahedron, [0, 1, 2, 0, 1, 3, 0, 3, 2, 1, 2, 3]))).toContain(
      'inconsistent-orientation',
    );
  });

  it('detects an inside-out mesh by its negative volume', () => {
    const inverted = withTriangles(tetrahedron, [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]);
    expect(findMeshDefects(inverted)).toEqual(['non-positive-volume']);
    expect(meshVolume(inverted)).toBeCloseTo(-1000, 9);
  });

  it('detects edges shared by more than two triangles', () => {
    const duplicatedFaces = [...tetrahedron.triangles, 0, 2, 1, 0, 1, 2];
    expect(findMeshDefects(withTriangles(tetrahedron, duplicatedFaces))).toContain('non-manifold-edge');
  });

  it('detects degenerate triangles of a collapsed mesh', () => {
    const flat = { positions: Float32Array.of(0, 0, 0, 10, 0, 0, 0, 20, 0, 5, 0, 0), triangles: tetrahedron.triangles };
    expect(findMeshDefects(flat)).toEqual(expect.arrayContaining(['degenerate-triangle', 'non-positive-volume']));
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('rejects %s coordinates', (_, value) => {
    const positions = Float32Array.from(tetrahedron.positions);
    positions[4] = value;
    expect(findMeshDefects({ positions, triangles: tetrahedron.triangles })).toEqual(['non-finite-vertex']);
  });

  it('rejects out-of-range indices, malformed buffers and empty meshes', () => {
    expect(findMeshDefects(withTriangles(tetrahedron, [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 4]))).toEqual(['index-out-of-range']);
    expect(findMeshDefects({ positions: Float32Array.of(0, 0), triangles: Uint32Array.of(0, 1, 2) })).toEqual([
      'malformed-buffers',
    ]);
    expect(findMeshDefects({ positions: new Float32Array(), triangles: new Uint32Array() })).toEqual(['empty']);
    expect(() => assertValidSolidMesh({ positions: new Float32Array(), triangles: new Uint32Array() })).toThrow(/empty/);
  });
});

describe('collapseRoundingSlivers', () => {
  // A tetrahedron with a copy of its apex a few float32 steps away along an edge, with two zero-area triangles between them.
  const step = 2 ** -18;
  const withCopy: TriangleMesh = {
    positions: Float32Array.from([0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 8, -step, 0, 8 + step]),
    triangles: Uint32Array.from([0, 2, 1, 1, 2, 4, 2, 0, 4, 0, 1, 3, 1, 4, 3, 0, 3, 4]),
  };
  const newFaces = Uint8Array.from([0, 1, 0, 1, 0, 1]);

  it('merges the copy, keeps a closed mesh with its marks, and removes only the slivers', () => {
    expect(findMeshDefects(withCopy)).toContain('degenerate-triangle');
    const { mesh, newFaces: marks } = collapseRoundingSlivers({ mesh: withCopy, newFaces });
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(triangleCount(mesh)).toBe(4);
    expect(vertexCount(mesh)).toBe(4);
    expect(marks).toHaveLength(4);
    expect(Array.from(marks)).toEqual([0, 1, 0, 1]);
  });

  it('leaves a clean mesh as it is', () => {
    const clean = { mesh: rightTetrahedron(10, 20, 30), newFaces: Uint8Array.from([0, 0, 0, 0]) };
    expect(collapseRoundingSlivers(clean)).toBe(clean);
  });

  it('does not collapse a real, if short, edge', () => {
    const shape: TriangleMesh = {
      positions: Float32Array.from([0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 8, -0.01, 0, 8.01]),
      triangles: withCopy.triangles,
    };
    const marked = { mesh: shape, newFaces };
    expect(collapseRoundingSlivers(marked).mesh.positions).toHaveLength(15);
  });
});
