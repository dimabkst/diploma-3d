import type { CylinderShape, PhysicalScale, SharedGeneratrixSection } from '@diploma-3d/schema';
import { GeometryError } from '../errors.ts';
import { cross, dot, length, type Vec3 } from '../mesh.ts';
import { cosSinDeg } from '../shapes/angle.ts';
import { roundDimensionsMm } from '../shapes/round.ts';
import { type AxisParallelCut, basePolygon, clippedPolygon, type FrameExtent } from './frame.ts';

/** The fields that fix the planes of a section through a shared generatrix; its connector is no part of them. */
export type LinkedPlanes = Omit<SharedGeneratrixSection, 'type' | 'connector'>;

/** A cutting plane n·x = d, its unit normal pointing to its outer piece, away from the region that all planes bound. */
export interface LinkedPlane {
  readonly normal: Vec3;
  readonly offset: number;
}

/**
 * The planes of a cylinder's section through a shared generatrix, in millimetres with the lower base's centre C at the origin:
 * the points Q0, Q1, Q2 of the lower base's circle where the shared generatrix and the other two meet it, each generatrix
 * Qᵢ + t·a for 0 ≤ t ≤ 1, a the lateral direction from the lower base's centre to the upper one's; the planes, the first two
 * through Q0's generatrix and the third through Q1's and Q2's.
 */
export interface LinkedCylinder {
  readonly axis: Vec3;
  readonly points: readonly [Vec3, Vec3, Vec3];
  readonly planes: readonly LinkedPlane[];
}

const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => times(a, 1 / length(a));
const DEG = Math.PI / 180;

/** v turned about the unit k by the angle, counter-clockwise seen from k's tip: Rodrigues' rotation. */
function turned(v: Vec3, k: Vec3, angleDeg: number): Vec3 {
  const [cos, sin] = cosSinDeg(angleDeg);
  return plus(plus(times(v, cos), times(cross(k, v), sin)), times(k, dot(k, v) * (1 - cos)));
}

/** The angle about the unit k from u to v, both perpendicular to k, in (−180°, 180°]. */
const signedAngle = (u: Vec3, v: Vec3, k: Vec3): number => Math.atan2(dot(k, cross(u, v)), dot(u, v)) / DEG;

/**
 * The cylinder's own frame: the lower base's circle, radius R about the origin in z = 0, and a = (d, 0, H). Q0 lies on the
 * circle at the generatrix's angle; the axial plane through its generatrix holds the axis too, with the normal (C − Q0) × a.
 */
function frameOf(shape: CylinderShape, scale: PhysicalScale, generatrixDeg: number) {
  const { radius, height, offset } = roundDimensionsMm(shape, scale);
  const axis: Vec3 = [offset, 0, height];
  const direction = unit(axis);
  const [cos, sin] = cosSinDeg(generatrixDeg % 360);
  const q0: Vec3 = [radius * cos, radius * sin, 0];
  const reference = unit(cross(times(q0, -1), axis));
  // The tangent plane at Q0's generatrix: its trace on the base is the circle's tangent there.
  const tangent = unit(cross([-sin, cos, 0], axis));
  return { radius, axis, direction, q0, reference, tangent };
}

/**
 * The other point where a plane through Q0's generatrix meets the lower base's circle: its trace through Q0 has the direction
 * u = n × e_z, and the circle |x − C| = R meets the line Q0 + s·u again at s = −2 (Q0 − C)·u / u·u.
 */
function otherPoint(q0: Vec3, normal: Vec3): Vec3 {
  const trace: Vec3 = [normal[1], -normal[0], 0];
  return minus(q0, times(trace, (2 * dot(q0, trace)) / dot(trace, trace)));
}

// Points of the base circle this close, relative to its radius, are one: the planes through them are not fixed.
const DISTINCT_RELATIVE = 1e-6;

