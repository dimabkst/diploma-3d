import { type ConnectorProfile, DIAMETRAL_CLEARANCE_LIMITS, type PhysicalScale, type RoundConnector } from '@diploma-3d/schema';
import type { Manifold, Mat4 } from 'manifold-3d';
import { ConnectorVerificationError } from '../errors.ts';
import type { GeometryKernel } from '../kernel.ts';
import type { Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';
import { circularSegments } from '../shapes/round.ts';
import { type ConnectorFeasibility, connectorFeasibility, type ParameterSpec } from './bounds.ts';
import {
  type BallHorizontalSection,
  type BallPlateSection,
  ballInnerWall,
  CONNECTOR_MIN_WALL_MM,
  connectorVolumeTolerance,
  type FacetedSection,
  faceGapOf,
  facesOfPart,
  frameMatrix,
  framePoint,
  insideEnvelope,
  isFaceted,
  isPlateSection,
  lateralWall,
  middleOf,
  type SectionedShape,
  type SectionFrame,
  type SolidCut,
  type SolidFace,
  type SolidSection,
  satisfies,
  solidCut,
} from './frame.ts';
import { profileArcAngles, profileMinWidth, profileReach, profileRing, profileSupport } from './profile.ts';

/**
 * What the stored multipliers are relative to, the assembled model's longest dimension M, so that a chosen connector scales
 * with the model: the primary nominal size d = 0,0625·M·kd and the insertion length e = 0,05·M·ke into one receiving part;
 * and the second size of a pair, 0,8·d. At M = 80 mm and kd = ke = 1: d = 5 mm, 4 mm for the second, e = 4 mm, dowels
 * 2e = 8 mm long. A new connector's dimensions do not follow from these, see `defaultRoundConnector`.
 */
export const ROUND_CONNECTOR_PROPORTIONS = { diameter: 0.0625, insertion: 0.05, secondaryDiameter: 0.8 } as const;

/** Every blind hole is this much deeper than the length that enters it: e + 0,3 mm. */
export const ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM = 0.3;

/**
 * Conservative thresholds for first trials with a 0,4 mm nozzle, not a strength guarantee: the narrowest width of the
 * thinnest pin's actual profile, every wall around and beneath a hole and between holes, the straight engagement left in a
 * receiving part after chamfers and axial play, and by how much the larger pin of a pair is wider than the smaller hole,
 * so that the parts cannot be joined turned by 180°.
 */
export const ROUND_CONNECTOR_MINIMUMS_MM = {
  pinDiameter: 3,
  wall: CONNECTOR_MIN_WALL_MM,
  straightEngagement: 2,
  keying: 0.5,
} as const;

/** How far an integral plug reaches into the lower part below the cut, so that the union is not coplanar. */
export const PLUG_ROOT_OVERLAP_MM = 0.2;

/**
 * The 45° chamfer on pin ends and hole entrances: min(0,08·w, 0,2·e), with w the narrowest width of the local pin's profile,
 * its diameter on a circle. Bound to that width, it leaves a polygon's narrow end face most of its width.
 */
export const ROUND_CONNECTOR_CHAMFER = { diameter: 0.08, insertion: 0.2 } as const;

// Hole cutters continue past the cut face, so that no membrane is left over an entrance.
const CUTTER_MARGIN_MM = 0.5;

/** One connector position: the axis through `centre` on the cut, along n. */
export interface RoundConnectorSite {
  readonly centre: Vec3;
  /** The position along u from the section's centre. */
  readonly along: number;
  /** The nominal size: the diameter of a circle, of a polygon's circumscribed circle, or of the circle a flat side cuts. */
  readonly pinDiameter: number;
  readonly chamfer: number;
}

type Part = 'lower' | 'upper';

/** A constraint of the connectors with its measured value; an issue when that value falls short of its minimum. */
export type RoundConnectorIssue =
  | { readonly code: 'pin-too-thin'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'engagement-short'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'keying-lost'; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'hole-wall-thin'; readonly part: Part; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'holes-too-close'; readonly part: Part; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'hole-bottom-thin'; readonly part: Part; readonly valueMm: number; readonly minimumMm: number }
  | { readonly code: 'base-thin'; readonly valueMm: number; readonly minimumMm: number }
  /** Between two parallel planes: what remains of the middle part between the connectors of both. */
  | { readonly code: 'middle-thin'; readonly valueMm: number; readonly minimumMm: number };

export interface RoundConnectorPlan {
  readonly type: 'plug' | 'dowel';
  readonly profile: ConnectorProfile;
  readonly frame: SectionFrame;
  /** The primary connector first: at the centre, or at +spacing·r along u; the 0,8d one at −spacing·r. */
  readonly sites: readonly RoundConnectorSite[];
  /** e: how far a plug protrudes, or a dowel enters each part. */
  readonly insertion: number;
  /** e + 0,3 mm. */
  readonly holeDepth: number;
  /** The diametral clearance of the holes in each part; plugs have holes in the upper part only. */
  readonly clearance: { readonly lower?: number; readonly upper: number };
  /** The least straight engagement in a receiving part after the chamfers and, for dowels, the axial play. */
  readonly straightEngagement: number;
  /**
   * T of a section plate between the parts, which the pins pass through: each part's face lies T/2 from the frame's plane, a
   * plug stands T + e above the lower part and a dowel is 2e + T long. Absent without a plate.
   */
  readonly plateThickness?: number;
  readonly issues: readonly RoundConnectorIssue[];
}

/** How far each part's face lies from the frame's plane: half the plate's thickness, or zero without one. */
const faceGap = ({ plateThickness }: { readonly plateThickness?: number | undefined }) => (plateThickness ?? 0) / 2;

/** A dowel's whole length 2e + T, the plate's thickness included. */
export const dowelLength = (plan: RoundConnectorPlan): number => 2 * plan.insertion + (plan.plateThickness ?? 0);

/** How far an integral plug stands above the lower part's face: e + T. */
export const plugHeight = (plan: RoundConnectorPlan): number => plan.insertion + (plan.plateThickness ?? 0);

/** The diametral clearance of a section plate's through-holes: a plug's hole's, or the wider of a dowel's two holes. */
export const plateHoleClearance = ({ clearance }: RoundConnectorPlan): number => Math.max(clearance.upper, clearance.lower ?? 0);

/** d and e in millimetres for the multipliers and the assembled model's longest dimension M. */
export function roundConnectorDimensionsMm(diameterFactor: number, depthFactor: number, longestDimensionMm: number) {
  return {
    diameter: ROUND_CONNECTOR_PROPORTIONS.diameter * longestDimensionMm * diameterFactor,
    insertion: ROUND_CONNECTOR_PROPORTIONS.insertion * longestDimensionMm * depthFactor,
  };
}

/** The physical dimensions that the constraints read, in millimetres. */
export interface RoundConnectorDimensions {
  readonly type: 'plug' | 'dowel';
  readonly count: 1 | 2;
  /** A circle unless given. */
  readonly profile?: ConnectorProfile;
  /** d, the primary pin; a pair's second pin is 0,8·d. */
  readonly diameter: number;
  /** e: how far a plug protrudes, or a dowel enters each part. */
  readonly insertion: number;
  /** s: a pair's distance from the section's centre along u; zero for one connector. */
  readonly spacing: number;
  /** The diametral clearance of the holes in each part; plugs have holes in the upper part only. */
  readonly clearance: { readonly lower?: number; readonly upper: number };
}

/** The settings in millimetres: d and e from M, and a pair's spacing as its percentage of the section's half span. */
export function roundConnectorDimensions(
  connector: RoundConnector,
  longestDimensionMm: number,
  halfSpanMm: number,
): RoundConnectorDimensions {
  const { diameter, insertion } = roundConnectorDimensionsMm(connector.diameterFactor, connector.depthFactor, longestDimensionMm);
  return {
    type: connector.type,
    count: connector.count,
    profile: connector.profile ?? 'circle',
    diameter,
    insertion,
    spacing: ((connector.spacingPercent ?? 0) / 100) * halfSpanMm,
    clearance:
      connector.type === 'plug'
        ? { upper: connector.holeClearanceMm }
        : { lower: connector.lowerClearanceMm, upper: connector.upperClearanceMm },
  };
}

/** The 45° chamfer of a pin end and of its hole's entrance; both ends of a site share it. */
const chamferOf = (profile: ConnectorProfile, pinDiameter: number, insertion: number) =>
  Math.min(
    ROUND_CONNECTOR_CHAMFER.diameter * profileMinWidth(profile, pinDiameter / 2, 0),
    ROUND_CONNECTOR_CHAMFER.insertion * insertion,
  );

/** The pins along u, primary first: at the centre, or at +s with d and at −s with 0,8·d. */
function siteLayout({ count, profile = 'circle', diameter, insertion, spacing }: RoundConnectorDimensions) {
  const site = (along: number, pinDiameter: number) => ({
    along,
    pinDiameter,
    chamfer: chamferOf(profile, pinDiameter, insertion),
  });
  return count === 1
    ? [site(0, diameter)]
    : [site(spacing, diameter), site(-spacing, ROUND_CONNECTOR_PROPORTIONS.secondaryDiameter * diameter)];
}

/**
 * The least e that leaves the straight engagement e − play − 2·chamfer: with chamfer = min(0,08·w, 0,2·e) the value is the
 * larger of e − play − 2·0,08·w and e·(1 − 2·0,2) − play, so that either reaching the minimum suffices. The primary pin has
 * the longest chamfer of a pair.
 */
export function leastInsertion(type: 'plug' | 'dowel', profile: ConnectorProfile, diameter: number): number {
  const needed = ROUND_CONNECTOR_MINIMUMS_MM.straightEngagement + (type === 'dowel' ? ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM : 0);
  const width = profileMinWidth(profile, diameter / 2, 0);
  return Math.min(needed + 2 * ROUND_CONNECTOR_CHAMFER.diameter * width, needed / (1 - 2 * ROUND_CONNECTOR_CHAMFER.insertion));
}

/**
 * Every construction constraint of the plugs or dowels, satisfied or not, always the same ones in the same order for a
 * type and count, so that the bounds of each dimension can be solved from them (see `roundConnectorFeasibility`).
 *
 * - The narrowest width of the thinnest pin, 0,8·d of a pair, is at least 3 mm.
 * - The straight engagement e − play − 2·chamfer of every site is at least 2 mm: the pin's end and the hole's entrance
 *   each take one chamfer, and a dowel may slide by the 0,3 mm depth allowance towards the opposite hole's bottom; an
 *   integral plug sits fully home.
 * - A pair keys the parts: the larger pin is at least 0,5 mm wider than the smaller hole, on the straight hole and across
 *   their narrowest widths. A convex shape that fits into another at some angle is not the wider across its narrowest
 *   width, so that the larger pin enters neither smaller hole at any angle.
 * - In each receiving part, the wall beside every hole is at least 1,2 mm where the hole is widest (the chamfered
 *   entrance at the cut), where its straight wall starts and, under `hole-bottom-thin`, at its bottom e + 0,3 mm deep;
 *   see `holeWalls` for how each cut measures them.
 * - Between a pair's entrances at least 1,2 mm remain, and under a plug the part that carries it keeps 1,2 mm behind
 *   its root overlap.
 *
 * Each value is monotone in d, e, s and each clearance, which the bounds rely on: a larger d widens holes and
 * chamfers, a larger e deepens holes and may lengthen chamfers, a larger s moves holes apart and outwards.
 */
export function roundConnectorChecks(section: SolidSection, dimensions: RoundConnectorDimensions): RoundConnectorIssue[] {
  const { type, insertion, clearance, profile = 'circle' } = dimensions;
  const sites = siteLayout(dimensions);
  const holeDepth = insertion + ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM;
  const play = type === 'dowel' ? ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM : 0;
  const { pinDiameter, wall, straightEngagement, keying } = ROUND_CONNECTOR_MINIMUMS_MM;
  const checks: RoundConnectorIssue[] = [
    {
      code: 'pin-too-thin',
      valueMm: Math.min(...sites.map((site) => profileMinWidth(profile, site.pinDiameter / 2, 0))),
      minimumMm: pinDiameter,
    },
    {
      code: 'engagement-short',
      valueMm: Math.min(...sites.map(({ chamfer }) => insertion - play - 2 * chamfer)),
      minimumMm: straightEngagement,
    },
  ];
  if (sites.length === 2) {
    const [primary, secondary] = sites as [(typeof sites)[number], (typeof sites)[number]];
    const widest = Math.max(clearance.upper, clearance.lower ?? 0);
    checks.push({
      code: 'keying-lost',
      valueMm:
        profileMinWidth(profile, primary.pinDiameter / 2, 0) - profileMinWidth(profile, secondary.pinDiameter / 2, widest / 2),
      minimumMm: keying,
    });
  }
  const parts: [Part, number][] = [['upper', clearance.upper]];
  if (clearance.lower !== undefined) parts.push(['lower', clearance.lower]);
  for (const [part, holeClearance] of parts) {
    const holes = sites.map(
      ({ along, pinDiameter: pin, chamfer }): HoleExtent => ({
        profile,
        radius: pin / 2,
        along,
        chamfer,
        straight: holeClearance / 2,
        opening: holeClearance / 2 + chamfer,
      }),
    );
    const walls = holes.map((hole) => holeWalls(section, part, hole, holeDepth));
    checks.push({ code: 'hole-wall-thin', part, valueMm: Math.min(...walls.map(({ side }) => side)), minimumMm: wall });
    if (holes.length === 2) {
      const [first, second] = holes as [HoleExtent, HoleExtent];
      // How far apart they stay along u: a lower bound of their distance, and the distance itself on circles.
      const between =
        first.along -
        second.along -
        profileSupport(profile, first.radius, first.opening, 0, -1) -
        profileSupport(profile, second.radius, second.opening, 0, 1);
      checks.push({ code: 'holes-too-close', part, valueMm: between, minimumMm: wall });
    }
    checks.push({ code: 'hole-bottom-thin', part, valueMm: Math.min(...walls.map(({ bottom }) => bottom)), minimumMm: wall });
  }
  if (type === 'plug') {
    checks.push({ code: 'base-thin', valueMm: plugBacking(section, profile, sites), minimumMm: wall });
  }
  const middle = middleOf(section);
  if (middle !== undefined) {
    // The part between two planes takes the holes of the plane below it and, from the plane above it, either the plug's root,
    // which it carries, or the dowels' holes: the same connector at both, so the sum does not depend on which plane this is.
    const fromBothPlanes = holeDepth + (type === 'plug' ? PLUG_ROOT_OVERLAP_MM : holeDepth);
    checks.push({ code: 'middle-thin', valueMm: middle.thickness - fromBothPlanes, minimumMm: wall });
  }
  return checks;
}

interface HoleExtent {
  readonly profile: ConnectorProfile;
  /** The pin's nominal radius. */
  readonly radius: number;
  /** The position along u from the section's centre. */
  readonly along: number;
  readonly chamfer: number;
  /** How far the side surfaces lie outside the pin's: of the straight hole, and of its widened entrance. */
  readonly straight: number;
  readonly opening: number;
}

/**
 * The walls of one blind hole. Its cavity consists of a frustum and a prism of the profile, both convex, so that its rings
 * at the entrance, at the end of the chamfer and at the bottom bound every point of it; the wall to any convex body is
 * concave and takes its least value on those rings.
 *
 * In a parallel cut they are measured to the polygon's inscribed circle in each horizontal section, from the section's
 * centre moved by an oblique cylinder's lean. The bottom has the part's thickness along the axis to the far base.
 *
 * In a vertical cut the axis lies along n, towards the curved surface, and a hole's depth is limited by the same wall
 * that bounds its sides, see `lateralWall`, from how far the ring reaches along the lean in the horizontal sections. A
 * hole approaching the axis first gains material, so the farther of its entrance and bottom from the axis plane counts; on
 * the way there the entrance is the thinner anyway. The bases are the planes z = 0 and z = H, at H/2 from the centroid.
 *
 * In an oblique cut and in a cone they are measured to the actual faces that bound the part, see `facetedHoleWalls`; in
 * a ball to the sphere inside it, see `ballHoleWalls`.
 */
function holeWalls(section: SolidSection, part: Part, hole: HoleExtent, holeDepth: number) {
  const { profile, radius, along, chamfer, straight, opening } = hole;
  const towards = part === 'upper' ? 1 : -1;
  if (section.type === 'parallel-to-bases') {
    const { inradius, leanAcross, lowerThickness, upperThickness } = section;
    // A horizontal section `height` above the cut moves by leanAcross·height along +v.
    const clearanceAt = (depth: number, offset: number) =>
      inradius - profileReach(profile, radius, offset, -leanAcross * towards * depth, along);
    return {
      side: Math.min(clearanceAt(0, opening), clearanceAt(chamfer, straight), clearanceAt(holeDepth, straight)),
      bottom: (part === 'upper' ? upperThickness : lowerThickness) - holeDepth,
    };
  }
  if (isFaceted(section)) return facetedHoleWalls(section, part, hole, holeDepth);
  if (section.type === 'ball-horizontal' || section.type === 'ball-plate') return ballHoleWalls(section, part, hole, holeDepth);
  const { offset, height } = section;
  const farthest = (depth: number) => Math.max(Math.abs(offset), Math.abs(offset + towards * depth));
  return {
    side: Math.min(
      lateralWall(section, verticalReach(section, hole, opening), offset),
      lateralWall(section, verticalReach(section, hole, straight), farthest(chamfer)),
      height / 2 -
        Math.max(
          along + profileSupport(profile, radius, opening, 0, 1),
          -along + profileSupport(profile, radius, opening, 0, -1),
        ),
    ),
    bottom: lateralWall(section, verticalReach(section, hole, straight), farthest(holeDepth)),
  };
}

/**
 * How far a ring of a hole in a vertical cut reaches from the axis within its horizontal section: a point (x, y) of the
 * profile lies −x along +X from the centroid, as v is −X, and y + along above it, where the axis has moved by
 * lean·(y + along); the centroid itself lies on the axis, because the polygon's chord is symmetric. So it reaches
 * −(x + lean·y) − lean·along from the axis.
 */
function verticalReach(
  { lean }: { readonly lean: number },
  { profile, radius, along }: { profile: ConnectorProfile; radius: number; along: number },
  offset: number,
): number {
  return Math.max(
    profileSupport(profile, radius, offset, -1, -lean) - lean * along,
    profileSupport(profile, radius, offset, 1, lean) + lean * along,
  );
}

/**
 * A hole in a ball: its distance from the centre is convex, so that the cavity's rings at the entrance, at the end of the
 * chamfer and at the bottom bound it, and a cavity whose mouth fits with room to spare is still measured where it reaches
 * furthest.
 */
function ballHoleWalls(section: BallHorizontalSection | BallPlateSection, part: Part, hole: HoleExtent, holeDepth: number) {
  const { profile, radius, along, chamfer, straight, opening } = hole;
  const towards = part === 'upper' ? 1 : -1;
  // Beside a section plate the hole starts at its part's own face, half the plate's thickness from the middle plane.
  const start = section.type === 'ball-plate' ? section.halfThickness : 0;
  const reach = (offset: number) => profileReach(profile, radius, offset, 0, along);
  return {
    side: Math.min(
      ballInnerWall(section, reach(opening), towards * start),
      ballInnerWall(section, reach(straight), towards * (start + chamfer)),
    ),
    bottom: ballInnerWall(section, reach(straight), towards * (start + holeDepth)),
  };
}

/** A ring of a cavity in the plane normal to n: the wall to one face, which the ring's farthest point along it sets. */
const ringWall = (
  face: SolidFace,
  { profile, radius, along }: { profile: ConnectorProfile; radius: number; along: number },
  normal: number,
  offset: number,
): number =>
  face.clearance - along * face.alongU - normal * face.alongN - profileSupport(profile, radius, offset, face.alongV, face.alongU);

/**
 * A hole measured on the actual faces: the whole cavity, with its bottom apart, because a part may thin out behind a mouth
 * that fits with room to spare: a cone narrows and its curved side recedes along a hole's axis, and an oblique one moves
 * away from it.
 */
function facetedHoleWalls(section: SolidSection & FacetedSection, part: Part, hole: HoleExtent, holeDepth: number) {
  const { chamfer, straight, opening } = hole;
  const towards = part === 'upper' ? 1 : -1;
  const faces = facesOfPart(section, part === 'upper' ? 'positive' : 'negative');
  // Beside a section plate the hole starts at its part's own face, half the plate's thickness from the middle plane.
  const start = faceGapOf(section);
  const wallAt = (depth: number, offset: number) =>
    Math.min(...faces.map((face) => ringWall(face, hole, towards * (start + depth), offset)));
  return { side: Math.min(wallAt(0, opening), wallAt(chamfer, straight)), bottom: wallAt(holeDepth, straight) };
}

/** What remains behind the root overlap of the plugs in the part that carries them. */
function plugBacking(
  section: SolidSection,
  profile: ConnectorProfile,
  sites: readonly { along: number; pinDiameter: number }[],
): number {
  if (section.type === 'parallel-to-bases') return section.lowerThickness - PLUG_ROOT_OVERLAP_MM;
  const rings = sites.map(({ along, pinDiameter }) => ({ profile, radius: pinDiameter / 2, along }));
  if (section.type === 'ball-horizontal' || section.type === 'ball-plate') {
    const root = -PLUG_ROOT_OVERLAP_MM - faceGapOf(section);
    return Math.min(
      ...rings.map(({ radius, along }) => ballInnerWall(section, profileReach(profile, radius, 0, 0, along), root)),
    );
  }
  if (isFaceted(section)) {
    const faces = facesOfPart(section, 'negative');
    const root = -PLUG_ROOT_OVERLAP_MM - faceGapOf(section);
    return Math.min(...rings.flatMap((ring) => faces.map((face) => ringWall(face, ring, root, 0))));
  }
  return Math.min(
    ...rings.map((ring) => lateralWall(section, verticalReach(section, ring, 0), section.offset - PLUG_ROOT_OVERLAP_MM)),
  );
}

/**
 * The plugs or dowels of a cut cylinder, in millimetres of the built solid, and the issues that rule them out; pure, so
 * that the interface can explain a combination before anything is built. Every axis is the cut's normal n. See
 * `roundConnectorChecks` for the constraints.
 */
export function planRoundConnectors(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: RoundConnector,
): RoundConnectorPlan {
  const section = solidCut(shape, scale, cut);
  const dimensions = roundConnectorDimensions(connector, scale.longestDimensionMm, section.span / 2);
  const { frame } = section;
  const { insertion, clearance, profile = 'circle' } = dimensions;
  const sites = siteLayout(dimensions).map((site) => ({ ...site, centre: framePoint(frame, [site.along, 0, 0]) }));
  const play = connector.type === 'dowel' ? ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM : 0;
  return {
    type: connector.type,
    profile,
    frame,
    sites,
    insertion,
    holeDepth: insertion + ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM,
    clearance,
    straightEngagement: Math.min(...sites.map(({ chamfer }) => insertion - play - 2 * chamfer)),
    ...(isPlateSection(section) ? { plateThickness: 2 * section.halfThickness } : {}),
    issues: roundConnectorChecks(section, dimensions).filter((check) => !satisfies(check)),
  };
}

/** The round connectors' dimensions in millimetres, each solved for with the others fixed. */
export type RoundConnectorParameter = 'diameter' | 'insertion' | 'spacing' | 'lowerClearance' | 'upperClearance';

/**
 * Which values of each dimension the current cylinder, cut and other dimensions allow, from the same checks that
 * `planRoundConnectors` applies. The search envelopes follow from the model: a diameter and an insertion within the
 * solid's extents and a spacing within the section's half span; clearances stay within their calibration window, a
 * policy for print trials rather than a geometric limit. A pair has a spacing, dowels a lower clearance.
 */
export function roundConnectorFeasibility(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: RoundConnector,
): ConnectorFeasibility<RoundConnectorParameter, RoundConnectorIssue> {
  const section = solidCut(shape, scale, cut);
  const dimensions = roundConnectorDimensions(connector, scale.longestDimensionMm, section.span / 2);
  const { radius, span, depthExtent } = section;
  const parameters: ParameterSpec<RoundConnectorParameter, RoundConnectorDimensions>[] = [
    {
      key: 'diameter',
      envelope: { min: 0, max: Math.max(2 * radius, span) },
      value: dimensions.diameter,
      with: (current, diameter) => ({ ...current, diameter }),
    },
    {
      key: 'insertion',
      envelope: { min: 0, max: depthExtent },
      value: dimensions.insertion,
      with: (current, insertion) => ({ ...current, insertion }),
    },
    {
      key: 'upperClearance',
      envelope: DIAMETRAL_CLEARANCE_LIMITS,
      value: dimensions.clearance.upper,
      with: (current, upper) => ({ ...current, clearance: { ...current.clearance, upper } }),
    },
  ];
  if (dimensions.count === 2) {
    parameters.push({
      key: 'spacing',
      envelope: { min: 0, max: span / 2 },
      value: dimensions.spacing,
      with: (current, spacing) => ({ ...current, spacing }),
    });
  }
  if (dimensions.clearance.lower !== undefined) {
    parameters.push({
      key: 'lowerClearance',
      envelope: DIAMETRAL_CLEARANCE_LIMITS,
      value: dimensions.clearance.lower,
      with: (current, lower) => ({ ...current, clearance: { ...current.clearance, lower } }),
    });
  }
  return connectorFeasibility((current) => roundConnectorChecks(section, current), dimensions, parameters);
}

export interface RoundConnectorParts {
  readonly lower: Manifold;
  readonly upper: Manifold;
  /** The section plate with its through-holes, when there is one. */
  readonly plate?: Manifold;
  /** The separate dowels in their assembled position, primary first; none for plugs. */
  readonly pins: readonly Manifold[];
  /** Per site: the plug or dowel, and the hole cutters by part, the plate's included. */
  readonly sites: readonly { readonly pin: Manifold; readonly cutters: Partial<Record<Part | 'plate', Manifold>> }[];
}

/** One ring of a pin or hole: its height along n from the cut, and how far its side surfaces lie outside the pin's. */
type Layer = readonly [height: number, offset: number];

/**
 * The profile lofted through the layers, from the lowest height to the highest, around the axis through `centre` along n.
 * Built as a closed mesh of the rings rather than extruded in either direction, so that every height has the same (x, y):
 * a hole below the cut and one above it are never mirrored or turned against the pin, nor is the part of a pin in either.
 * `turnedBy` turns the whole of it about its axis, for trying a wrong orientation.
 */
function loftAlongN(
  kernel: GeometryKernel,
  track: Track,
  frame: SectionFrame,
  {
    profile,
    radius,
    arcAngles,
    centre,
  }: { profile: ConnectorProfile; radius: number; arcAngles: readonly number[]; centre: Vec3 },
  layers: readonly Layer[],
  turnedBy = 0,
): Manifold {
  const rings = layers.map(([, offset]) => profileRing(profile, radius, offset, arcAngles));
  const size = (rings[0] as (typeof rings)[number]).length;
  const [cos, sin] = [Math.cos(turnedBy), Math.sin(turnedBy)];
  const positions: number[] = [];
  rings.forEach((ring, index) => {
    const height = (layers[index] as Layer)[0];
    for (const [x, y] of ring) positions.push(cos * x - sin * y, sin * x + cos * y, height);
  });
  const bottomCentre = positions.length / 3;
  const topCentre = bottomCentre + 1;
  positions.push(0, 0, (layers[0] as Layer)[0], 0, 0, (layers[layers.length - 1] as Layer)[0]);
  const triangles: number[] = [];
  const lastRing = (rings.length - 1) * size;
  for (let vertex = 0; vertex < size; vertex += 1) {
    const next = (vertex + 1) % size;
    triangles.push(bottomCentre, next, vertex, topCentre, lastRing + vertex, lastRing + next);
    for (let ring = 0; ring + 1 < rings.length; ring += 1) {
      const [below, above] = [ring * size, (ring + 1) * size];
      triangles.push(below + vertex, below + next, above + next, below + vertex, above + next, above + vertex);
    }
  }
  const mesh = new kernel.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(positions),
    triVerts: Uint32Array.from(triangles),
  });
  const local = track(new kernel.Manifold(mesh));
  return track(local.transform(frameMatrix(frame, centre)));
}

