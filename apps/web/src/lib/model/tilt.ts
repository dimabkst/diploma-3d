import { APEX_LIMITS, OFFSET_LIMITS, RATIO_LIMITS, ROUND_OFFSET_LIMITS } from '@diploma-3d/schema';
import type { ParameterKey } from './parameters.ts';

/** The solids whose upper base or apex can be displaced horizontally. */
export type TiltSolid = 'parallelepiped' | 'prism' | 'pyramid' | 'cylinder' | 'cone';

/**
 * How the displacement is entered: as the offsets themselves, or as the inclination β of a reference line to the base
 * plane and, for polygonal bases, the direction φ of the displacement. Both modes describe the same offsets; the mode
 * is a preference of the interface, not a parameter of the solid.
 */
export type TiltMode = 'offset' | 'angle';

export type TiltModes = Readonly<Record<TiltSolid, TiltMode>>;

export const initialTiltModes = (): TiltModes => ({
  parallelepiped: 'offset',
  prism: 'offset',
  pyramid: 'offset',
  cylinder: 'offset',
  cone: 'offset',
});

/**
 * The allowed offsets: each of X and Y within ±limit for polygonal bases (`plane`), or d within [0, limit] along +X for
 * circular bases (`axis`), whose displacement direction is fixed.
 */
export type OffsetBounds = { readonly type: 'plane' | 'axis'; readonly limit: number };

/** Fields that are validated on their own, unlike an inclination, whose range depends on the height and direction. */
type IndependentKey = Exclude<ParameterKey, InclinationKey>;

export type TiltKeys = {
  readonly height: IndependentKey;
  /** [X, Y] for polygonal bases, [d] for circular ones. */
  readonly offsets: readonly [IndependentKey] | readonly [IndependentKey, IndependentKey];
  readonly inclination: InclinationKey;
  readonly direction?: DirectionKey | undefined;
  readonly bounds: OffsetBounds;
};

export type InclinationKey =
  | 'parallelepipedInclinationDeg'
  | 'prismInclinationDeg'
  | 'pyramidInclinationDeg'
  | 'cylinderInclinationDeg'
  | 'coneInclinationDeg';

export type DirectionKey = 'parallelepipedDirectionDeg' | 'prismDirectionDeg' | 'pyramidDirectionDeg';

const planeBounds = (limits: { readonly min: number; readonly max: number }): OffsetBounds => {
  // The direction formula below relies on symmetric component limits.
  if (limits.min !== -limits.max) throw new RangeError('Offset limits must be symmetric about zero.');
  return { type: 'plane', limit: limits.max };
};

export const tiltKeys: Readonly<Record<TiltSolid, TiltKeys>> = {
  parallelepiped: {
    height: 'parallelepipedHeightRatio',
    offsets: ['parallelepipedOffsetXRatio', 'parallelepipedOffsetYRatio'],
    inclination: 'parallelepipedInclinationDeg',
    direction: 'parallelepipedDirectionDeg',
    bounds: planeBounds(OFFSET_LIMITS),
  },
  prism: {
    height: 'prismHeightRatio',
    offsets: ['prismOffsetXRatio', 'prismOffsetYRatio'],
    inclination: 'prismInclinationDeg',
    direction: 'prismDirectionDeg',
    bounds: planeBounds(OFFSET_LIMITS),
  },
  pyramid: {
    height: 'pyramidHeightRatio',
    offsets: ['pyramidApexXRatio', 'pyramidApexYRatio'],
    inclination: 'pyramidInclinationDeg',
    direction: 'pyramidDirectionDeg',
    bounds: planeBounds(APEX_LIMITS),
  },
  cylinder: {
    height: 'cylinderHeightRatio',
    offsets: ['cylinderOffsetRatio'],
    inclination: 'cylinderInclinationDeg',
    bounds: { type: 'axis', limit: ROUND_OFFSET_LIMITS.max },
  },
  cone: {
    height: 'coneHeightRatio',
    offsets: ['coneOffsetRatio'],
    inclination: 'coneInclinationDeg',
    bounds: { type: 'axis', limit: ROUND_OFFSET_LIMITS.max },
  },
};

export const RIGHT_INCLINATION_DEG = 90;
export const DIRECTION_LIMITS = { min: 0, max: 360 } as const;

const RADIANS_PER_DEGREE = Math.PI / 180;

// Offsets computed from angles are rounded to 12 decimals of the reference length: this removes trigonometric noise
// such as 2,0000000000000004 or 6·10⁻¹⁷, so that 45° gives exactly 1 and typed offsets survive a round trip through the
// angles unchanged, while staying far below any printable size (10⁻⁹ mm at 1000 mm).
const OFFSET_DECIMALS = 12;
// Offsets may exceed a limit by this much from roundoff alone when β is exactly at its minimum.
const BOUND_TOLERANCE = 1e-9;

const roundOffset = (value: number): number => Number(value.toFixed(OFFSET_DECIMALS)) + 0;

