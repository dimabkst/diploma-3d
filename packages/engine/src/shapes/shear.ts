import type { Mat4 } from 'manifold-3d';
import type { Vec2 } from './polygon.ts';

/**
 * The shear x' = x + (dx/h)·z, y' = y + (dy/h)·z, z' = z as manifold-3d's column-major 4 × 4 matrix: elements 8 and 9
 * are rows 0 and 1 of the third (z) column. It keeps the plane z = 0 fixed, moves the plane z = h by (dx, dy) and
 * every horizontal section in proportion to its height, and has determinant 1, so it preserves volume and orientation.
 * It displaces a prism's upper base or a pyramid's apex without rebuilding any face.
 */
export function shearMatrix(height: number, [dx, dy]: Vec2): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, dx / height, dy / height, 1, 0, 0, 0, 0, 1];
}