/** The segments of a site's arcs, shared by its pin and holes. */
const siteSegments = ({ clearance }: RoundConnectorPlan, { pinDiameter, chamfer }: { pinDiameter: number; chamfer: number }) =>
  circularSegments((pinDiameter + clearance.upper) / 2 + chamfer + CUTTER_MARGIN_MM);

/** What the rings of one site have in common: pin and holes share their vertex angles, also where a flat side cuts the arc. */
const siteRings = (plan: RoundConnectorPlan, site: RoundConnectorSite) => ({
  profile: plan.profile,
  radius: site.pinDiameter / 2,
  arcAngles: profileArcAngles(plan.profile, site.pinDiameter / 2, -site.chamfer, siteSegments(plan, site)),
  centre: site.centre,
});

/**
 * The layers of a site's plug or dowel, with its straight wall `below` and `above` millimetres longer, swept along its own
 * axis: the chamfered free end or ends, and a plug's square root inside the lower part. Through a section plate it is the
 * plate's thickness longer, as each part's face lies half of it from the frame's plane.
 */
function pinLayers(plan: RoundConnectorPlan, { chamfer }: RoundConnectorSite, below = 0, above = 0): Layer[] {
  const gap = faceGap(plan);
  const top = gap + plan.insertion + above;
  const upperEnd: Layer[] = [
    [top - chamfer, 0],
    [top, -chamfer],
  ];
  if (plan.type === 'plug') return [[-gap - PLUG_ROOT_OVERLAP_MM - below, 0], ...upperEnd];
  const bottom = -gap - plan.insertion - below;
  return [[bottom, -chamfer], [bottom + chamfer, 0], ...upperEnd];
}