/**
 * The planes of the section on this cylinder, from the fields that fix them, so that they keep their relations to it whatever
 * it becomes: n1 the axial plane's normal turned about â by the first plane's angle, n2 = n1 turned by ±α, the dihedral angle,
 * whose planes then meet at exactly α, |n1·n2| = cos α, however the cylinder leans; both hold Q0's generatrix, n·a = 0,
 * n·x = n·Q0. Their traces meet the circle again at Q1 and Q2, and the third plane holds those generatrices, n3 ∝ (Q2 − Q1) × a,
 * n3·x = n3·Q1. Each normal is turned away from the other points: the first two planes' outer pieces lie beyond the chords Q0Q1
 * and Q0Q2, the third's beyond Q1Q2, and the region on the negative side of every plane touches each of them. Throws where
 * two of the points coincide, as at a tangent plane or with no angle between the planes, which fix no section.
 */
export function linkedCylinder(shape: CylinderShape, scale: PhysicalScale, planes: LinkedPlanes): LinkedCylinder {
  const { radius, axis, direction, q0, reference } = frameOf(shape, scale, planes.generatrixDeg);
  const first = turned(reference, direction, planes.firstPlaneDeg);
  const second = turned(first, direction, planes.otherSide ? -planes.dihedralDeg : planes.dihedralDeg);
  const [q1, q2] = [otherPoint(q0, first), otherPoint(q0, second)];
  const distinct = DISTINCT_RELATIVE * radius;
  if (length(minus(q1, q0)) <= distinct || length(minus(q2, q0)) <= distinct || length(minus(q2, q1)) <= distinct) {
    throw new GeometryError('Two of the generatrices coincide: the planes fix no section.');
  }
  // Away from the third point: its sign fixes the orientation, which is never zero for three distinct points of a circle.
  const away = (normal: Vec3, through: Vec3, other: Vec3): LinkedPlane => {
    const oriented = dot(normal, minus(other, through)) < 0 ? normal : times(normal, -1);
    return { normal: oriented, offset: dot(oriented, through) };
  };
  const linked = [away(first, q0, q2), away(second, q0, q1)];
  if (planes.third) linked.push(away(unit(cross(minus(q2, q1), axis)), q1, q0));
  return { axis, points: [q0, q1, q2], planes: linked };
}

/** The parts of a section through a shared generatrix: the middle one, and those beyond the first, second and third plane. */
export type LinkedPart = 'middle' | 'part-1' | 'part-2' | 'part-3';

/**
 * How far each part reaches from each plane it lies against, in millimetres: the outer part beyond a plane, and the middle part,
 * on the negative side of every plane. Every plane holds a, so the parts' horizontal sections are the base's clipped by the
 * planes' traces, read off the actual base polygon: the polygon is inscribed in the circle, so near the tangent plane a plane
 * through a generatrix of the circle cuts the polygon less, or misses it, while it still cuts the round cylinder. Undefined for
 * planes that fix no section, through generatrices that coincide.
 */
export function linkedReaches(
  shape: CylinderShape,
  scale: PhysicalScale,
  planes: LinkedPlanes,
): readonly { readonly part: LinkedPart; readonly reachMm: number }[] | undefined {
  let linked: LinkedCylinder;
  try {
    linked = linkedCylinder(shape, scale, planes);
  } catch {
    return undefined;
  }
  const polygon = basePolygon(roundDimensionsMm(shape, scale).radius).map(([x, y]): Vec3 => [x, y, 0]);
  const inner = linked.planes.reduce((region, plane) => clippedPolygon(region, plane.normal, plane.offset), polygon);
  const outers = linked.planes.map(({ normal, offset }, index) => ({
    part: (['part-1', 'part-2', 'part-3'] as const)[index] as LinkedPart,
    reachMm: Math.max(...polygon.map((point) => dot(normal, point))) - offset,
  }));
  const middle =
    inner.length < 3
      ? 0
      : Math.min(...linked.planes.map(({ normal, offset }) => Math.max(...inner.map((point) => offset - dot(normal, point)))));
  return [{ part: 'middle', reachMm: middle }, ...outers];
}

/**
 * The least reach of a part that the geometry still builds reliably, a thousandth of the radius: a numerical safeguard against
 * slivers of the polygonal solid near the tangent plane and near coincident planes, far below anything printable. Whether a
 * thin part prints is a warning at the export scale, not a limit of the section.
 */
const linkedLeastReachMm = (shape: CylinderShape, scale: PhysicalScale) =>
  LEAST_REACH_RELATIVE * roundDimensionsMm(shape, scale).radius;
const LEAST_REACH_RELATIVE = 1e-3;

