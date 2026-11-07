import type { CylinderShape, PhysicalScale } from '@diploma-3d/schema';
import type { Mat4 } from 'manifold-3d';
import { cross, length, type Vec3 } from '../mesh.ts';
import { circularSegments, roundDimensionsMm } from '../shapes/round.ts';

/**
 * An orthonormal frame at the centre of the section: n is the cut's normal from the lower part into the upper one, u
 * a direction in the cut, and v = u × n across it.
 */
export interface SectionFrame {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

/** A cylinder's cut parallel to its bases, in the millimetres of the built solid. */
export interface CylinderSection {
  readonly frame: SectionFrame;
  /** The base circle's radius r, and the inscribed radius r·cos(π/N) of the polygon that approximates it. */
  readonly radius: number;
  readonly inradius: number;
  /** The thickness of each part along n: t·H below the cut and (1 − t)·H above it. */
  readonly lowerThickness: number;
  readonly upperThickness: number;
  /**
   * How far each horizontal section of an oblique cylinder moves along v per millimetre along n: the lean d/H across
   * the frame. Sections above the cut move one way, sections below it the other.
   */
  readonly leanAcross: number;
}

const normalised = (a: Vec3): Vec3 => {
  const norm = length(a);
  return [a[0] / norm, a[1] / norm, a[2] / norm];
};

/**
 * The section of the cylinder (lower base centred at the origin in z = 0, upper base displaced by d along X) at
 * t = positionPercent/100: its centre is (t·d, 0, t·H), the base centre moved by t times the displacement. u is
 * perpendicular to the lean, so that the lean only moves sections across u; a right cylinder has no lean and takes the
 * same +Y, which keeps the frame deterministic.
 */
export function cylinderSection(shape: CylinderShape, scale: PhysicalScale, positionPercent: number): CylinderSection {
  const { radius, height, offset: d } = roundDimensionsMm(shape, scale);
  const t = positionPercent / 100;
  const n: Vec3 = [0, 0, 1];
  const u: Vec3 = d === 0 ? [0, 1, 0] : normalised(cross(n, [d, 0, 0]));
  const v = cross(u, n);
  return {
    frame: { origin: [t * d, 0, t * height], u, v, n },
    radius,
    inradius: radius * Math.cos(Math.PI / circularSegments(radius)),
    lowerThickness: t * height,
    upperThickness: (1 - t) * height,
    leanAcross: Math.abs((d / height) * v[0]),
  };
}

/** The point at (along u, across v, along n) in the frame. */
export function framePoint({ origin, u, v, n }: SectionFrame, [along, across, normal]: Vec3): Vec3 {
  return [0, 1, 2].map(
    (axis) =>
      (origin[axis] as number) + along * (u[axis] as number) + across * (v[axis] as number) + normal * (n[axis] as number),
  ) as unknown as Vec3;
}

/**
 * manifold-3d's column-major matrix that takes local (x, y, z) to the frame: x along v, y along u and z along n, from
 * `centre`. The columns v, u, n have determinant v·(u × n) = v·v = 1, a proper rotation.
 */
export function frameMatrix({ u, v, n }: SectionFrame, centre: Vec3): Mat4 {
  return [...v, 0, ...u, 0, ...n, 0, ...centre, 1] as Mat4;
}

/**
 * The thinnest load-bearing wall any connector may leave in a part, for first trials with a 0,4 mm nozzle: three line
 * widths. An experimental threshold, not a strength guarantee.
 */
export const CONNECTOR_MIN_WALL_MM = 1.2;

/** Below this volume, in mm³ for M = 80 mm and scaled with M³, an intersection is Boolean roundoff, not contact. */
const VOLUME_TOLERANCE_AT_80_MM = 1e-3;

export const connectorVolumeTolerance = (longestDimensionMm: number): number =>
  VOLUME_TOLERANCE_AT_80_MM * (longestDimensionMm / 80) ** 3;