/**
 * The layers of a blind hole opening at the part's face `start` from the frame's plane and reaching `depth` into the part, on
 * the side of `towards`: straight with the clearance, widened at the entrance by a 45° chamfer, and continued past the face
 * by the cutter margin, so that no membrane is left over the entrance.
 */
function holeLayers(clearance: number, chamfer: number, depth: number, towards: 1 | -1, start = 0): Layer[] {
  const straight = clearance / 2;
  const layers: Layer[] = [
    [towards * (start - CUTTER_MARGIN_MM), straight + chamfer + CUTTER_MARGIN_MM],
    [towards * (start + chamfer), straight],
    [towards * (start + depth), straight],
  ];
  return towards > 0 ? layers : layers.reverse();
}

/** A section plate's straight through-hole, past both of its faces by the cutter margin; the pins' chamfers lead them in. */
const plateHoleLayers = (clearance: number, gap: number): Layer[] => [
  [-gap - CUTTER_MARGIN_MM, clearance / 2],
  [gap + CUTTER_MARGIN_MM, clearance / 2],
];

/**
 * A site's plug or dowel swept along its own axis, from `below` to `above` millimetres away: the same profile with a longer
 * straight wall. Built as such rather than as the convex hull of the two end positions, which at an arbitrary orientation
 * manifold-3d can get wrong for corners that lie on one straight line.
 */
