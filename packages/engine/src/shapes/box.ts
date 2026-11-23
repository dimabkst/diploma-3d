import type { CubeShape, CuboidShape, PhysicalScale } from '@diploma-3d/schema';
import type { Vec3 } from '../mesh.ts';

export type BoxShape = CubeShape | CuboidShape;

/** Edge lengths a, b, c along X, Y, Z in model units, normalised so that the longest edge is 1. */
export function boxProportions(shape: BoxShape): Vec3 {
  if (shape.kind === 'cube') return [1, 1, 1];
  const longest = Math.max(1, shape.widthRatio, shape.heightRatio);
  return [1 / longest, shape.widthRatio / longest, shape.heightRatio / longest];
}

/** Edge lengths in millimetres: with s = L / max(1, b/a, c/a), the edges are a = s, b = s · b/a and c = s · c/a. */
export function boxEdgeLengthsMm(shape: BoxShape, scale: PhysicalScale): Vec3 {
  if (shape.kind === 'cube') return [scale.longestDimensionMm, scale.longestDimensionMm, scale.longestDimensionMm];
  const s = scale.longestDimensionMm / Math.max(1, shape.widthRatio, shape.heightRatio);
  return [s, s * shape.widthRatio, s * shape.heightRatio];
}