/** The direction in [0°, 360°): 360° and −90° become 0° and 270°. */
export function normalizeDirection(directionDeg: number): number {
  const remainder = directionDeg % 360;
  const positive = remainder < 0 ? remainder + 360 : remainder;
  // A tiny negative angle rounds up to 360 when shifted; +0 also turns −0 into 0.
  return positive === 360 ? 0 : positive + 0;
}

/** The unit vector of a direction, exact on the axes, so that 90° has X = 0 rather than 6·10⁻¹⁷. */
export function directionVector(directionDeg: number): readonly [number, number] {
  const direction = normalizeDirection(directionDeg);
  switch (direction) {
    case 0:
      return [1, 0];
    case 90:
      return [0, 1];
    case 180:
      return [-1, 0];
    case 270:
      return [0, -1];
    default:
      return [Math.cos(direction * RADIANS_PER_DEGREE), Math.sin(direction * RADIANS_PER_DEGREE)];
  }
}

/**
 * The largest displacement D in a direction that keeps every offset within its limits. For |X| ≤ L and |Y| ≤ L it is
 * min(L/|cos φ|, L/|sin φ|), ignoring a zero component: the ray leaves the square through the side it meets first, so
 * the corners (diagonal offsets) stay reachable.
 */
export function maxDisplacement(bounds: OffsetBounds, directionDeg: number): number {
  if (bounds.type === 'axis') return bounds.limit;
  const components = directionVector(directionDeg).filter((component) => component !== 0);
  return Math.min(...components.map((component) => bounds.limit / Math.abs(component)));
}

/** The smallest inclination that keeps the displacement H / tan β within D_max: atan2(H, D_max), in degrees. */
export const minInclination = (height: number, maxDisplacementRatio: number): number =>
  Math.atan2(height, maxDisplacementRatio) / RADIANS_PER_DEGREE;

/** Rounded up to hundredths, so that typing the displayed minimum gives a valid inclination. */
const ceilHundredth = (value: number): number => Math.ceil(value * 100 - 1e-9) / 100;

/**
 * The inclinations to offer, for the given height and direction. While either is unknown, the least restrictive case
 * stands in: the smallest height and, for polygonal bases, a diagonal direction, which allows the longest displacement.
 */
export function inclinationRange(
  bounds: OffsetBounds,
  height: number | undefined,
  directionDeg: number | undefined,
): { readonly min: number; readonly max: number } {
  const maxRatio =
    directionDeg !== undefined
      ? maxDisplacement(bounds, directionDeg)
      : bounds.type === 'plane'
        ? bounds.limit * Math.SQRT2
        : bounds.limit;
  return { min: ceilHundredth(minInclination(height ?? RATIO_LIMITS.min, maxRatio)), max: RIGHT_INCLINATION_DEG };
}

/**
 * The offsets of an inclination β ∈ (0°, 90°] and a direction φ at the height H, all in units of the reference
 * length: D = H / tan β, X = D cos φ, Y = D sin φ; a circular base takes D itself. 90° is exactly D = 0. Undefined when
 * the offsets would leave their limits.
 */
export function offsetsFromAngles(
  bounds: OffsetBounds,
  height: number,
  inclinationDeg: number,
  directionDeg: number,
): readonly number[] | undefined {
  if (!(inclinationDeg > 0 && inclinationDeg <= RIGHT_INCLINATION_DEG)) return undefined;
  const displacement = inclinationDeg === RIGHT_INCLINATION_DEG ? 0 : height / Math.tan(inclinationDeg * RADIANS_PER_DEGREE);
  const components = bounds.type === 'axis' ? [displacement] : directionVector(directionDeg).map((unit) => displacement * unit);
  const offsets = components.map(roundOffset);
  const lower = bounds.type === 'axis' ? 0 : -bounds.limit;
  if (offsets.some((offset) => offset < lower - BOUND_TOLERANCE || offset > bounds.limit + BOUND_TOLERANCE)) return undefined;
  return offsets.map((offset) => Math.min(bounds.limit, Math.max(lower, offset)));
}

/**
 * The angles that describe the offsets at the height H: D = hypot(X, Y), β = atan2(H, D) and φ = atan2(Y, X) in
 * [0°, 360°). Without a displacement β is 90° and the direction is undefined; otherwise the height is needed.
 */
export function anglesFromOffsets(
  height: number | undefined,
  offsets: readonly number[],
): { readonly inclinationDeg: number; readonly directionDeg: number | undefined } | undefined {
  const [x = 0, y = 0] = offsets;
  const displacement = Math.hypot(x, y);
  if (displacement === 0) return { inclinationDeg: RIGHT_INCLINATION_DEG, directionDeg: undefined };
  if (height === undefined) return undefined;
  return {
    // Below 90° in exact arithmetic; the conversion to degrees may round up by an ulp.
    inclinationDeg: Math.min(RIGHT_INCLINATION_DEG, Math.atan2(height, displacement) / RADIANS_PER_DEGREE),
    directionDeg: normalizeDirection(Math.atan2(y, x) / RADIANS_PER_DEGREE),
  };
}