function pinSweep(
  kernel: GeometryKernel,
  track: Track,
  plan: RoundConnectorPlan,
  site: RoundConnectorSite,
  { below = 0, above = 0 }: { below?: number; above?: number },
): Manifold {
  return loftAlongN(kernel, track, plan.frame, siteRings(plan, site), pinLayers(plan, site, below, above));
}

/**
 * Builds the plugs or dowels on the parts. Pins and holes of a site share their rings' vertex angles, so that their polygons
 * are aligned and the clearance holds between corresponding facets; the count follows the project's circle accuracy for the
 * largest radius involved.
 */
export function buildRoundConnectors(
  kernel: GeometryKernel,
  track: Track,
  parts: { readonly lower: Manifold; readonly upper: Manifold; readonly plate?: Manifold | undefined },
  plan: RoundConnectorPlan,
): RoundConnectorParts {
  const { frame, holeDepth, clearance } = plan;
  const gap = faceGap(plan);
  const sites = plan.sites.map((site) => {
    const rings = siteRings(plan, site);
    const hole = (partClearance: number, towards: 1 | -1) =>
      loftAlongN(kernel, track, frame, rings, holeLayers(partClearance, site.chamfer, holeDepth, towards, gap));
    const cutters: Partial<Record<Part | 'plate', Manifold>> = { upper: hole(clearance.upper, 1) };
    if (clearance.lower !== undefined) cutters.lower = hole(clearance.lower, -1);
    if (parts.plate !== undefined) {
      cutters.plate = loftAlongN(kernel, track, frame, rings, plateHoleLayers(plateHoleClearance(plan), gap));
    }
    return { pin: loftAlongN(kernel, track, frame, rings, pinLayers(plan, site)), cutters };
  });
  const apply = (part: Manifold, cutters: (Manifold | undefined)[]) =>
    cutters.reduce<Manifold>((result, cutter) => (cutter === undefined ? result : track(result.subtract(cutter))), part);
  const upper = apply(
    parts.upper,
    sites.map((entry) => entry.cutters.upper),
  );
  const drilled = apply(
    parts.lower,
    sites.map((entry) => entry.cutters.lower),
  );
  const lower = plan.type === 'plug' ? sites.reduce<Manifold>((result, entry) => track(result.add(entry.pin)), drilled) : drilled;
  const pins = plan.type === 'dowel' ? sites.map((entry) => entry.pin) : [];
  if (parts.plate === undefined) return { lower, upper, pins, sites };
  const plate = apply(
    parts.plate,
    sites.map((entry) => entry.cutters.plate),
  );
  return { lower, upper, plate, pins, sites };
}

