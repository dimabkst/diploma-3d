import { INCLINATION_LIMITS, maxTiltDisplacement, ROUND_OFFSET_LIMITS, TILT_OFFSET_LIMITS } from '@diploma-3d/schema';
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

/** Fields that are validated on their own, unlike an inclination, which is checked together with the solid. */
type IndependentKey = Exclude<ParameterKey, InclinationKey>;

export type TiltKeys = {
  readonly height: IndependentKey;
  /** [X, Y] for polygonal bases, [d] for circular ones, whose displacement keeps the canonical direction +X. */
  readonly offsets: readonly [IndependentKey] | readonly [IndependentKey, IndependentKey];
  readonly inclination: InclinationKey;
  readonly direction?: DirectionKey | undefined;
};

export type InclinationKey =
  | 'parallelepipedInclinationDeg'
  | 'prismInclinationDeg'
  | 'pyramidInclinationDeg'
  | 'cylinderInclinationDeg'
  | 'coneInclinationDeg';

export type DirectionKey = 'parallelepipedDirectionDeg' | 'prismDirectionDeg' | 'pyramidDirectionDeg';

export const tiltKeys: Readonly<Record<TiltSolid, TiltKeys>> = {
  parallelepiped: {
    height: 'parallelepipedHeightRatio',
    offsets: ['parallelepipedOffsetXRatio', 'parallelepipedOffsetYRatio'],
    inclination: 'parallelepipedInclinationDeg',
    direction: 'parallelepipedDirectionDeg',
  },
  prism: {
    height: 'prismHeightRatio',
    offsets: ['prismOffsetXRatio', 'prismOffsetYRatio'],
    inclination: 'prismInclinationDeg',
    direction: 'prismDirectionDeg',
  },
  pyramid: {
    height: 'pyramidHeightRatio',
    offsets: ['pyramidApexXRatio', 'pyramidApexYRatio'],
    inclination: 'pyramidInclinationDeg',
    direction: 'pyramidDirectionDeg',
  },
  cylinder: {
    height: 'cylinderHeightRatio',
    offsets: ['cylinderOffsetRatio'],
    inclination: 'cylinderInclinationDeg',
  },
  cone: {
    height: 'coneHeightRatio',
    offsets: ['coneOffsetRatio'],
    inclination: 'coneInclinationDeg',
  },
};

export const RIGHT_INCLINATION_DEG = INCLINATION_LIMITS.max;

/** The direction φ, counterclockwise from +X as seen from +Z; 360° is the same as 0°. */
export const DIRECTION_LIMITS = { min: 0, max: 360 } as const;

// Roundoff allowance for values converted between angles and offsets: 10⁻⁹ of a degree or of the reference length.
const TOLERANCE = 1e-9;

/** Whether β is an allowed inclination, 15° ≤ β ≤ 90°, up to the roundoff of an angle computed from offsets. */
export const isInclination = (inclinationDeg: number): boolean =>
  inclinationDeg >= INCLINATION_LIMITS.min - TOLERANCE && inclinationDeg <= INCLINATION_LIMITS.max;

/** The limits of each offset: X and Y of a polygonal base, or d of a circular one, which only moves along +X. */
const componentLimits = (circular: boolean) => (circular ? ROUND_OFFSET_LIMITS : TILT_OFFSET_LIMITS);

/**
 * Bounds rounded inwards, so that every value a slider or button reaches, and every bound an error message names, is
 * allowed; a typed value between the rounded and the exact bound is allowed too.
 */
const roundUp = (value: number, decimals: number) => Math.ceil(value * 10 ** decimals - TOLERANCE) / 10 ** decimals;
const roundDown = (value: number, decimals: number) => Math.floor(value * 10 ** decimals + TOLERANCE) / 10 ** decimals;

/**
 * The inclinations allowed at the height h and the direction φ: at least 15°, and steep enough that the offsets stay
 * within their limits. Along φ the square |X|, |Y| ≤ 4 is left at D = min(4/|cos φ|, 4/|sin φ|), ignoring a zero
 * component, so β ≥ atan2(h, D); a circular base allows d ≤ 4 along +X. Without the height or direction, 15°…90°.
 */
export function inclinationRange(
  circular: boolean,
  height: number | undefined,
  directionDeg: number | undefined,
): { readonly min: number; readonly max: number } {
  if (height === undefined || directionDeg === undefined) return INCLINATION_LIMITS;
  const limit = componentLimits(circular).max;
  const reach = circular
    ? limit
    : Math.min(
        ...directionVector(directionDeg)
          .filter((unit) => unit !== 0)
          .map((unit) => limit / Math.abs(unit)),
      );
  const steepest = Math.atan2(height, reach) / RADIANS_PER_DEGREE;
  return { min: Math.max(INCLINATION_LIMITS.min, roundUp(steepest, 2)), max: INCLINATION_LIMITS.max };
}

/**
 * The values allowed for one offset at the height h, given the other offset of a polygonal base: within its own limits
 * and with D = hypot(X, Y) ≤ h / tan 15°, that is |X| ≤ √(D_max² − Y²). Without the height, the offset's own limits;
 * without the other offset, as if it were zero.
 */
export function offsetRange(
  circular: boolean,
  height: number | undefined,
  other: number | undefined,
): { readonly min: number; readonly max: number } {
  const limits = componentLimits(circular);
  if (height === undefined) return limits;
  const reach = Math.sqrt(Math.max(0, maxTiltDisplacement(height) ** 2 - (other ?? 0) ** 2));
  const max = Math.min(limits.max, roundDown(reach, 3));
  return { min: circular ? limits.min : -max, max };
}

const RADIANS_PER_DEGREE = Math.PI / 180;

// Offsets computed from angles are rounded to 12 decimals of the reference length: this removes trigonometric noise
// such as 2,0000000000000004 or 6·10⁻¹⁷, so that 45° gives exactly 1 and typed offsets survive a round trip through the
// angles unchanged, while staying far below any printable size (10⁻⁹ mm at 1000 mm).
const OFFSET_DECIMALS = 12;

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
 * The offsets of an inclination β and a direction φ at the height H, all in units of the reference length:
 * D = H / tan β, X = D cos φ, Y = D sin φ; a circular base takes D itself. 90° is exactly D = 0. Undefined for an
 * inclination outside 15°…90° or offsets beyond their limits; values within roundoff of a limit are set to it.
 */
export function offsetsFromAngles(
  circular: boolean,
  height: number,
  inclinationDeg: number,
  directionDeg: number,
): readonly number[] | undefined {
  if (!isInclination(inclinationDeg)) return undefined;
  const displacement = inclinationDeg === RIGHT_INCLINATION_DEG ? 0 : height / Math.tan(inclinationDeg * RADIANS_PER_DEGREE);
  const components = circular ? [displacement] : directionVector(directionDeg).map((unit) => displacement * unit);
  const offsets = components.map(roundOffset);
  const { min, max } = componentLimits(circular);
  if (!offsets.every((offset) => offset >= min - TOLERANCE && offset <= max + TOLERANCE)) return undefined;
  return offsets.map((offset) => Math.min(max, Math.max(min, offset)));
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