/**
 * How far the thinnest part reaches beyond the numerical least, in millimetres; negative where the planes are degenerate: a
 * plane tangent to the cylinder or nearly so, coincident planes, or a part of no volume. Planes through a generatrix cut every
 * other position's interior, so only these positions are refused; see `linkedReaches`.
 */
export function linkedMargin(shape: CylinderShape, scale: PhysicalScale, planes: LinkedPlanes): number {
  const reaches = linkedReaches(shape, scale, planes);
  if (reaches === undefined) return Number.NEGATIVE_INFINITY;
  return Math.min(...reaches.map(({ reachMm }) => reachMm)) - linkedLeastReachMm(shape, scale);
}

/** The thinnest part and its reach from the planes it lies against, for a warning at the export scale; undefined if degenerate. */
export function linkedThinnest(
  shape: CylinderShape,
  scale: PhysicalScale,
  planes: LinkedPlanes,
): { readonly part: LinkedPart; readonly reachMm: number } | undefined {
  const reaches = linkedReaches(shape, scale, planes);
  return reaches?.reduce((least, next) => (next.reachMm < least.reachMm ? next : least));
}

/**
 * The first plane's angle at which it is the tangent plane at the generatrix, which holds no more of the cylinder than the
 * generatrix, turned from the axial plane, 0°, within (0°, 180°]; the planes repeat every 180°. For a right cylinder, 90°; a
 * lean moves it.
 */
function tangentAngle(shape: CylinderShape, scale: PhysicalScale, generatrixDeg: number): number {
  const { reference, tangent, direction } = frameOf(shape, scale, generatrixDeg);
  const limit = signedAngle(reference, tangent, direction);
  return limit <= 0 ? limit + 180 : limit;
}

/** The first plane's angles that are planes at all, between the tangent plane and itself turned a half turn. */
export function linkedFirstPlaneDomain(shape: CylinderShape, scale: PhysicalScale, generatrixDeg: number): FrameExtent {
  const limit = tangentAngle(shape, scale, generatrixDeg);
  return { min: limit - 180, max: limit };
}

/** The fields of the section that a control sets, each on a scale that stays as the other fields change. */
export type LinkedField = 'generatrix' | 'pair' | 'dihedral';

/**
 * The fixed scale of each field: the generatrix around the base, the pair's turn from the axial plane over a half turn, as the
 * planes repeat every 180°, and the smaller dihedral angle.
 */
export const LINKED_FIELD_DOMAINS: Readonly<Record<LinkedField, FrameExtent>> = {
  generatrix: { min: 0, max: 360 },
  pair: { min: -90, max: 90 },
  dihedral: { min: 0, max: 90 },
};

/**
 * A field's usable values on its fixed scale, the others as they are: the scale less the stretches about the degenerate
 * positions, each an open gap whose ends are usable, and those at the scale's ends cut off it. A plane is degenerate where it
 * is tangent, (ψ − T) ≡ 0 mod 180° for the first plane's turn ψ and the tangent plane's angle T, (ψ ± α − T) ≡ 0 for the second
 * plane, or where the planes coincide, α → 0. The gaps' ends follow from the actual polygonal solid by bisection, so that the
 * numerical least of `linkedMargin` holds just there and nothing beyond it is cut away. Null where no value is usable.
 */
export function linkedFieldScale(
  shape: CylinderShape,
  scale: PhysicalScale,
  planes: LinkedPlanes,
  field: LinkedField,
): { readonly min: number; readonly max: number; readonly gaps: readonly FrameExtent[] } | null {
  const domain = LINKED_FIELD_DOMAINS[field];
  const at = (value: number): LinkedPlanes =>
    field === 'generatrix'
      ? { ...planes, generatrixDeg: ((value % 360) + 360) % 360 }
      : field === 'pair'
        ? { ...planes, firstPlaneDeg: value }
        : { ...planes, dihedralDeg: value };
  const usable = (value: number) => linkedMargin(shape, scale, at(value)) >= 0;
  const turn = planes.otherSide ? -planes.dihedralDeg : planes.dihedralDeg;
  const centres = degenerateCentres(shape, scale, planes, field, turn);
  const gaps: FrameExtent[] = [];
  for (const centre of centres) {
    if (centre < domain.min - GAP_SEARCH_DEG || centre > domain.max + GAP_SEARCH_DEG) continue;
    const gap = gapAround(usable, centre, domain);
    if (gap !== undefined) gaps.push(gap);
  }
  gaps.sort((a, b) => a.min - b.min);
  const merged: FrameExtent[] = [];
  for (const gap of gaps) {
    const last = merged.at(-1);
    if (last !== undefined && gap.min <= last.max)
      merged[merged.length - 1] = { min: last.min, max: Math.max(last.max, gap.max) };
    else merged.push(gap);
  }
  let [min, max] = [domain.min, domain.max];
  const inner: FrameExtent[] = [];
  for (const gap of merged) {
    if (gap.min <= min) min = Math.max(min, gap.max);
    else if (gap.max >= max) max = Math.min(max, gap.min);
    else inner.push(gap);
  }
  if (min > max || !usable(min) || !usable(max)) return null;
  return { min, max, gaps: inner.filter((gap) => gap.min > min && gap.max < max) };
}