const FLAT_SIDE_OVERLAP_MM3 = 0.01;

/** The half turn about the line through `centre` along the unit axis: p ↦ 2(a·(p − c))a − (p − c) + c. */
function halfTurnAbout([ax, ay, az]: Vec3, [cx, cy, cz]: Vec3): Mat4 {
  const r = [
    [2 * ax * ax - 1, 2 * ax * ay, 2 * ax * az],
    [2 * ay * ax, 2 * ay * ay - 1, 2 * ay * az],
    [2 * az * ax, 2 * az * ay, 2 * az * az - 1],
  ] as const;
  const t = [0, 1, 2].map(
    (row) => ([cx, cy, cz][row] as number) - (r[row]?.[0] ?? 0) * cx - (r[row]?.[1] ?? 0) * cy - (r[row]?.[2] ?? 0) * cz,
  );
  // Column-major: the columns of r, then the translation.
  return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, t[0], t[1], t[2], 1] as Mat4;
}

/**
 * Checks the built parts in three dimensions; throws ConnectorVerificationError naming the first failed check.
 *
 * - Each half, the section plate and each dowel is one connected solid, so an integral plug is attached to the lower part.
 * - Neither half leaves the uncut cylinder, and no hole breaks through its outer surface within its own part; the bit
 *   of a cutter past the cut removes nothing from that part. A plug through a section plate stays inside the solid too,
 *   also within the plate's thickness, where only the plate surrounds it.
 * - Nothing overlaps in the assembled position, also with a dowel pushed to either hole's bottom.
 * - The parts come apart along n: each plug or seated dowel, swept along −n out of the upper part and the plate, and each
 *   dowel, swept along +n out of the lower part and the plate, meets nothing.
 * - A pair keys the parts: the upper part turned by 180° about the section's axis meets the plugs or dowels.
 * - A flat side keys each site: its fully inserted plug or dowel, turned by 90° or 180° about its own axis, meets the
 *   receiving part. Regular polygons repeat under their own turns, which is why a single one does not key the parts.
 */
