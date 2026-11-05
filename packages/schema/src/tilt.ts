import type { Shape } from './model.ts';

/**
 * The flattest supported lean: the angle β between the base plane and the solid's reference line, which runs from the
 * lower to the upper base along a prism's lateral edge or between a cylinder's base centres, and from the base's area
 * centroid (a circle's centre) to a pyramid's or cone's apex. A practical application limit, like the ratio limits.
 */
export const MIN_INCLINATION_DEG = 15;

/** The inclination of every control: from MIN_INCLINATION_DEG to a right solid at 90°. */
export const INCLINATION_LIMITS = { min: MIN_INCLINATION_DEG, max: 90 } as const;

const TAN_MIN_INCLINATION = Math.tan((MIN_INCLINATION_DEG * Math.PI) / 180);

// Roundoff allowance for values converted between angles and offsets, in units of the reference length; far below any
// printable size.
const DISPLACEMENT_TOLERANCE = 1e-9;

/**
 * The largest horizontal displacement D = hypot(X, Y) at the height h: β = atan2(h, D) ≥ 15° is D ≤ h / tan 15°. It
 * limits the total displacement, so it is the same in every direction.
 */
export const maxTiltDisplacement = (height: number): number => height / TAN_MIN_INCLINATION;

/** Whether the displacement keeps β ≥ MIN_INCLINATION_DEG at the height, up to roundoff. */
export const isWithinMinimumInclination = (height: number, displacement: number): boolean =>
  displacement <= maxTiltDisplacement(height) + DISPLACEMENT_TOLERANCE;

/** The height and total displacement of a tilted solid; undefined for solids without a displacement. */
export function tiltOf(shape: Shape): { readonly height: number; readonly displacement: number } | undefined {
  switch (shape.kind) {
    case 'parallelepiped':
    case 'prism':
      return { height: shape.heightRatio, displacement: Math.hypot(shape.offsetXRatio, shape.offsetYRatio) };
    case 'pyramid':
      return { height: shape.heightRatio, displacement: Math.hypot(shape.apexXRatio, shape.apexYRatio) };
    case 'cylinder':
    case 'cone':
      return { height: shape.heightRatio, displacement: shape.offsetRatio };
    default:
      return undefined;
  }
}
