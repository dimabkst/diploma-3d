import { type CylinderShape, DOVETAIL_CLEARANCE_LIMITS, type DovetailConnector, type PhysicalScale } from '@diploma-3d/schema';
import type { Vec2 as KernelVec2, Vec3 as KernelVec3, Manifold, Mat4 } from 'manifold-3d';
import { ConnectorVerificationError, GeometryError } from '../errors.ts';
import type { GeometryKernel } from '../kernel.ts';
import type { Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';
import type { Vec2 } from '../shapes/polygon.ts';
import { type ConnectorFeasibility, connectorFeasibility } from './bounds.ts';
import {
  CONNECTOR_MIN_WALL_MM,
  type CylinderCut,
  type CylinderSection,
  connectorVolumeTolerance,
  cylinderCut,
  facesOfPart,
  framePoint,
  lateralWall,
  type ObliqueCylinderSection,
  type ParallelCylinderSection,
  pointWall,
  type SectionFrame,
  satisfies,
  type VerticalCylinderSection,
} from './frame.ts';

/**
 * Initial experimental proportions for print trials, relative to the longest dimension M of the assembled model and the
 * size multiplier k: the tongue's height h = 0,025·M·k normal to the cut and its root width b = 0,075·M·k in the cut;
 * the head is B = b + 2h wide, so that both flanks lean outwards at 45°. At M = 80 mm and k = 1: 2, 6 and 10 mm.
 */
export const DOVETAIL_PROPORTIONS = { height: 0.025, rootWidth: 0.075 } as const;

/**
 * Conservative thresholds for first trials with a 0,4 mm nozzle, not a strength guarantee: the tongue's height, its
 * narrowest width (the neck at the cut), every load-bearing wall of the parts, the undercut that keeps the head behind
 * the groove's neck on each side once the clearance is taken up, and the straight working length of the tongue after
 * its lead-in chamfer. The last has no established project value; it takes the wall's 1,2 mm as an experimental
 * minimum feature.
 */
export const DOVETAIL_MINIMUMS_MM = {
  tongueHeight: 1.2,
  neckWidth: 2.4,
  wall: CONNECTOR_MIN_WALL_MM,
  undercut: 0.4,
  straightLength: CONNECTOR_MIN_WALL_MM,
} as const;

/** How far the tongue reaches into the lower part below the cut, so that the union does not rest on coplanar faces. */
export const DOVETAIL_ROOT_OVERLAP_MM = 0.2;

/** The lead-in chamfer at the tongue's entering end, relative to its height. */
export const DOVETAIL_LEAD_IN_RELATIVE = 0.25;

/** How far beyond the upper part the groove's sweep ends, so that its entrance opens cleanly to the outside. */
export const DOVETAIL_EXIT_MARGIN_MM = 1;

/**
 * The section's frame for the dovetail; u is the sliding direction. The groove opens towards −u and is closed by the
 * stop at +u, so a vertical or oblique cut's dovetail has u pointing downhill: open at the top, the stop below the
 * seated tongue.
 */
export type DovetailFrame = SectionFrame;

/** A constraint of the connection with its measured value; an issue when that value falls short of its minimum. */
export interface DovetailIssue {
  readonly code:
    | 'tongue-too-low'
    | 'neck-too-narrow'
    | 'undercut-lost'
    | 'tongue-too-short'
    | 'groove-wall-thin'
    | 'stop-thin'
    | 'backing-thin'
    | 'base-thin';
  readonly valueMm: number;
  readonly minimumMm: number;
}

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
  return dovetailProfileOfHeight(DOVETAIL_PROPORTIONS.height * longestDimensionMm * sizeFactor);
}

