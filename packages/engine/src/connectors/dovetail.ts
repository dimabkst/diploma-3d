import type { CylinderShape, DovetailConnector, PhysicalScale } from '@diploma-3d/schema';
import type { Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import { ConnectorVerificationError, GeometryError } from '../errors.ts';
import type { GeometryKernel } from '../kernel.ts';
import type { Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';
import type { Vec2 } from '../shapes/polygon.ts';
import { roundDimensionsMm } from '../shapes/round.ts';
import { connectorVolumeTolerance, cylinderSection, framePoint, type SectionFrame } from './frame.ts';

/**
 * Initial experimental proportions for print trials, relative to the longest dimension M of the assembled model and the
 * size multiplier k: the tongue's height h = 0,025·M·k normal to the cut and its root width b = 0,075·M·k in the cut;
 * the head is B = b + 2h wide, so that both flanks lean outwards at 45°. At M = 80 mm and k = 1: 2, 6 and 10 mm.
 */
export const DOVETAIL_PROPORTIONS = { height: 0.025, rootWidth: 0.075 } as const;

/**
 * Conservative thresholds for first trials with a 0,4 mm nozzle, not a strength guarantee: the tongue's height, its
 * narrowest width (the neck at the cut), every load-bearing wall of the parts, and the undercut that keeps the head
 * behind the groove's neck on each side once the clearance is taken up.
 */
export const DOVETAIL_MINIMUMS_MM = { tongueHeight: 1.2, neckWidth: 2.4, wall: 1.2, undercut: 0.4 } as const;

/** How far the tongue reaches into the lower part below the cut, so that the union does not rest on coplanar faces. */
export const DOVETAIL_ROOT_OVERLAP_MM = 0.2;

/** The lead-in chamfer at the tongue's entering end, relative to its height. */
export const DOVETAIL_LEAD_IN_RELATIVE = 0.25;

/** How far beyond the upper part the groove's sweep ends, so that its entrance opens cleanly to the outside. */
export const DOVETAIL_EXIT_MARGIN_MM = 1;

/** The section's frame; u is the sliding direction. */
export type DovetailFrame = SectionFrame;

/** A combination that cannot carry the connection, with the value that fails its minimum. */
export type DovetailIssue =
  | { readonly code: 'tongue-too-low'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'neck-too-narrow'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'undercut-lost'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'tongue-outside-section' }
  | { readonly code: 'side-walls-thin'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'stop-thin'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'backing-thin'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'base-thin'; readonly valueMm: number; readonly minimumMm: number };

export interface DovetailPlan {
  readonly type: 'dovetail';
  readonly frame: DovetailFrame;
  /** h, b and B of the tongue, in millimetres. */
  readonly height: number;
  readonly rootWidth: number;
  readonly headWidth: number;
  /** The tongue's length along u, centred on the section. */
  readonly length: number;
  readonly clearance: number;
  readonly leadIn: number;
  /** The tongue's cross-section in (v, n), counter-clockwise, including the root overlap below the cut. */
  readonly tongueProfile: readonly Vec2[];
  /** The tongue's profile offset by the clearance normal to every edge: the cross-section of the groove. */
  readonly grooveProfile: readonly Vec2[];
  /**
   * How far the tongue travels along −u relative to the upper part, from the assembled position until it is entirely
   * outside the upper part; equally, how far the upper part slides along +u to come off.
   */
  readonly exitDistance: number;
  /** The free movement of the engaged upper part along n: the flank clearance measured along n, c·√2. */
  readonly normalPlay: number;
  /** On each side, how far the head reaches beyond the groove's neck: what keeps the parts together along n. */
  readonly undercut: number;
  readonly issues: readonly DovetailIssue[];
}

const scaleVec = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
/** The convex hull of the points; manifold-3d's typings ask for mutable tuples. */
const hullOf = (kernel: GeometryKernel, points: readonly Vec3[]): Manifold =>
  kernel.Manifold.hull(points.map((point) => [...point] as KernelVec3));

/** h, b and B in millimetres for the multiplier k and the assembled model's longest dimension M. */
export function dovetailProfileMm(sizeFactor: number, longestDimensionMm: number) {
  const height = DOVETAIL_PROPORTIONS.height * longestDimensionMm * sizeFactor;
  const rootWidth = DOVETAIL_PROPORTIONS.rootWidth * longestDimensionMm * sizeFactor;
  return { height, rootWidth, headWidth: rootWidth + 2 * height };
}

/**
 * The cross-section in (v, n), counter-clockwise: root width b at the cut, n = 0, widening by 45° on each side to the
 * head width B at n = h. The flanks continue below the cut by the root overlap, which keeps the polygon convex.
 */
function tongueProfileOf(height: number, rootWidth: number, overlap: number): Vec2[] {
  const root = rootWidth / 2;
  return [
    [-(root - overlap), -overlap],
    [root - overlap, -overlap],
    [root + height, height],
    [-(root + height), height],
  ];
}

/**
 * Moves each edge of a convex counter-clockwise polygon outwards by its distance, measured normal to the edge, and
 * joins neighbouring edges at the intersection of their lines: a physical offset of sloped edges too, not a scaling.
 */
export function offsetConvexPolygon(points: readonly Vec2[], distances: readonly number[]): Vec2[] {
  const lines = points.map(([x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length] as Vec2;
    const edge = Math.hypot(nextX - x, nextY - y);
    const normal: Vec2 = [(nextY - y) / edge, -(nextX - x) / edge];
    return { normal, offset: normal[0] * x + normal[1] * y + (distances[index] as number) };
  });
  return lines.map((line, index) => {
    const previous = lines[(index + lines.length - 1) % lines.length] as typeof line;
    const [[a, b], [c, d]] = [previous.normal, line.normal];
    const determinant = a * d - b * c;
    return [(previous.offset * d - line.offset * b) / determinant, (a * line.offset - c * previous.offset) / determinant];
  });
}

/** Whether every turn of the counter-clockwise polygon is strictly to the left. */
export function isStrictlyConvex(points: readonly Vec2[]): boolean {
  return points.every(([x0, y0], index) => {
    const [x1, y1] = points[(index + 1) % points.length] as Vec2;
    const [x2, y2] = points[(index + 2) % points.length] as Vec2;
    return (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1) > 0;
  });
}

/** The v coordinate of the polygon's right edge at height n, between its right-hand vertices 1 and 2. */
function rightEdgeAt(profile: readonly Vec2[], n: number): number {
  const [[v1, n1], [v2, n2]] = [profile[1] as Vec2, profile[2] as Vec2];
  return v1 + ((v2 - v1) * (n - n1)) / (n2 - n1);
}

/**
 * The dovetail of a cylinder cut parallel to its bases, in millimetres of the built solid (lower base centred at the
 * origin in z = 0, upper base displaced by d along X): its frame, dimensions and the issues that rule it out. Pure, so
 * that the interface can explain a combination before anything is built.
 *
 * The sliding direction u is perpendicular to the lean, +Y for every cylinder, so that the lean only moves each section
 * across the groove and the tongue's length runs along a full diameter. The groove opens towards −u and is closed by a
 * stop at +u: the upper part goes on by sliding along −u until the stop meets the tongue, which then leaves the
 * clearance c between them in the assembled position.
 *
 * Walls are measured on the polygon's inscribed circle of radius r·cos(π/N), over the heights the groove occupies, with
 * each horizontal section of the oblique cylinder moved by its lean. The entrance and the open channel before it are
 * intentional openings; only the walls beside the engaged groove, the stop, the material above the groove and under
 * the tongue carry load.
 */
export function planDovetail(
  shape: CylinderShape,
  scale: PhysicalScale,
  positionPercent: number,
  connector: DovetailConnector,
): DovetailPlan {
  const { radius: r } = roundDimensionsMm(shape, scale);
  const { frame, inradius, leanAcross, lowerThickness, upperThickness } = cylinderSection(shape, scale, positionPercent);

  const { height, rootWidth, headWidth } = dovetailProfileMm(connector.sizeFactor, scale.longestDimensionMm);
  const clearance = connector.clearanceMm;
  const tongueLength = (connector.lengthPercent / 100) * 2 * r;
  const tongueProfile = tongueProfileOf(height, rootWidth, DOVETAIL_ROOT_OVERLAP_MM);
  const grooveProfile = offsetConvexPolygon(tongueProfile, [clearance, clearance, clearance, clearance]);
  const grooveHalfWidth = Math.max(...grooveProfile.map(([gv]) => Math.abs(gv)));
  const grooveTop = Math.max(...grooveProfile.map(([, gn]) => gn));
  const engagedEnd = tongueLength / 2 + clearance;
  const undercut = headWidth / 2 - rightEdgeAt(grooveProfile, 0);

  const { tongueHeight, neckWidth, wall, undercut: minimumUndercut } = DOVETAIL_MINIMUMS_MM;
  const issues: DovetailIssue[] = [];
  const atLeast = (code: Exclude<DovetailIssue['code'], 'tongue-outside-section'>, valueMm: number, minimumMm: number) => {
    if (!(valueMm >= minimumMm)) issues.push({ code, valueMm, minimumMm });
  };
  atLeast('tongue-too-low', height, tongueHeight);
  atLeast('neck-too-narrow', rootWidth, neckWidth);
  atLeast('undercut-lost', undercut, minimumUndercut);
  const headReach = headWidth / 2 + leanAcross * height;
  if ((tongueLength / 2) ** 2 + headReach ** 2 > inradius ** 2) issues.push({ code: 'tongue-outside-section' });
  const chord = (distance: number) => Math.sqrt(Math.max(0, inradius ** 2 - distance ** 2));
  const across = grooveHalfWidth + leanAcross * grooveTop;
  atLeast('side-walls-thin', chord(engagedEnd) - across, wall);
  atLeast('stop-thin', chord(across) - engagedEnd, wall);
  atLeast('backing-thin', upperThickness - grooveTop, wall);
  atLeast('base-thin', lowerThickness - DOVETAIL_ROOT_OVERLAP_MM, wall);

  return {
    type: 'dovetail',
    frame,
    height,
    rootWidth,
    headWidth,
    length: tongueLength,
    clearance,
    leadIn: DOVETAIL_LEAD_IN_RELATIVE * height,
    tongueProfile,
    grooveProfile,
    // The upper part reaches r from the section's centre along u, which is perpendicular to the lean.
    exitDistance: r + engagedEnd + DOVETAIL_EXIT_MARGIN_MM,
    normalPlay: clearance * Math.SQRT2,
    undercut,
    issues,
  };
}

const ring = (frame: DovetailFrame, profile: readonly Vec2[], along: number): Vec3[] =>
  profile.map(([across, normal]) => framePoint(frame, [along, across, normal]));

/**
 * The tongue's corners: its profile from −L/2 to L/2 − e, and at L/2 the profile inset by the lead-in e on the flanks
 * and the head, which chamfers the edges that enter the groove first. The root keeps its full width up to the end, so
 * the retaining profile is intact over the whole length but the chamfer.
 */
export function tonguePoints(plan: DovetailPlan, shift = 0): Vec3[] {
  const { frame, tongueProfile, length: tongueLength, leadIn } = plan;
  const inset = offsetConvexPolygon(tongueProfile, [0, -leadIn, -leadIn, -leadIn]);
  return [
    ...ring(frame, tongueProfile, shift - tongueLength / 2),
    ...ring(frame, tongueProfile, shift + tongueLength / 2 - leadIn),
    ...ring(frame, inset, shift + tongueLength / 2),
  ];
}

/**
 * The groove cutter: the tongue offset by the clearance (without the lead-in chamfer, which only enlarges the gap),
 * swept along −u from the assembled position until it is beyond the upper part. The offset tongue is a convex prism
 * and the sweep a straight translation, so the sweep is exactly the convex hull of the prism's two end positions. It
 * reaches below the cut, so that no membrane is left over the entrance.
 */
export function grooveCutterPoints(plan: DovetailPlan): Vec3[] {
  const { frame, grooveProfile, length: tongueLength, clearance, exitDistance } = plan;
  const end = tongueLength / 2 + clearance;
  return [
    ...ring(frame, grooveProfile, -end - exitDistance),
    ...ring(frame, grooveProfile, end - exitDistance),
    ...ring(frame, grooveProfile, -end),
    ...ring(frame, grooveProfile, end),
  ];
}

export interface DovetailParts {
  readonly lower: Manifold;
  readonly upper: Manifold;
  readonly tongue: Manifold;
}

/** Adds the tongue to the lower part and cuts the swept groove from the upper part; every object is tracked. */
export function buildDovetail(
  kernel: GeometryKernel,
  track: Track,
  parts: { readonly lower: Manifold; readonly upper: Manifold },
  plan: DovetailPlan,
): DovetailParts {
  // The convex-hull shortcut for the sweep and the tongue holds only for convex profiles.
  if (!isStrictlyConvex(plan.tongueProfile) || !isStrictlyConvex(plan.grooveProfile)) {
    throw new GeometryError('The dovetail profile is not convex.');
  }
  const tongue = track(hullOf(kernel, tonguePoints(plan)));
  const cutter = track(hullOf(kernel, grooveCutterPoints(plan)));
  return { lower: track(parts.lower.add(tongue)), upper: track(parts.upper.subtract(cutter)), tongue };
}

/** How far past the free play the retention check lifts the upper part. */
const RETENTION_PROBE_MM = 0.05;

/**
 * Checks the built parts in three dimensions; throws ConnectorVerificationError naming the first failed check.
 *
 * - Each part is one connected solid.
 * - Neither part leaves the uncut cylinder: the tongue adds material only inside it.
 * - The assembled parts do not overlap.
 * - The insertion path is clear: the tongue swept along −u over the whole exit distance, the convex hull of its two end
 *   positions, does not meet the upper part; its end position lies outside the uncut upper part, so the entrance opens
 *   to the outside.
 * - The groove has a stop: the tongue moved along +u by the clearance and a little more meets the upper part.
 * - The undercut retains: the upper part lifted along n by the free play and a little more meets the lower part.
 */
export function verifyDovetail(
  kernel: GeometryKernel,
  track: Track,
  original: { readonly whole: Manifold; readonly upper: Manifold },
  built: DovetailParts,
  plan: DovetailPlan,
  longestDimensionMm: number,
): void {
  const tolerance = connectorVolumeTolerance(longestDimensionMm);
  const volume = (manifold: Manifold) => track(manifold).volume();
  const fail = (check: string): never => {
    throw new ConnectorVerificationError(check);
  };
  const { u, n } = plan.frame;
  for (const part of [built.lower, built.upper]) {
    const pieces = part.decompose();
    for (const piece of pieces) track(piece);
    if (pieces.length !== 1) fail('connected');
  }
  if (volume(built.lower.subtract(original.whole)) > tolerance) fail('lower-inside-envelope');
  if (volume(built.upper.subtract(original.whole)) > tolerance) fail('upper-inside-envelope');
  if (volume(built.lower.intersect(built.upper)) > tolerance) fail('no-overlap');
  const sweep = track(hullOf(kernel, [...tonguePoints(plan), ...tonguePoints(plan, -plan.exitDistance)]));
  if (volume(sweep.intersect(built.upper)) > tolerance) fail('clear-path');
  const outside = track(built.tongue.translate(scaleVec(u, -plan.exitDistance)));
  if (volume(outside.intersect(original.upper)) > tolerance) fail('open-entrance');
  const pushed = track(built.tongue.translate(scaleVec(u, plan.clearance + RETENTION_PROBE_MM)));
  if (!(volume(pushed.intersect(built.upper)) > tolerance)) fail('stop');
  const lifted = track(built.upper.translate(scaleVec(n, plan.normalPlay + RETENTION_PROBE_MM)));
  if (!(volume(lifted.intersect(built.lower)) > tolerance)) fail('retention');
}