/** How far from a degenerate position a gap's end is searched, and how precisely it is found, in degrees. */
const GAP_SEARCH_DEG = 30;
const GAP_PRECISION_DEG = 1e-4;

/**
 * The stretch of unusable values about a degenerate position, its ends the nearest usable values, clipped to the scale; undefined
 * where the position itself is usable, as the polygon happens to allow.
 */
function gapAround(usable: (value: number) => boolean, centre: number, { min, max }: FrameExtent): FrameExtent | undefined {
  const clipped = Math.min(max, Math.max(min, centre));
  if (usable(clipped)) return undefined;
  // The nearest usable value on one side, or the scale's end where the stretch reaches it.
  const edge = (direction: 1 | -1): number => {
    const end = direction > 0 ? max : min;
    let bad = clipped;
    let good: number | undefined;
    for (let step = 0.01; step <= GAP_SEARCH_DEG; step *= 2) {
      const next = clipped + direction * step;
      if (direction > 0 ? next >= max : next <= min) break;
      if (usable(next)) {
        good = next;
        break;
      }
      bad = next;
    }
    if (good === undefined) return end;
    let found: number = good;
    while (Math.abs(found - bad) > GAP_PRECISION_DEG) {
      const middle: number = (found + bad) / 2;
      if (usable(middle)) found = middle;
      else bad = middle;
    }
    return found;
  };
  return { min: edge(-1), max: edge(1) };
}

/**
 * The values of a field at which a plane is tangent or the planes coincide, the others as they are, in its scale's terms; see
 * `linkedFieldScale`. The pair's turn and the dihedral angle follow from T directly; the generatrix moves T itself on an oblique
 * cylinder, and its positions are found where T − target changes sign, sampled every degree and refined by bisection.
 */
function degenerateCentres(
  shape: CylinderShape,
  scale: PhysicalScale,
  planes: LinkedPlanes,
  field: LinkedField,
  turn: number,
): number[] {
  const wrapped = (angle: number) => ((((angle + 90) % 180) + 180) % 180) - 90;
  if (field === 'pair') {
    const tangent = tangentAngle(shape, scale, planes.generatrixDeg);
    return [tangent, tangent - turn].flatMap((centre) => {
      const base = wrapped(centre);
      return [base - 180, base, base + 180];
    });
  }
  if (field === 'dihedral') {
    const tangent = tangentAngle(shape, scale, planes.generatrixDeg);
    // ψ ± α ≡ T: α ≡ ±(T − ψ) mod 180°, within the scale.
    const sign = planes.otherSide ? -1 : 1;
    const base = (((sign * (tangent - planes.firstPlaneDeg)) % 180) + 180) % 180;
    return [0, base, base - 180, base + 180];
  }
  const offsets = [0, turn];
  const centres: number[] = [];
  for (const offset of offsets) {
    const difference = (generatrixDeg: number) =>
      wrapped(tangentAngle(shape, scale, generatrixDeg) - planes.firstPlaneDeg - offset);
    for (let deg = 0; deg < 360; deg += 1) {
      const [a, b] = [difference(deg), difference(deg + 1)];
      // A sign change through zero, not the jump of the wrapping at ±90°.
      if (a === 0) centres.push(deg);
      if (a * b >= 0 || Math.abs(a - b) > 90) continue;
      let [low, high] = [deg, deg + 1];
      while (high - low > GAP_PRECISION_DEG) {
        const middle = (low + high) / 2;
        if (difference(middle) * a > 0) low = middle;
        else high = middle;
      }
      centres.push((low + high) / 2);
    }
  }
  return centres.flatMap((centre) => [centre, centre - 360, centre + 360]);
}

