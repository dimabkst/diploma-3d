import { assertSidesAndAngle, cosSinDeg } from './angle.ts';
import type { Vec2 } from './polygon.ts';

/**
 * Vertices of the triangle with the sides a = P0P1 and b = P0P2 and the angle α between them at P0, for prisms and
 * pyramids alike. With P0 = (0, 0), P1 = (a, 0) and P2 = b·(cos α, sin α), the triangle is counter-clockwise seen from
 * +Z for 0° < α < 180°, and its reference edge P0P1 runs along X. It is moved so that its centroid
 * G = (P0 + P1 + P2)/3 is at the origin.
 */
export function triangleVertices(a: number, b: number, angleDeg: number): [Vec2, Vec2, Vec2] {
  assertSidesAndAngle('triangle', a, b, angleDeg);
  const [cos, sin] = cosSinDeg(angleDeg);
  const points: [Vec2, Vec2, Vec2] = [
    [0, 0],
    [a, 0],
    [b * cos, b * sin],
  ];
  const centroid: Vec2 = [(a + b * cos) / 3, (b * sin) / 3];
  return points.map(([x, y]): Vec2 => [x - centroid[0], y - centroid[1]]) as [Vec2, Vec2, Vec2];
}

/** The third side c = |P1P2| = √((a − b·cos α)² + (b·sin α)²), equal to √(a² + b² − 2ab·cos α) by the cosine rule. */
export function triangleThirdSide(a: number, b: number, angleDeg: number): number {
  assertSidesAndAngle('triangle', a, b, angleDeg);
  const [cos, sin] = cosSinDeg(angleDeg);
  return Math.hypot(a - b * cos, b * sin);
}

/** Area a·b·sin α / 2. */
export function triangleArea(a: number, b: number, angleDeg: number): number {
  assertSidesAndAngle('triangle', a, b, angleDeg);
  return (a * b * cosSinDeg(angleDeg)[1]) / 2;
}