export function verifyRoundConnectors(
  kernel: GeometryKernel,
  track: Track,
  whole: Manifold,
  built: RoundConnectorParts,
  plan: RoundConnectorPlan,
  longestDimensionMm: number,
): void {
  const tolerance = connectorVolumeTolerance(longestDimensionMm);
  const volume = (manifold: Manifold) => track(manifold).volume();
  const fail = (check: string): never => {
    throw new ConnectorVerificationError(check);
  };
  const { n, origin } = plan.frame;
  const along = (distance: number): Vec3 => [n[0] * distance, n[1] * distance, n[2] * distance];
  const plate = built.plate === undefined ? [] : [built.plate];
  for (const solid of [built.lower, built.upper, ...plate, ...built.pins]) {
    const pieces = solid.decompose();
    for (const piece of pieces) track(piece);
    if (pieces.length !== 1) fail('connected');
  }
  const envelope = insideEnvelope(track, whole, plan.frame);
  if (volume(built.lower.subtract(envelope)) > tolerance) fail('lower-inside-envelope');
  if (volume(built.upper.subtract(envelope)) > tolerance) fail('upper-inside-envelope');
  for (const site of built.sites) {
    if (site.cutters.plate !== undefined && volume(site.pin.subtract(envelope)) > tolerance) fail('pin-inside-envelope');
  }
  const cutOffset = n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2];
  const gap = faceGap(plan);
  for (const { cutters } of built.sites) {
    const inside = [
      ...(cutters.upper === undefined ? [] : [cutters.upper.trimByPlane([n[0], n[1], n[2]], cutOffset + gap)]),
      ...(cutters.lower === undefined ? [] : [cutters.lower.trimByPlane([-n[0], -n[1], -n[2]], -(cutOffset - gap))]),
    ];
    for (const cutter of inside) if (volume(track(cutter).subtract(envelope)) > tolerance) fail('no-breakthrough');
  }
  const pieces = [built.lower, built.upper, ...plate];
  pieces.forEach((first, index) => {
    for (const second of pieces.slice(index + 1)) if (volume(first.intersect(second)) > tolerance) fail('no-overlap');
  });
  built.pins.forEach((pin, index) => {
    for (const shift of [-ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM, 0, ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM]) {
      const moved = track(pin.translate(along(shift)));
      if (pieces.some((piece) => volume(moved.intersect(piece)) > tolerance)) fail('dowel-fit');
    }
    const out = pinSweep(kernel, track, plan, plan.sites[index] as RoundConnectorSite, { above: dowelLength(plan) + 1 });
    if ([built.lower, ...plate].some((piece) => volume(out.intersect(piece)) > tolerance)) fail('dowel-removal');
  });
  for (const site of plan.sites) {
    const sweep = pinSweep(kernel, track, plan, site, { below: plan.holeDepth + 2 * gap + 1 });
    if ([built.upper, ...plate].some((piece) => volume(sweep.intersect(piece)) > tolerance)) fail('separation-path');
  }
  if (plan.sites.length === 2) {
    const turned = track(built.upper.transform(halfTurnAbout(n, origin)));
    const mating = plan.type === 'plug' ? [built.lower] : built.pins;
    if (!(mating.reduce((sum, solid) => sum + volume(turned.intersect(solid)), 0) > tolerance)) fail('keying');
  }
  if (plan.profile === 'flatted-circle') {
    // Far below the sliver a turned pin cuts, even the thinnest with the largest clearance at the largest size.
    const overlap = Math.min(tolerance, FLAT_SIDE_OVERLAP_MM3);
    const receiving = plan.type === 'plug' ? [built.upper] : [built.lower, built.upper];
    for (const site of plan.sites) {
      for (const turn of [Math.PI / 2, Math.PI]) {
        const turned = loftAlongN(kernel, track, plan.frame, siteRings(plan, site), pinLayers(plan, site), turn);
        if (receiving.some((part) => !(volume(turned.intersect(part)) > overlap))) fail('profile-keying');
      }
    }
  }
}
