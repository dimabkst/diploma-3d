import { assertSidesAndAngle, cosSinDeg } from './angle.ts';
import type { Vec2 } from './polygon.ts';

/**
 * Vertices A, B, C, D of the parallelogram with AB = a, AD = b and ∠DAB = α, centred at the origin and counter-clockwise
 * seen from +Z. With u = (a, 0) along AB and v = b·(cos α, sin α) along AD, the vertices are A = −(u + v)/2,
 * B = (u − v)/2, C = (u + v)/2 and D = (v − u)/2, so AB is parallel to X and α = 90° gives an axis-aligned rectangle.
 */
export function parallelogramVertices(a: number, b: number, angleDeg: number): [Vec2, Vec2, Vec2, Vec2] {
  assertSidesAndAngle('parallelogram', a, b, angleDeg);
  const [cos, sin] = cosSinDeg(angleDeg);
  const [ux, uy] = [a, 0];
  const [vx, vy] = [b * cos, b * sin];
  return [
    [-(ux + vx) / 2, -(uy + vy) / 2],
    [(ux - vx) / 2, (uy - vy) / 2],
    [(ux + vx) / 2, (uy + vy) / 2],
    [(vx - ux) / 2, (vy - uy) / 2],
  ];
}

/** Area a·b·sin α. */
export function parallelogramArea(a: number, b: number, angleDeg: number): number {
  assertSidesAndAngle('parallelogram', a, b, angleDeg);
  return a * b * cosSinDeg(angleDeg)[1];
}
