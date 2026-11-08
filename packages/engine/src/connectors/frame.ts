import { type CylinderShape, type PhysicalScale, SECTION_POSITION_LIMITS, type Section } from '@diploma-3d/schema';
import type { Mat4 } from 'manifold-3d';
import { GeometryError } from '../errors.ts';
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

/** What every cut of a cylinder tells its connectors, in the millimetres of the built solid. */
interface CutGeometry {
  readonly frame: SectionFrame;
  /** The base circle's radius r, and the inscribed radius r·cos(π/N) of the polygon that approximates it. */
  readonly radius: number;
  readonly inradius: number;
  /** The section's extent along u, which a dovetail's length and a pair's spacing are given in percent of. */
  readonly span: number;
  /** The solid's extent along n, within which any connector must stay. */
  readonly depthExtent: number;
}

/** A cylinder's cut parallel to its bases: the lower part lies under the plane, the upper part above it. */
export interface ParallelCylinderSection extends CutGeometry {
  readonly type: 'parallel-to-bases';
  /** The thickness of each part along n: t·H below the cut and (1 − t)·H above it. */
  readonly lowerThickness: number;
  readonly upperThickness: number;
  /**
   * How far each horizontal section of an oblique cylinder moves along v per millimetre along n: the lean d/H across
   * the frame. Sections above the cut move one way, sections below it the other.
   */
  readonly leanAcross: number;
}

/**
 * A cylinder's vertical cut at the plane n·(p − C0) = offset: part A lies on the negative side of the normal, part B on
 * the positive one. The section is the parallelogram of `contour`, and `frame.origin` its area centroid. Here u is +Z
 * and n is horizontal, so the connectors' axes and a dovetail's tongue leave the plane sideways.
 */
export interface VerticalCylinderSection extends CutGeometry {
  readonly type: 'vertical';
  /** The signed distance of the plane from the axis along n, in millimetres. */
  readonly offset: number;
  /** H, the distance between the bases, which are the planes z = 0 and z = H. */
  readonly height: number;
  /** How far a horizontal section moves per millimetre of height, d/H, along the horizontal direction of the lean. */
  readonly lean: number;
  /** √(1 + lean²): how much a length across a circle in the plane is stretched when seen in the horizontal sections. */
  readonly stretch: number;
  /** The actual polygonal solid's section: the corners of its bottom edge at z = 0 and of its top edge at z = H. */
  readonly contour: readonly [Vec3, Vec3, Vec3, Vec3];
  /** The plane itself: its unit normal, and the distance of the plane along it from the world's origin. */
  readonly plane: { readonly normal: Vec3; readonly offset: number };
}

export type CylinderSection = ParallelCylinderSection | VerticalCylinderSection;

/** A vertical cut's position: the signed distance from the axis in percent of the radius. */
export interface VerticalCut {
  readonly offsetPercent: number;
}

/** Where a cylinder is cut: a plane parallel to the bases at this percentage of the height, or a vertical plane. */
export type CylinderCut = number | VerticalCut;

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
export function cylinderSection(shape: CylinderShape, scale: PhysicalScale, positionPercent: number): ParallelCylinderSection {
  const { radius, height, offset: d } = roundDimensionsMm(shape, scale);
  const t = positionPercent / 100;
  const n: Vec3 = [0, 0, 1];
  const u: Vec3 = d === 0 ? [0, 1, 0] : normalised(cross(n, [d, 0, 0]));
  const v = cross(u, n);
  return {
    type: 'parallel-to-bases',
    frame: { origin: [t * d, 0, t * height], u, v, n },
    radius,
    inradius: radius * Math.cos(Math.PI / circularSegments(radius)),
    span: 2 * radius,
    depthExtent: height,
    lowerThickness: t * height,
    upperThickness: (1 - t) * height,
    leanAcross: Math.abs((d / height) * v[0]),
  };
}