/** b = 3h and B = b + 2h for the tongue's height h. */
export function dovetailProfileOfHeight(height: number) {
  const rootWidth = (DOVETAIL_PROPORTIONS.rootWidth / DOVETAIL_PROPORTIONS.height) * height;
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

/** The physical dimensions that the constraints read, in millimetres. */
export interface DovetailDimensions {
  /** h, normal to the cut; b and B follow from it. */
  readonly height: number;
  /** The tongue's length along u, centred on the section. */
  readonly length: number;
  /** c, between each pair of mating surfaces. */
  readonly clearance: number;
}

/**
 * The groove's extent, from the implemented profiles: the tongue offset by c normal to each edge. The 45° flanks move
 * by c·√2 across, so the groove is b/2 + c·√2 wide on each side at the cut, and its top corners, at n = h + c, lie
 * b/2 + h + c·(1 + √2) from the centre plane; the tests compare both with the offset polygon.
 */
function grooveExtent({ height, clearance }: DovetailDimensions) {
  const { rootWidth, headWidth } = dovetailProfileOfHeight(height);
  return {
    neckHalfWidth: rootWidth / 2 + clearance * Math.SQRT2,
    halfWidth: headWidth / 2 + clearance * (1 + Math.SQRT2),
    top: height + clearance,
  };
}

/**
 * Every construction constraint of the dovetail, satisfied or not, always the same ones in the same order for a cut, so
 * that the bounds of each dimension can be solved from them (see `dovetailFeasibility`).
 *
 * - The tongue is at least 1,2 mm high and 2,4 mm wide at its neck.
 * - The undercut B/2 − (b/2 + c·√2) = h − c·√2 keeps at least 0,4 mm on each side once the clearance is taken up.
 * - After its lead-in chamfer the tongue keeps a straight working length L − 0,25·h of at least 1,2 mm.
 * - The walls around the groove keep 1,2 mm, see `parallelWalls`, `verticalWalls` and `obliqueWalls`.
 *
 * Each value is concave in h, L and c, which the bounds rely on.
 */
export function dovetailChecks(section: CylinderSection, dimensions: DovetailDimensions): DovetailIssue[] {
  const { height, length } = dimensions;
  const { rootWidth, headWidth } = dovetailProfileOfHeight(height);
  const groove = grooveExtent(dimensions);
  const { tongueHeight, neckWidth, undercut, straightLength } = DOVETAIL_MINIMUMS_MM;
  return [
    { code: 'tongue-too-low', valueMm: height, minimumMm: tongueHeight },
    { code: 'neck-too-narrow', valueMm: rootWidth, minimumMm: neckWidth },
    { code: 'undercut-lost', valueMm: headWidth / 2 - groove.neckHalfWidth, minimumMm: undercut },
    { code: 'tongue-too-short', valueMm: length - DOVETAIL_LEAD_IN_RELATIVE * height, minimumMm: straightLength },
    ...wallsOf(section, dimensions, groove),
  ];
}

function wallsOf(
  section: CylinderSection,
  dimensions: DovetailDimensions,
  groove: ReturnType<typeof grooveExtent>,
): DovetailIssue[] {
  switch (section.type) {
    case 'parallel-to-bases':
      return parallelWalls(section, dimensions, groove);
    case 'vertical':
      return verticalWalls(section, dimensions, groove);
    case 'oblique':
      return obliqueWalls(section, dimensions, groove);
  }
}

/**
 * Around the groove's closed end at u = L/2 + c, its top corners stay at least 1,2 mm inside the polygon's inscribed
 * circle, measured radially from the section's centre moved by an oblique cylinder's lean at the groove's top. These
 * corners are the groove's farthest points beyond the entrance, so the walls beside the engaged groove and the stop
 * behind it are at least as thick; the open channel towards the entrance is intentional. For a right cylinder this is
 * L ≤ 2·(√((R − w)² − A²) − c), with A the groove's half width at its top and R the inscribed radius. Over the groove
 * the upper part keeps 1,2 mm, under the tongue's root overlap the lower part too.
 */
function parallelWalls(
  { inradius, leanAcross, lowerThickness, upperThickness }: ParallelCylinderSection,
  { length, clearance }: DovetailDimensions,
  groove: ReturnType<typeof grooveExtent>,
): DovetailIssue[] {
  const { wall } = DOVETAIL_MINIMUMS_MM;
  const corner = Math.hypot(length / 2 + clearance, groove.halfWidth + leanAcross * groove.top);
  return [
    { code: 'groove-wall-thin', valueMm: inradius - corner, minimumMm: wall },
    { code: 'backing-thin', valueMm: upperThickness - groove.top, minimumMm: wall },
    { code: 'base-thin', valueMm: lowerThickness - DOVETAIL_ROOT_OVERLAP_MM, minimumMm: wall },
  ];
}

/**
 * The tongue and the engaged groove are convex prisms along the vertical sliding direction, so their corners bound
 * them (see `lateralWall`). The farthest corners from the leaning axis lie at the closed end, L/2 + c from the centroid
 * along u, where the lean has moved the section by lean·(L/2 + c): those at the cut with the groove's neck, and those at
 * the groove's top. Above the seated tongue the channel may leave the section through the side of a strongly leaning
 * cylinder: that opening lies above the tongue, as an entrance must, and its walls taper off like the ones at any
 * entrance. Below the closed end the stop keeps 1,2 mm to the lower base; the tongue is centred, so that its other end
 * stays further than that from the upper base. Behind the tongue's root overlap part A keeps 1,2 mm as well.
 */
function verticalWalls(
  section: VerticalCylinderSection,
  { height, length, clearance }: DovetailDimensions,
  groove: ReturnType<typeof grooveExtent>,
): DovetailIssue[] {
  const { wall } = DOVETAIL_MINIMUMS_MM;
  const { offset, lean } = section;
  const reachOf = (halfWidth: number, end: number) => halfWidth + lean * end;
  const closedEnd = length / 2 + clearance;
  const { rootWidth } = dovetailProfileOfHeight(height);
  return [
    {
      code: 'groove-wall-thin',
      valueMm: Math.min(
        lateralWall(section, reachOf(groove.neckHalfWidth, closedEnd), offset),
        lateralWall(section, reachOf(groove.halfWidth, closedEnd), offset + groove.top),
      ),
      minimumMm: wall,
    },
    { code: 'stop-thin', valueMm: section.height / 2 - closedEnd, minimumMm: wall },
    {
      code: 'base-thin',
      valueMm: lateralWall(
        section,
        reachOf(rootWidth / 2 - DOVETAIL_ROOT_OVERLAP_MM, length / 2),
        offset - DOVETAIL_ROOT_OVERLAP_MM,
      ),
      minimumMm: wall,
    },
  ];
}

/**
 * The engaged groove is a convex prism along u, so its corners at both ends bound its walls, across its full width at the
 * cut and at its top; an oblique section need not be symmetric about its centroid, so the uphill end counts as well.
 * Beyond that end the channel runs to its entrance, where its walls taper off as at any entrance. Faces ahead of the
 * closed end, which the stop rests on, are told apart from the others. Behind the tongue's root overlap, part A keeps
 * 1,2 mm at both ends, the faces being those of its own side.
 */
function obliqueWalls(
  section: ObliqueCylinderSection,
  { height, length, clearance }: DovetailDimensions,
  groove: ReturnType<typeof grooveExtent>,
): DovetailIssue[] {
  const { wall } = DOVETAIL_MINIMUMS_MM;
  const closedEnd = -(length / 2 + clearance);
  const uphillEnd = length / 2;
  const corners = (along: number): [number, number, number][] => [
    [along, groove.neckHalfWidth, 0],
    [along, -groove.neckHalfWidth, 0],
    [along, groove.halfWidth, groove.top],
    [along, -groove.halfWidth, groove.top],
  ];
  const faces = facesOfPart(section, 'positive');
  const wallOf = (points: readonly [number, number, number][], of: typeof faces) =>
    Math.min(...of.flatMap((face) => points.map(([along, across, normal]) => pointWall(face, along, across, normal))));
  const ahead = faces.filter((face) => face.alongU < 0);
  const beside = faces.filter((face) => face.alongU >= 0);
  const { rootWidth } = dovetailProfileOfHeight(height);
  const root = rootWidth / 2 - DOVETAIL_ROOT_OVERLAP_MM;
  const rootCorners = [length / 2, -length / 2].flatMap((along) => [
    [along, root, -DOVETAIL_ROOT_OVERLAP_MM] as [number, number, number],
    [along, -root, -DOVETAIL_ROOT_OVERLAP_MM] as [number, number, number],
  ]);
  return [
    {
      code: 'groove-wall-thin',
      valueMm: Math.min(wallOf(corners(uphillEnd), faces), wallOf(corners(closedEnd), beside)),
      minimumMm: wall,
    },
    { code: 'stop-thin', valueMm: wallOf(corners(closedEnd), ahead), minimumMm: wall },
    { code: 'base-thin', valueMm: wallOf(rootCorners, facesOfPart(section, 'negative')), minimumMm: wall },
  ];
}

/** The settings in millimetres: h from M, and L as its percentage of the section's span 2·halfSpan along u. */
export function dovetailDimensions(
  connector: DovetailConnector,
  longestDimensionMm: number,
  halfSpanMm: number,
): DovetailDimensions {
  return {
    height: dovetailProfileMm(connector.sizeFactor, longestDimensionMm).height,
    length: (connector.lengthPercent / 100) * 2 * halfSpanMm,
    clearance: connector.clearanceMm,
  };
}

/** The frame the dovetail is built in: the u of a vertical or oblique cut turned downhill, see `DovetailFrame`. */
function dovetailFrame({ type, frame }: CylinderSection): DovetailFrame {
  if (type === 'parallel-to-bases') return frame;
  const [u, v]: Vec3[] = [scaleVec(frame.u, -1), scaleVec(frame.v, -1)];
  return { ...frame, u: u as Vec3, v: v as Vec3 };
}

/**
 * The dovetail of a cut cylinder, in millimetres of the built solid (lower base centred at the origin in z = 0, upper
 * base displaced by d along X): its frame, dimensions and the issues that rule it out. Pure, so that the interface can
 * explain a combination before anything is built.
 *
 * In a parallel cut the sliding direction u is perpendicular to the lean, +Y for every cylinder, so that the lean only
 * moves each section across the groove and the tongue's length runs along a full diameter. The groove opens towards −u
 * and is closed by a stop at +u: the upper part goes on by sliding along −u until the stop meets the tongue, which then
 * leaves the clearance c between them in the assembled position.
 *
 * In a vertical cut the same construction has u pointing down, whatever the lean: part A, with the tongue on it, comes
 * off by moving straight up, and is seated by moving down until the tongue meets the stop. The section reaches H/2
 * above the centroid, where a right cylinder's channel opens through the upper base.
 *
 * An oblique cut does the same along the plane: part A comes off uphill and is seated downhill, the entrance uphill and
 * the stop downhill, whatever the plane's direction. See `dovetailChecks` for the constraints.
 */
export function planDovetail(
  shape: CylinderShape,
  scale: PhysicalScale,
  cut: CylinderCut,
  connector: DovetailConnector,
): DovetailPlan {
  const section = cylinderCut(shape, scale, cut);
  const dimensions = dovetailDimensions(connector, scale.longestDimensionMm, section.span / 2);
  const { height, length: tongueLength, clearance } = dimensions;
  const { rootWidth, headWidth } = dovetailProfileOfHeight(height);
  const tongueProfile = tongueProfileOf(height, rootWidth, DOVETAIL_ROOT_OVERLAP_MM);
  return {
    type: 'dovetail',
    frame: dovetailFrame(section),
    height,
    rootWidth,
    headWidth,
    length: tongueLength,
    clearance,
    leadIn: DOVETAIL_LEAD_IN_RELATIVE * height,
    tongueProfile,
    grooveProfile: offsetConvexPolygon(tongueProfile, [clearance, clearance, clearance, clearance]),
    exitDistance: grooveReach(section, dimensions) + tongueLength / 2 + clearance + DOVETAIL_EXIT_MARGIN_MM,
    normalPlay: clearance * Math.SQRT2,
    undercut: headWidth / 2 - grooveExtent(dimensions).neckHalfWidth,
    issues: dovetailChecks(section, dimensions).filter((check) => !satisfies(check)),
  };
}

/**
 * How far the part with the groove reaches from the section's centre towards the entrance, where the tongue slides: half
 * the span in a symmetric section; in an oblique one, the part's actual extent within the groove's depth.
 */
function grooveReach(section: CylinderSection, dimensions: DovetailDimensions): number {
  return section.type === 'oblique' ? section.uphillReachWithin(grooveExtent(dimensions).top) : section.span / 2;
}

/** The dovetail's dimensions in millimetres, each solved for with the others fixed. */
export type DovetailParameter = 'height' | 'length' | 'clearance';

/**
 * Which values of each dimension the current cylinder, cut and other dimensions allow, from the same checks that
 * `planDovetail` applies. The search envelopes follow from the model and the minimum tongue height: a height from half
 * that minimum, where the profile is still a convex polygon, and a length up to the section's span; the clearance stays
 * within its calibration window, a policy for print trials rather than a geometric limit.
 */
export function dovetailFeasibility(
  shape: CylinderShape,
  scale: PhysicalScale,
  cut: CylinderCut,
  connector: DovetailConnector,
): ConnectorFeasibility<DovetailParameter, DovetailIssue> {
  const section = cylinderCut(shape, scale, cut);
  const dimensions = dovetailDimensions(connector, scale.longestDimensionMm, section.span / 2);
  const lowest = DOVETAIL_MINIMUMS_MM.tongueHeight / 2;
  return connectorFeasibility((current) => dovetailChecks(section, current), dimensions, [
    {
      key: 'height',
      envelope: { min: lowest, max: Math.max(2 * section.radius, 2 * lowest) },
      value: dimensions.height,
      with: (current, height) => ({ ...current, height }),
    },
    {
      key: 'length',
      envelope: { min: 0, max: section.span },
      value: dimensions.length,
      with: (current, length) => ({ ...current, length }),
    },
    {
      key: 'clearance',
      envelope: DOVETAIL_CLEARANCE_LIMITS,
      value: dimensions.clearance,
      with: (current, clearance) => ({ ...current, clearance }),
    },
  ]);
}

const ring = (frame: DovetailFrame, profile: readonly Vec2[], along: number): Vec3[] =>
  profile.map(([across, normal]) => framePoint(frame, [along, across, normal]));

/**
 * The tongue's corners: its profile from −L/2 to L/2 − e, and at L/2 the profile inset by the lead-in e on the flanks
 * and the head, which chamfers the edges that enter the groove first. The root keeps its full width up to the end, so
 * the retaining profile is intact over the whole length but the chamfer.
 */
export function tonguePoints(plan: DovetailPlan): Vec3[] {
  const { frame, tongueProfile, length: tongueLength, leadIn } = plan;
  const inset = offsetConvexPolygon(tongueProfile, [0, -leadIn, -leadIn, -leadIn]);
  return [
    ...ring(frame, tongueProfile, -tongueLength / 2),
    ...ring(frame, tongueProfile, tongueLength / 2 - leadIn),
    ...ring(frame, inset, tongueLength / 2),
  ];
}

/**
 * The prism of a counter-clockwise profile in (v, n), along the frame's u from `from` back to `to`. It is extruded rather
 * than taken as a convex hull: at an arbitrary orientation manifold-3d's hull can lose volume between corners that lie on
 * one straight edge, which a sweep's positions do. The columns v, n, −u have determinant v·(n × −u) = v·(u × n) = 1.
 */
function prismAlongU(
  kernel: GeometryKernel,
  track: Track,
  { origin, u, v, n }: SectionFrame,
  profile: readonly Vec2[],
  from: number,
  to: number,
): Manifold {
  const local = track(
    kernel.Manifold.extrude(
      profile.map(([x, y]): KernelVec2 => [x, y]),
      from - to,
    ),
  );
  const start: Vec3 = [origin[0] + from * u[0], origin[1] + from * u[1], origin[2] + from * u[2]];
  return track(local.transform([...v, 0, ...n, 0, -u[0], -u[1], -u[2], 0, ...start, 1] as Mat4));
}

/**
 * The groove cutter: the tongue offset by the clearance (without the lead-in chamfer, which only enlarges the gap),
 * swept along −u from the assembled position until it is beyond the upper part, so the sweep is one prism from the
 * closed end to there. It reaches below the cut, so that no membrane is left over the entrance.
 */
export function grooveCutter(kernel: GeometryKernel, track: Track, plan: DovetailPlan): Manifold {
  const end = plan.length / 2 + plan.clearance;
  return prismAlongU(kernel, track, plan.frame, plan.grooveProfile, end, -end - plan.exitDistance);
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
  // The tongue's convex hull and the offset that gives the groove hold only for convex profiles.
  if (!isStrictlyConvex(plan.tongueProfile) || !isStrictlyConvex(plan.grooveProfile)) {
    throw new GeometryError('The dovetail profile is not convex.');
  }
  const tongue = track(hullOf(kernel, tonguePoints(plan)));
  return {
    lower: track(parts.lower.add(tongue)),
    upper: track(parts.upper.subtract(grooveCutter(kernel, track, plan))),
    tongue,
  };
}

/** How far past the free play the retention check lifts the upper part. */
const RETENTION_PROBE_MM = 0.05;

/**
 * Checks the built parts in three dimensions; throws ConnectorVerificationError naming the first failed check.
 *
 * - Each part is one connected solid.
 * - Neither part leaves the uncut cylinder: the tongue adds material only inside it.
 * - The assembled parts do not overlap.
 * - The insertion path is clear: the tongue's full profile swept along −u over the whole exit distance, a prism that
 *   holds the chamfered end as well, does not meet the upper part; its end position lies outside the uncut upper part,
 *   so the entrance opens to the outside.
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
  const sweep = prismAlongU(kernel, track, plan.frame, plan.tongueProfile, plan.length / 2, -plan.length / 2 - plan.exitDistance);
  if (volume(sweep.intersect(built.upper)) > tolerance) fail('clear-path');
  const outside = track(built.tongue.translate(scaleVec(u, -plan.exitDistance)));
  if (volume(outside.intersect(original.upper)) > tolerance) fail('open-entrance');
  const pushed = track(built.tongue.translate(scaleVec(u, plan.clearance + RETENTION_PROBE_MM)));
  if (!(volume(pushed.intersect(built.upper)) > tolerance)) fail('stop');
  const lifted = track(built.upper.translate(scaleVec(n, plan.normalPlay + RETENTION_PROBE_MM)));
  if (!(volume(lifted.intersect(built.lower)) > tolerance)) fail('retention');
}