/**
 * Whether the other second plane, turned from the first the other way about the shared generatrix by the same angle, is offered:
 * a different plane below 90°, where both ways are one plane, and a usable one.
 */
export function linkedAlternativeUsable(shape: CylinderShape, scale: PhysicalScale, planes: LinkedPlanes): boolean {
  if (planes.dihedralDeg >= 90 - SAME_PLANE_DEG) return false;
  return linkedMargin(shape, scale, { ...planes, otherSide: !planes.otherSide }) >= 0;
}

// Below this, in degrees from 90°, both second planes are one plane to every displayed precision.
const SAME_PLANE_DEG = 1e-9;

/**
 * The fields of the planes through the generatrices at the generatrix's angle and 120° and 240° on from it, as this cylinder
 * makes them: the first plane through the second generatrix, the second through the third. A right cylinder's planes are 60°
 * apart, and turned 30° from the axial plane, its third plane makes an equilateral prism; a lean changes the angles, which are
 * read off the actual planes.
 */
export function linkedStart(shape: CylinderShape, scale: PhysicalScale, generatrixDeg: number): LinkedPlanes {
  const { radius, axis, direction, q0, reference } = frameOf(shape, scale, generatrixDeg);
  const at = (deg: number): Vec3 => {
    const [cos, sin] = cosSinDeg((generatrixDeg + deg) % 360);
    return [radius * cos, radius * sin, 0];
  };
  const first = unit(cross(minus(at(120), q0), axis));
  const second = unit(cross(minus(at(240), q0), axis));
  // On the pair's fixed scale, (−90°, 90°], where the planes repeat every 180°.
  let firstPlaneDeg = signedAngle(reference, first, direction);
  while (firstPlaneDeg <= -90) firstPlaneDeg += 180;
  while (firstPlaneDeg > 90) firstPlaneDeg -= 180;
  // The planes repeat every 180°: the turn from the first to the second, within (−90°, 90°], is ±α.
  let turn = signedAngle(first, second, direction);
  if (turn > 90) turn -= 180;
  if (turn <= -90) turn += 180;
  return { generatrixDeg, firstPlaneDeg, dihedralDeg: Math.abs(turn), otherSide: turn < 0, third: false };
}

/**
 * A plane of the section as the cylinder's plane parallel to its axis, see `axisParallelCylinderSection`, so that its section,
 * frame and connectors are those: its base-plane line, through Q0 or Q1, along l with n = l × a pointing as the plane's normal,
 * and that line's offset along w = (cos ψ, sin ψ, 0) from the base's centre. The other planes bound the region on the negative
 * side, the part between the planes, which a connector at this plane must keep its walls from.
 */
export function linkedPlaneCut(shape: CylinderShape, scale: PhysicalScale, planes: LinkedPlanes, index: number): AxisParallelCut {
  const linked = linkedCylinder(shape, scale, planes);
  const plane = linked.planes[index];
  if (plane === undefined) throw new GeometryError(`The section has no plane ${index + 1}.`);
  // l = (−sin ψ, cos ψ, 0) with l × a along n: the base trace n × e_z points along l × a's own n, and ψ follows from it.
  const trace: Vec3 = [plane.normal[1], -plane.normal[0], 0];
  const along = dot(cross(trace, linked.axis), plane.normal) > 0 ? trace : times(trace, -1);
  const directionDeg = Math.atan2(-along[0], along[1]) / DEG;
  const w: Vec3 = [Math.cos(directionDeg * DEG), Math.sin(directionDeg * DEG), 0];
  const through = index < 2 ? linked.points[0] : linked.points[1];
  const { radius } = roundDimensionsMm(shape, scale);
  return {
    offsetPercent: (100 * dot(through, w)) / radius,
    offsetDirectionDeg: (directionDeg + 360) % 360,
    bounds: linked.planes.filter((_, other) => other !== index),
  };
}
