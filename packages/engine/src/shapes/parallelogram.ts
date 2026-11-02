import type { Vec2 } from './polygon.ts';

/**
 * cos α and sin α for an angle in degrees, computed from 90° − α: cos α = sin(90° − α) and sin α = cos(90° − α). Since
 * floating-point sine is odd and cosine even, α and 180° − α then give exactly opposite cosines and equal sines, so
 * mirror-image bases are exact mirror images, and α = 90° gives exactly (0, 1), an exact rectangle.
 */
export function cosSinDeg(angleDeg: number): Vec2 {
  const fromRightAngle = ((90 - angleDeg) * Math.PI) / 180;
  return [Math.sin(fromRightAngle), Math.cos(fromRightAngle)];
}

function assertParallelogram(a: number, b: number, angleDeg: number): void {
  for (const side of [a, b]) {
    if (!(side > 0) || !Number.isFinite(side)) throw new RangeError(`Invalid parallelogram side: ${side}.`);
  }
  if (!(angleDeg > 0 && angleDeg < 180)) throw new RangeError(`Invalid parallelogram angle: ${angleDeg}°.`);
}

/**
 * Vertices A, B, C, D of the parallelogram with AB = a, AD = b and ∠DAB = α, centred at the origin and counter-clockwise
 * seen from +Z. With u = (a, 0) along AB and v = b·(cos α, sin α) along AD, the vertices are A = −(u + v)/2,
 * B = (u − v)/2, C = (u + v)/2 and D = (v − u)/2, so AB is parallel to X and α = 90° gives an axis-aligned rectangle.
 */
export function parallelogramVertices(a: number, b: number, angleDeg: number): [Vec2, Vec2, Vec2, Vec2] {
  assertParallelogram(a, b, angleDeg);
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
  assertParallelogram(a, b, angleDeg);
  return a * b * cosSinDeg(angleDeg)[1];
}
