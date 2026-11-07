import { type CylinderShape, DIAMETRAL_CLEARANCE_LIMITS, type PhysicalScale, type RoundConnector } from '@diploma-3d/schema';
import type { Vec2 as KernelVec2, Manifold, Mat4 } from 'manifold-3d';
import { ConnectorVerificationError } from '../errors.ts';
import type { GeometryKernel } from '../kernel.ts';
import type { Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';
import type { Vec2 } from '../shapes/polygon.ts';
import { circularSegments } from '../shapes/round.ts';
import { type ConnectorFeasibility, connectorFeasibility, type ParameterSpec } from './bounds.ts';
import {
  CONNECTOR_MIN_WALL_MM,
  type CylinderSection,
  connectorVolumeTolerance,
  cylinderSection,
  frameMatrix,
  framePoint,
  type SectionFrame,
  satisfies,
} from './frame.ts';

/**
 * Initial experimental proportions for print trials, relative to the assembled model's longest dimension M: the primary
 * diameter d = 0,0625·M·kd, the insertion length e = 0,05·M·ke into one receiving part, and the second diameter of a
 * pair, 0,8·d. At M = 80 mm and kd = ke = 1: d = 5 mm, 4 mm for the second, e = 4 mm, dowels 2e = 8 mm long.
 */
export const ROUND_CONNECTOR_PROPORTIONS = { diameter: 0.0625, insertion: 0.05, secondaryDiameter: 0.8 } as const;

/** Every blind hole is this much deeper than the length that enters it: e + 0,3 mm. */
export const ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM = 0.3;

/**
 * Conservative thresholds for first trials with a 0,4 mm nozzle, not a strength guarantee: the thinnest pin, every wall
 * around and beneath a hole and between holes, the straight engagement left in a receiving part after chamfers and
 * axial play, and by how much the larger pin of a pair is wider than the smaller hole, so that the parts cannot be
 * joined turned by 180°.
 */
export const ROUND_CONNECTOR_MINIMUMS_MM = {
  pinDiameter: 3,
  wall: CONNECTOR_MIN_WALL_MM,
  straightEngagement: 2,
  keying: 0.5,
} as const;

/** How far an integral plug reaches into the lower part below the cut, so that the union is not coplanar. */
export const PLUG_ROOT_OVERLAP_MM = 0.2;

/** The 45° chamfer on pin ends and hole entrances: min(0,08·local pin diameter, 0,2·e). */
export const ROUND_CONNECTOR_CHAMFER = { diameter: 0.08, insertion: 0.2 } as const;

// Hole cutters continue past the cut face, so that no membrane is left over an entrance.
const CUTTER_MARGIN_MM = 0.5;

/** One connector position: the axis through `centre` on the cut, along n. */
export interface RoundConnectorSite {
  readonly centre: Vec3;
  /** The position along u from the section's centre. */
  readonly along: number;
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
  | { readonly code: 'base-thin'; readonly valueMm: number; readonly minimumMm: number };

export interface RoundConnectorPlan {
  readonly type: 'plug' | 'dowel';
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
  readonly issues: readonly RoundConnectorIssue[];
}

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
  /** d, the primary pin; a pair's second pin is 0,8·d. */
  readonly diameter: number;
  /** e: how far a plug protrudes, or a dowel enters each part. */
  readonly insertion: number;
  /** s: a pair's distance from the section's centre along u; zero for one connector. */
  readonly spacing: number;
  /** The diametral clearance of the holes in each part; plugs have holes in the upper part only. */
  readonly clearance: { readonly lower?: number; readonly upper: number };
}

/** The settings in millimetres: d and e from M, and a pair's spacing as its percentage of the radius r. */
export function roundConnectorDimensions(
  connector: RoundConnector,
  longestDimensionMm: number,
  radiusMm: number,
): RoundConnectorDimensions {
  const { diameter, insertion } = roundConnectorDimensionsMm(connector.diameterFactor, connector.depthFactor, longestDimensionMm);
  return {
    type: connector.type,
    count: connector.count,
    diameter,
    insertion,
    spacing: ((connector.spacingPercent ?? 0) / 100) * radiusMm,
    clearance:
      connector.type === 'plug'
        ? { upper: connector.holeClearanceMm }
        : { lower: connector.lowerClearanceMm, upper: connector.upperClearanceMm },
  };
}

/** The 45° chamfer of a pin end and of its hole's entrance; both ends of a site share it. */
const chamferOf = (pinDiameter: number, insertion: number) =>
  Math.min(ROUND_CONNECTOR_CHAMFER.diameter * pinDiameter, ROUND_CONNECTOR_CHAMFER.insertion * insertion);

/** The pins along u, primary first: at the centre, or at +s with d and at −s with 0,8·d. */
function siteLayout({ count, diameter, insertion, spacing }: RoundConnectorDimensions) {
  const site = (along: number, pinDiameter: number) => ({ along, pinDiameter, chamfer: chamferOf(pinDiameter, insertion) });
  return count === 1
    ? [site(0, diameter)]
    : [site(spacing, diameter), site(-spacing, ROUND_CONNECTOR_PROPORTIONS.secondaryDiameter * diameter)];
}

/**
 * Every construction constraint of the plugs or dowels, satisfied or not, always the same ones in the same order for a
 * type and count, so that the bounds of each dimension can be solved from them (see `roundConnectorFeasibility`).
 *
 * - The thinnest pin, 0,8·d of a pair, is at least 3 mm.
 * - The straight engagement e − play − 2·chamfer of every site is at least 2 mm: the pin's end and the hole's entrance
 *   each take one chamfer, and a dowel may slide by the 0,3 mm depth allowance towards the opposite hole's bottom; an
 *   integral plug sits fully home.
 * - A pair keys the parts: d − (0,8·d + the larger diametral clearance) ≥ 0,5 mm, on the straight hole, so that the
 *   larger pin enters neither smaller hole.
 * - In each receiving part, the wall beside every hole is at least 1,2 mm where the hole is widest (the chamfered
 *   entrance at the cut), where its straight wall starts and at its bottom e + 0,3 mm deep. The wall is measured to the
 *   polygon's inscribed circle, at each depth from the section's centre moved by an oblique cylinder's lean; the
 *   distance from the moved centre is convex in the depth, so these three depths bound the whole hole.
 * - Between a pair's entrances, and under each hole's bottom, at least 1,2 mm remain; under a plug the lower part keeps
 *   1,2 mm below its root overlap.
 *
 * Each value is monotone in d, e, s and each clearance, which the bounds rely on: a larger d widens holes and
 * chamfers, a larger e deepens holes and may lengthen chamfers, a larger s moves holes apart and outwards.
 */
export function roundConnectorChecks(section: CylinderSection, dimensions: RoundConnectorDimensions): RoundConnectorIssue[] {
  const { inradius, leanAcross } = section;
  const { type, insertion, clearance } = dimensions;
  const sites = siteLayout(dimensions);
  const holeDepth = insertion + ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM;
  const play = type === 'dowel' ? ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM : 0;
  const { pinDiameter, wall, straightEngagement, keying } = ROUND_CONNECTOR_MINIMUMS_MM;
  const checks: RoundConnectorIssue[] = [
    { code: 'pin-too-thin', valueMm: Math.min(...sites.map((site) => site.pinDiameter)), minimumMm: pinDiameter },
    {
      code: 'engagement-short',
      valueMm: Math.min(...sites.map(({ chamfer }) => insertion - play - 2 * chamfer)),
      minimumMm: straightEngagement,
    },
  ];
  if (sites.length === 2) {
    const [primary, secondary] = sites as [(typeof sites)[number], (typeof sites)[number]];
    const widest = Math.max(clearance.upper, clearance.lower ?? 0);
    checks.push({ code: 'keying-lost', valueMm: primary.pinDiameter - (secondary.pinDiameter + widest), minimumMm: keying });
  }
  const parts: [Part, number, number][] = [['upper', clearance.upper, section.upperThickness]];
  if (clearance.lower !== undefined) parts.push(['lower', clearance.lower, section.lowerThickness]);
  for (const [part, holeClearance, thickness] of parts) {
    const holes = sites.map(({ along, pinDiameter: pin, chamfer }) => {
      const straight = (pin + holeClearance) / 2;
      return { along, chamfer, straight, opening: straight + chamfer };
    });
    const sideWall = Math.min(
      ...holes.flatMap(({ along, chamfer, straight, opening }) =>
        [
          [0, opening],
          [chamfer, straight],
          [holeDepth, straight],
        ].map(([depth, radius]) => inradius - Math.hypot(along, leanAcross * (depth as number)) - (radius as number)),
      ),
    );
    checks.push({ code: 'hole-wall-thin', part, valueMm: sideWall, minimumMm: wall });
    if (holes.length === 2) {
      const [first, second] = holes as [(typeof holes)[number], (typeof holes)[number]];
      const between = Math.abs(first.along - second.along) - first.opening - second.opening;
      checks.push({ code: 'holes-too-close', part, valueMm: between, minimumMm: wall });
    }
    checks.push({ code: 'hole-bottom-thin', part, valueMm: thickness - holeDepth, minimumMm: wall });
  }
  if (type === 'plug') {
    checks.push({ code: 'base-thin', valueMm: section.lowerThickness - PLUG_ROOT_OVERLAP_MM, minimumMm: wall });
  }
  return checks;
}

/**
 * The plugs or dowels of a cylinder cut parallel to its bases, in millimetres of the built solid, and the issues that
 * rule them out; pure, so that the interface can explain a combination before anything is built. Every axis is the
 * cut's normal n. See `roundConnectorChecks` for the constraints.
 */
export function planRoundConnectors(
  shape: CylinderShape,
  scale: PhysicalScale,
  positionPercent: number,
  connector: RoundConnector,
): RoundConnectorPlan {
  const section = cylinderSection(shape, scale, positionPercent);
  const dimensions = roundConnectorDimensions(connector, scale.longestDimensionMm, section.radius);
  const { frame } = section;
  const { insertion, clearance } = dimensions;
  const sites = siteLayout(dimensions).map((site) => ({ ...site, centre: framePoint(frame, [site.along, 0, 0]) }));
  const play = connector.type === 'dowel' ? ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM : 0;
  return {
    type: connector.type,
    frame,
    sites,
    insertion,
    holeDepth: insertion + ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM,
    clearance,
    straightEngagement: Math.min(...sites.map(({ chamfer }) => insertion - play - 2 * chamfer)),
    issues: roundConnectorChecks(section, dimensions).filter((check) => !satisfies(check)),
  };
}

/** The round connectors' dimensions in millimetres, each solved for with the others fixed. */
export type RoundConnectorParameter = 'diameter' | 'insertion' | 'spacing' | 'lowerClearance' | 'upperClearance';

/**
 * Which values of each dimension the current cylinder, cut and other dimensions allow, from the same checks that
 * `planRoundConnectors` applies. The search envelopes follow from the model: a diameter within the section's
 * diameter, an insertion within the cylinder's height and a spacing within its radius; clearances stay within their
 * calibration window, a policy for print trials rather than a geometric limit. A pair has a spacing, dowels a lower
 * clearance.
 */
export function roundConnectorFeasibility(
  shape: CylinderShape,
  scale: PhysicalScale,
  positionPercent: number,
  connector: RoundConnector,
): ConnectorFeasibility<RoundConnectorParameter, RoundConnectorIssue> {
  const section = cylinderSection(shape, scale, positionPercent);
  const dimensions = roundConnectorDimensions(connector, scale.longestDimensionMm, section.radius);
  const { radius, lowerThickness, upperThickness } = section;
  const height = lowerThickness + upperThickness;
  const parameters: ParameterSpec<RoundConnectorParameter, RoundConnectorDimensions>[] = [
    {
      key: 'diameter',
      envelope: { min: 0, max: 2 * radius },
      value: dimensions.diameter,
      with: (current, diameter) => ({ ...current, diameter }),
    },
    {
      key: 'insertion',
      envelope: { min: 0, max: height },
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
      envelope: { min: 0, max: radius },
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

/**
 * The profile of a pin in (radius, axial), counter-clockwise, from `bottom` to `top`, with 45° chamfers of `chamfer`
 * at the ends that are given; a missing chamfer leaves the end square.
 */
function pinProfile(radius: number, bottom: number, top: number, chamfer: { bottom?: number; top?: number }): Vec2[] {
  const lower = chamfer.bottom ?? 0;
  const upper = chamfer.top ?? 0;
  return [
    [0, bottom],
    ...(lower > 0 ? ([[radius - lower, bottom]] as Vec2[]) : []),
    [radius, bottom + lower],
    [radius, top - upper],
    ...(upper > 0 ? ([[radius - upper, top]] as Vec2[]) : []),
    [0, top],
  ];
}

/**
 * A blind hole opening at the cut and reaching `depth` into the part: straight with radius `radius`, widened at the
 * entrance by a 45° chamfer, and continued past the cut by the cutter margin. Built upwards; the lower part's hole is
 * its mirror image.
 */
function holeProfile(radius: number, chamfer: number, depth: number): Vec2[] {
  return [
    [0, -CUTTER_MARGIN_MM],
    [radius + chamfer + CUTTER_MARGIN_MM, -CUTTER_MARGIN_MM],
    [radius, chamfer],
    [radius, depth],
    [0, depth],
  ];
}

/** The mirror image along the axis, still counter-clockwise. */
const mirrored = (profile: readonly Vec2[]): Vec2[] => profile.map(([x, y]): Vec2 => [x, -y]).reverse();

export interface RoundConnectorParts {
  readonly lower: Manifold;
  readonly upper: Manifold;
  /** The separate dowels in their assembled position, primary first; none for plugs. */
  readonly pins: readonly Manifold[];
  /** Per site: the plug or dowel, and the hole cutters by part. */
  readonly sites: readonly { readonly pin: Manifold; readonly cutters: Partial<Record<Part, Manifold>> }[];
}

/**
 * Builds the plugs or dowels on the parts. Pins and holes of a site are revolved with the same number of segments from
 * the same starting angle, so that their polygons are aligned and the diametral clearance holds between corresponding
 * vertices; the count follows the project's circle accuracy for the largest radius involved.
 */
export function buildRoundConnectors(
  kernel: GeometryKernel,
  track: Track,
  parts: { readonly lower: Manifold; readonly upper: Manifold },
  plan: RoundConnectorPlan,
): RoundConnectorParts {
  const { frame, insertion: e, holeDepth, clearance } = plan;
  const revolve = (profile: readonly Vec2[], segments: number, centre: Vec3): Manifold => {
    const local = track(kernel.Manifold.revolve([profile.map(([x, y]) => [x, y] as KernelVec2)], segments));
    return track(local.transform(frameMatrix(frame, centre)));
  };
  const sites = plan.sites.map(({ centre, pinDiameter, chamfer }) => {
    const pinRadius = pinDiameter / 2;
    const holeRadius = (part: Part) => (pinDiameter + (clearance[part] ?? 0)) / 2;
    const segments = circularSegments(holeRadius('upper') + chamfer + CUTTER_MARGIN_MM);
    const pin =
      plan.type === 'plug'
        ? revolve(pinProfile(pinRadius, -PLUG_ROOT_OVERLAP_MM, e, { top: chamfer }), segments, centre)
        : revolve(pinProfile(pinRadius, -e, e, { bottom: chamfer, top: chamfer }), segments, centre);
    const upper = holeProfile(holeRadius('upper'), chamfer, holeDepth);
    const cutters: Partial<Record<Part, Manifold>> = { upper: revolve(upper, segments, centre) };
    if (clearance.lower !== undefined) {
      cutters.lower = revolve(mirrored(holeProfile(holeRadius('lower'), chamfer, holeDepth)), segments, centre);
    }
    return { pin, cutters };
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
  return { lower, upper, pins: plan.type === 'dowel' ? sites.map((entry) => entry.pin) : [], sites };
}

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
 * - Each half and each dowel is one connected solid, so an integral plug is attached to the lower part.
 * - Neither half leaves the uncut cylinder, and no hole breaks through its outer surface.
 * - Nothing overlaps in the assembled position, also with a dowel pushed to either hole's bottom.
 * - The parts come apart along n: each plug or seated dowel, swept along −n out of the upper part, and each dowel,
 *   swept along +n out of the lower part, meets nothing. Every sweep is the convex hull of a convex solid of revolution
 *   and its translate, which is exactly the swept volume.
 * - A pair keys the parts: the upper part turned by 180° about the section's axis meets the plugs or dowels.
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
  for (const solid of [built.lower, built.upper, ...built.pins]) {
    const pieces = solid.decompose();
    for (const piece of pieces) track(piece);
    if (pieces.length !== 1) fail('connected');
  }
  if (volume(built.lower.subtract(whole)) > tolerance) fail('lower-inside-envelope');
  if (volume(built.upper.subtract(whole)) > tolerance) fail('upper-inside-envelope');
  for (const { cutters } of built.sites) {
    for (const cutter of Object.values(cutters)) if (volume(cutter.subtract(whole)) > tolerance) fail('no-breakthrough');
  }
  if (volume(built.lower.intersect(built.upper)) > tolerance) fail('no-overlap');
  for (const pin of built.pins) {
    for (const shift of [-ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM, 0, ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM]) {
      const moved = track(pin.translate(along(shift)));
      if (volume(moved.intersect(built.lower)) > tolerance || volume(moved.intersect(built.upper)) > tolerance) {
        fail('dowel-fit');
      }
    }
    const out = track(kernel.Manifold.hull([pin, track(pin.translate(along(2 * plan.insertion + 1)))]));
    if (volume(out.intersect(built.lower)) > tolerance) fail('dowel-removal');
  }
  for (const { pin } of built.sites) {
    const sweep = track(kernel.Manifold.hull([pin, track(pin.translate(along(-(plan.holeDepth + 1))))]));
    if (volume(sweep.intersect(built.upper)) > tolerance) fail('separation-path');
  }
  if (plan.sites.length === 2) {
    const turned = track(built.upper.transform(halfTurnAbout(n, origin)));
    const mating = plan.type === 'plug' ? [built.lower] : built.pins;
    if (!(mating.reduce((sum, solid) => sum + volume(turned.intersect(solid)), 0) > tolerance)) fail('keying');
  }
}
