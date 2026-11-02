import type { Vec2 } from './polygon.ts';

/**
 * cos α and sin α for an angle in degrees, computed from 90° − α: cos α = sin(90° − α) and sin α = cos(90° − α). Since
 * floating-point sine is odd and cosine even, α and 180° − α then give exactly opposite cosines and equal sines, so
 * mirror-image bases are exact mirror images, and α = 90° gives exactly (0, 1), an exact right angle.
 */
export function cosSinDeg(angleDeg: number): Vec2 {
  const fromRightAngle = ((90 - angleDeg) * Math.PI) / 180;
  return [Math.sin(fromRightAngle), Math.cos(fromRightAngle)];
}

/** Two sides and the angle between them, as for a parallelogram or a triangle: positive, finite, 0° < α < 180°. */
export function assertSidesAndAngle(shape: string, a: number, b: number, angleDeg: number): void {
  for (const side of [a, b]) {
    if (!(side > 0) || !Number.isFinite(side)) throw new RangeError(`Invalid ${shape} side: ${side}.`);
  }
  if (!(angleDeg > 0 && angleDeg < 180)) throw new RangeError(`Invalid ${shape} angle: ${angleDeg}°.`);
}