/** The base polygon's vertices as manifold-3d builds them: on the circle, the first on +X. */
function basePolygon(radius: number): [number, number][] {
  const segments = circularSegments(radius);
  return Array.from({ length: segments }, (_, index) => {
    const angle = (2 * Math.PI * index) / segments;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

/** How far the polygon reaches from its centre on the negative and positive sides of Y: the actual solid's extent. */
function polygonReach(radius: number): { readonly negative: number; readonly positive: number } {
  const ys = basePolygon(radius).map(([, y]) => y);
  return { negative: -Math.min(...ys), positive: Math.max(...ys) };
}

/** Where the polygon's boundary crosses the line at this Y, from its smallest to its largest X. */
function polygonChord(radius: number, y: number): { readonly min: number; readonly max: number } {
  const polygon = basePolygon(radius);
  let [min, max] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  polygon.forEach(([x0, y0], index) => {
    const [x1, y1] = polygon[(index + 1) % polygon.length] as [number, number];
    if ((y0 - y) * (y1 - y) > 0 || y0 === y1) return;
    const crossing = x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
    min = Math.min(min, crossing);
    max = Math.max(max, crossing);
  });
  return { min, max };
}

/**
 * A vertical plane's signed distance from the axis in millimetres, for its percentage of the base circle's radius after
 * the uniform physical scaling: not half of the oblique solid's bounding box, nor half of the section's chord.
 */
export const sectionOffsetMm = (offsetPercent: number, radiusMm: number): number => (offsetPercent / 100) * radiusMm;

/** The inverse of `sectionOffsetMm`. */
export const sectionOffsetPercent = (offsetMm: number, radiusMm: number): number => (100 * offsetMm) / radiusMm;

/**
 * The largest distance of a vertical cut from the axis: the thinner part keeps the share of the solid's extent across
 * the plane that a parallel cut keeps of its height, SECTION_POSITION_LIMITS.min, and at least one minimum wall, which
 * excludes tangent cuts and slivers. Only zero remains for a solid too small for that wall. An application restriction
 * like the parallel cut's: it does not make every thin part printable.
 */
export function verticalOffsetLimitMm(shape: CylinderShape, scale: PhysicalScale): number {
  const { radius } = roundDimensionsMm(shape, scale);
  const reach = polygonReach(radius);
  const extent = reach.negative + reach.positive;
  const thinnest = (SECTION_POSITION_LIMITS.min / 100) * extent;
  return Math.max(0, Math.min(reach.negative, reach.positive) - Math.max(thinnest, CONNECTOR_MIN_WALL_MM));
}

/** `verticalOffsetLimitMm` in percent of the radius, as the specification and the interface give the distance. */
export function verticalOffsetLimitPercent(shape: CylinderShape, scale: PhysicalScale): number {
  return sectionOffsetPercent(verticalOffsetLimitMm(shape, scale), roundDimensionsMm(shape, scale).radius);
}

/**
 * The vertical cut, with u = (0, 0, 1) and v the horizontal direction of the axis a = C1 − C0, or +X for a right
 * cylinder, whose axis has none: n = u × v is horizontal and perpendicular to a, so the plane n·(p − C0) = offset is
 * parallel to the axis and contains all of it at offset 0. Cylinders here lean towards +X, so n is +Y for every one.
 *
 * Every horizontal section is the base polygon moved by lean·z along X, so the plane meets the solid in a parallelogram
 * from the polygon's own chord at y = offset; its centroid lies halfway up, halfway along that chord's sheared centre.
 * The frame has u along +Z; v = u × n completes it.
 */
export function verticalCylinderSection(
  shape: CylinderShape,
  scale: PhysicalScale,
  offsetPercent: number,
): VerticalCylinderSection {
  const { radius, height, offset: d } = roundDimensionsMm(shape, scale);
  const up: Vec3 = [0, 0, 1];
  const across: Vec3 = d === 0 ? [1, 0, 0] : normalised([d, 0, 0]);
  const n = normalised(cross(up, across));
  const offset = sectionOffsetMm(offsetPercent, radius);
  const chord = polygonChord(radius, offset);
  if (!(chord.min < chord.max)) throw new GeometryError(`The vertical plane at ${offset} mm misses the cylinder.`);
  const lean = d / height;
  return {
    type: 'vertical',
    frame: { origin: [(chord.min + chord.max + d) / 2, offset, height / 2], u: up, v: cross(up, n), n },
    radius,
    inradius: radius * Math.cos(Math.PI / circularSegments(radius)),
    span: height,
    depthExtent: 2 * radius,
    offset,
    height,
    lean,
    stretch: Math.hypot(1, lean),
    contour: [
      [chord.min, offset, 0],
      [chord.max, offset, 0],
      [chord.max + d, offset, height],
      [chord.min + d, offset, height],
    ],
    plane: { normal: n, offset },
  };
}

/** Where the specification's section cuts the cylinder. */
export const cutOfSection = (section: Section): CylinderCut =>
  section.type === 'vertical' ? { offsetPercent: section.offsetPercent } : section.positionPercent;

/** The geometry of the cut. */
export const cylinderCut = (shape: CylinderShape, scale: PhysicalScale, cut: CylinderCut): CylinderSection =>
  typeof cut === 'number' ? cylinderSection(shape, scale, cut) : verticalCylinderSection(shape, scale, cut.offsetPercent);

/**
 * The shortest distance from a point of an ellipse's interior to its boundary, for the semi-axes major ≥ minor and the
 * point's non-negative coordinates along them. The nearest boundary point solves
 * F(s) = (major·p/(s + major²))² + (minor·q/(s + minor²))² − 1 = 0 for s > −minor²; F is convex and decreasing there,
 * and non-negative at s = −minor² + minor·q, so Newton's method converges from that start without overshooting
 * (Eberly, "Distance from a Point to an Ellipse").
 */
function distanceInsideEllipse(major: number, minor: number, p: number, q: number): number {
  if (q === 0) {
    const inner = major * p;
    const difference = major ** 2 - minor ** 2;
    if (inner >= difference) return major - p;
    const along = inner / difference;
    return Math.hypot(major * along - p, minor * Math.sqrt(1 - along ** 2));
  }
  let s = -(minor ** 2) + minor * q;
  for (let step = 0; step < 64; step += 1) {
    const [a, b] = [major * p, minor * q];
    const [ra, rb] = [a / (s + major ** 2), b / (s + minor ** 2)];
    const value = ra ** 2 + rb ** 2 - 1;
    if (value <= 1e-15) break;
    s += value / (2 * (ra ** 2 / (s + major ** 2) + rb ** 2 / (s + minor ** 2)));
  }
  return Math.hypot((major ** 2 * p) / (s + major ** 2) - p, (minor ** 2 * q) / (s + minor ** 2) - q);
}

/**
 * The true wall between a point and the lateral surface of a vertical cut's cylinder: the Euclidean distance, for a
 * point `reach` millimetres from the axis along the lean within its horizontal section, at `y` from the axis along n;
 * negative outside. The surface is measured on the polygon's inscribed cylinder, which the polygon contains. That
 * cylinder is oblique, so its section perpendicular to the axis is an ellipse with the semi-axes R along n and R/stretch
 * along the lean, and the distance is the one from the point's projection to that ellipse. A horizontal measure would
 * overstate the wall by up to the stretch.
 *
 * The distance to the complement of a convex body is concave and, here, even in both coordinates, so it never rises
 * with |reach| or |y|. A straight or conical piece of a cavity is convex, so if its end circles and corners keep a wall,
 * all of it does. A circle of radius ρ in a plane y = const projects to a segment, reaching ρ·stretch in `reach`.
 */
export function lateralWall({ inradius, stretch }: VerticalCylinderSection, reach: number, y: number): number {
  const [across, along] = [Math.abs(reach), Math.abs(y)];
  const horizontal = inradius - Math.hypot(across, along);
  if (stretch === 1) return horizontal;
  if (horizontal <= 0) return horizontal / stretch;
  return distanceInsideEllipse(inradius, inradius / stretch, along, across / stretch);
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

/**
 * A numerical tolerance, not a manufacturing allowance: a measured value within this many millimetres below its
 * minimum differs from it by floating-point roundoff of the decimal settings only, and satisfies it.
 */
export const CONSTRAINT_ROUNDOFF_MM = 1e-9;

/** A construction constraint at given dimensions: a measured value and the least value it may take, in millimetres. */
export interface Measurement {
  readonly valueMm: number;
  readonly minimumMm: number;
}

/** Whether the measured value reaches its minimum; NaN never does. */
export const satisfies = ({ valueMm, minimumMm }: Measurement): boolean => valueMm >= minimumMm - CONSTRAINT_ROUNDOFF_MM;

/** Below this volume, in mm³ for M = 80 mm and scaled with M³, an intersection is Boolean roundoff, not contact. */
const VOLUME_TOLERANCE_AT_80_MM = 1e-3;

export const connectorVolumeTolerance = (longestDimensionMm: number): number =>
  VOLUME_TOLERANCE_AT_80_MM * (longestDimensionMm / 80) ** 3;
