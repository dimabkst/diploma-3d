import type { TriangleMesh } from './mesh.ts';

/**
 * Tetrahedron with legs a, b, c along +X, +Y, +Z from the origin. Unequal legs make every axis distinguishable, so
 * swapped, mirrored or wrongly scaled axes cannot hide behind symmetry. Volume abc/6.
 */
export function rightTetrahedron(a = 10, b = 20, c = 30): TriangleMesh {
  return {
    positions: Float32Array.of(0, 0, 0, a, 0, 0, 0, b, 0, 0, 0, c),
    triangles: Uint32Array.of(0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3),
  };
}

export function rightTetrahedronSurfaceArea(a = 10, b = 20, c = 30): number {
  return (a * b + a * c + b * c + Math.hypot(b * c, a * c, a * b)) / 2;
}

export function translated(mesh: TriangleMesh, offset: readonly [number, number, number]): TriangleMesh {
  return { positions: mesh.positions.map((value, index) => value + (offset[index % 3] ?? 0)), triangles: mesh.triangles };
}
