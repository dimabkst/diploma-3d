import { BAYONET_LIMITS, type BayonetConnector, type PhysicalScale } from '@diploma-3d/schema';
import type { Manifold, Mat4 } from 'manifold-3d';
import { ConnectorUnsuitableError, ConnectorVerificationError } from '../errors.ts';
import type { GeometryKernel } from '../kernel.ts';
import type { Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';
import type { Vec2 } from '../shapes/polygon.ts';
import { circularSegments } from '../shapes/round.ts';
import { type ConnectorFeasibility, connectorFeasibility } from './bounds.ts';
import {
  CONNECTOR_MIN_WALL_MM,
  frameMatrix,
  type ParallelCylinderSection,
  type SectionedShape,
  type SectionFrame,
  type SolidCut,
  satisfies,
  solidCut,
} from './frame.ts';

/**
 * An experimental bayonet between the parts of a right cylinder cut parallel to its bases. All of it is in the cut plane's
 * coordinates: x along v, y along u, z along n from the lower part into the upper one, with angles counter-clockwise about z
 * from +x. The lower part stands still; the upper part's pose φ is its turn about z from its original orientation.
 *
 * Locked pose: φ = 0, the cut faces meet. Insertion pose: φ = −45°. Closing inserts axially and turns φ from −45° to 0.
 *
 * A point fixed on the male appears in the upper part's own coordinates turned by −φ, so that a lug at θ enters at θ + 45° and
 * ends at θ: every channel of the upper part runs from there clockwise back to the locked position.
 *
 * Four separate functions, each with its own surfaces:
 * - The clearances let the male in and around: every sliding side surface of the socket lies g = Δ/2 outside the male's, and
 *   each lug has a gap a above and below it.
 * - The ledges hold it axially: the track's floor lies under the lug in the locked pose, and the lug need not bend.
 * - The end stop sets the closing angle: the plane of each lug's leading flank in the locked pose, with no clearance added, so
 *   that the stop is at exactly φ = 0.
 * - The detent resists turning back: a cantilever tongue in the stem's wall, whose bump must pass a cam in the socket.
 */

export const BAYONET_TRAVEL_DEG = 45;

/**
 * Printing thresholds for a first trial with PLA, a 0,4 mm nozzle and 0,2 mm layers, not a strength guarantee: the tip width of
 * the narrower lug (five lines), the stem's solid core inside the tongue's relief, how far a lug reaches over its ledge, the
 * least thickness of a ledge at the bore (eight layers), and by how much the wider lug overlaps the narrower entry at the
 * largest clearance allowed, so that it cannot be forced in by play alone.
 */
export const BAYONET_MINIMUMS_MM = {
  wall: CONNECTOR_MIN_WALL_MM,
  narrowLugWidth: 2,
  stemCore: 4,
  lugBearing: 1,
  ledge: 1.6,
  keying: 0.2,
  ledgeGap: 0.2,
} as const;

/**
 * The tongue, in absolute millimetres, as it is sized by the nozzle and the material rather than by the model. Three lines
 * thick, in the stem's wall and along the layers, so that bending never pulls layers apart, which a vertical tab would. Its
 * underside rises at 45° to its free end to print without support, which also tapers it; the prismatic beam's outer-fibre
 * strain 3·δ·t/(2·L²) therefore bounds its own. The limit of 1 % is provisional: well under PLA's yield, for repeated use. The
 * relief behind it is two lines wide, and leaves room beyond the deflection.
 */
export const BAYONET_FLEXURE = {
  thickness: 1.2,
  length: 7.4,
  relief: 0.8,
  underGap: 0.8,
  tipGap: 0.8,
  floorAboveCut: 1,
  tipHeight: 2,
  strainLimit: 0.01,
  travelMargin: 0.3,
} as const;

/**
 * The bump and the cam. Turning back climbs the 45° flanks, closing the gentler 30° ones, so that it resists opening more than
 * closing. In the locked pose the bump clears the cam by `pocketPlay` and the socket's wall by g, unloaded.
 */
const DETENT = {
  crestFlat: 0.3,
  closingRampDeg: 30,
  openingRampDeg: 45,
  tipBeyondBump: 0.4,
  pocketPlay: 0.25,
  reliefEndClearance: 0.3,
} as const;

/** Lug proportions, internal to this prototype: fixed for a stem, so that a new clearance never changes the male. */
const LUG = {
  minDepth: 2,
  depthPerRadius: 0.3,
  minTipHeight: 2,
  tipHeightPerRadius: 0.3,
  wideHalfWidthPerRadius: 0.34,
  // Half a tip's width grows by this much per millimetre towards the root, which keeps it from being a notched tab.
  taper: 0.1,
  // How far an entry reaches at the largest clearance, and the wider lug's further overlap of it.
  widthDifference: BAYONET_LIMITS.holeClearanceMm.max / 2 + 0.25,
} as const;

/**
 * The 45° lead-in around the entries, which also leaves room for a first layer's elephant foot on the bed. No multiple of the
 * controls' 0,025 mm: the bump's arc, at g + δ outside the bore, then never meets the lead-in's cone just in the cut plane.
 */
export const BAYONET_MOUTH_CHAMFER_MM = 0.42;
/** The gusset around the stem's root: smaller than the lead-in, so that the two never touch. */
const ROOT_CHAMFER_MM = 0.3;
// The tongue's underside falls this much per millimetre on the stem's surface: over 1, since facets between its rings, which
// run across a radius and along an arc at once, otherwise lie a few degrees flatter than the 45° of its lines.
const UNDERSIDE_SLOPE = 1.1;
// Surfaces that meet at the stem's top and the mouth can leave edges this short, which float32 would collapse into zero-area
// triangles: three micrometres, far below every clearance and what a print can show. A large model's coordinates round more
// coarsely, also after its parts move apart on the plate, so that it follows the model's size: 10 µm at its largest.
const CLEANUP_MM = 3e-3;
const CLEANUP_PER_MODEL_MM = 1e-5;
const ENTRY_LEAD_EXTRA_MM = 0.05;
// An entry reaches this much beyond its track, so that the two arcs of nearly one circle cross instead of running together.
const ENTRY_RADIUS_EXTRA_MM = 0.02;
const ROOT_OVERLAP_MM = 0.2;
// Cutters and outlines start this far inside what they join, so that no two surfaces of a Boolean operation coincide.
const OVERLAP_MM = 0.5;
const ARC_STEP_RAD = (3 * Math.PI) / 180;
const CUTTER_MARGIN_MM = 1;
// More than a Boolean's roundoff and less than any real contact, which is a whole flank or ledge.
const BLOCKED_MM3 = 0.01;
// A contact below this is Boolean roundoff of surfaces that coincide, such as a flank on its stop. Fixed, unlike other connectors':
// the mechanism's size does not follow the model's, and neither may what its checks overlook.
const FIT_VOLUME_TOLERANCE_MM3 = 0.002;
// The further deflection the sweep leaves the bump over the cam: elastic contact, not a rigid one.
const CAM_PASS_MARGIN_MM = 0.005;

const TRAVEL_RAD = (BAYONET_TRAVEL_DEG * Math.PI) / 180;
const TAPER_COSINE = Math.cos(Math.atan(LUG.taper));
const TAN_CLOSING = Math.tan((DETENT.closingRampDeg * Math.PI) / 180);
const TAN_OPENING = Math.tan((DETENT.openingRampDeg * Math.PI) / 180);
const WIDE_CENTRE_RAD = 0;
const NARROW_CENTRE_RAD = Math.PI;

export type BayonetLugKind = 'wide' | 'narrow';

export interface BayonetDimensions {
  /** d: the stem's diameter. */
  readonly diameter: number;
  /** H: how far it stands above the cut plane. */
  readonly projection: number;
  /** Δ = 2g. */
  readonly holeClearance: number;
  /** a: per opposed pair of axial faces. */
  readonly axialClearance: number;
  /** δ: how far the tongue deflects to pass the cam. */
  readonly interference: number;
}

export const bayonetDimensions = (connector: BayonetConnector): BayonetDimensions => ({
  diameter: connector.stemDiameterMm,
  projection: connector.projectionMm,
  holeClearance: connector.holeClearanceMm,
  axialClearance: connector.axialClearanceMm,
  interference: connector.detentInterferenceMm,
});

/** Every derived dimension of the mechanism, in the cut plane's coordinates. */
export interface BayonetLayout extends BayonetDimensions {
  readonly stemRadius: number;
  /** g = Δ/2. */
  readonly sideClearance: number;
  readonly boreRadius: number;
  readonly lugDepth: number;
  readonly lugRadius: number;
  readonly lugTipHeight: number;
  /** z of a lug's underside at the stem; it rises at 45° from there to the lug's tip. */
  readonly lugUnderside: number;
  readonly trackRadius: number;
  /** Half the tip width of each lug. */
  readonly wideHalfWidth: number;
  readonly narrowHalfWidth: number;
  /** Where the conical roof reaches its apex on the axis: the socket's whole depth. */
  readonly socketDepth: number;
  /** The stem's solid radius inside the tongue's relief. */
  readonly coreRadius: number;
  readonly grooveRadius: number;
  readonly crestRadius: number;
  /** The bump's crest at the locked pose, and how far its base reaches on either side. */
  readonly crestAngle: number;
  readonly bumpClockwise: number;
  readonly bumpCounterClockwise: number;
  /** The tongue's ends in the locked pose: the free tip and the root. */
  readonly tipAngle: number;
  readonly rootAngle: number;
  /** How long the tongue can be between its tip and the narrower lug's root. */
  readonly availableTongue: number;
  /** The bore's enlarged arc that lets the bump pass. */
  readonly reliefFrom: number;
  readonly reliefTo: number;
  /** The cam: base, crest, crest and base, clockwise to counter-clockwise; none when the interference is zero. */
  readonly cam: readonly [number, number, number, number] | undefined;
  /** The deflection the flexure can take. */
  readonly travel: number;
}

/** Half a lug's width at the distance s along its centre line: the tip's, growing towards the root. */
const lugHalfWidth = (tip: number, lugRadius: number, s: number) => tip + LUG.taper * (lugRadius - s);

const halfAngle = (halfWidth: number, radius: number) => Math.asin(Math.min(1, Math.max(0, halfWidth / radius)));

/** The derived dimensions; finite for any positive inputs, so that the constraints can be solved over wide ranges. */
export function bayonetLayout(dimensions: BayonetDimensions): BayonetLayout {
  const { diameter, projection, holeClearance, axialClearance, interference } = dimensions;
  const stemRadius = diameter / 2;
  const sideClearance = holeClearance / 2;
  const boreRadius = stemRadius + sideClearance;
  const lugDepth = Math.max(LUG.minDepth, LUG.depthPerRadius * stemRadius);
  const lugRadius = stemRadius + lugDepth;
  const lugTipHeight = Math.max(LUG.minTipHeight, LUG.tipHeightPerRadius * stemRadius);
  const wideHalfWidth = LUG.wideHalfWidthPerRadius * stemRadius;
  const narrowHalfWidth = wideHalfWidth - LUG.widthDifference;
  const coreRadius = stemRadius - BAYONET_FLEXURE.thickness - BAYONET_FLEXURE.relief;
  const crestRadius = boreRadius + interference;
  const grooveRadius = crestRadius + sideClearance;
  const camHeight = grooveRadius - boreRadius;
  const bumpHeight = crestRadius - stemRadius;
  const bumpClockwise = (DETENT.crestFlat / 2 + bumpHeight / TAN_CLOSING) / stemRadius;
  const bumpCounterClockwise = (DETENT.crestFlat / 2 + bumpHeight / TAN_OPENING) / stemRadius;
  // At the largest clearance and least radius of the trial windows, so that the tongue's place, and with it the whole male but
  // for its bump, depends on the stem alone: one stem can then try every clearance. One wall from the wider entry at its widest
  // gives the bump's arc, and with it the tongue, the most room.
  const widestSide = BAYONET_LIMITS.holeClearanceMm.max / 2;
  const reliefEnd = Math.max(widestSide, DETENT.reliefEndClearance) / stemRadius;
  const nearest = stemRadius + BAYONET_LIMITS.holeClearanceMm.min / 2;
  const wideEntryEdge =
    TRAVEL_RAD +
    halfAngle(
      lugHalfWidth(wideHalfWidth, lugRadius, nearest) +
        (widestSide + BAYONET_MOUTH_CHAMFER_MM + ENTRY_LEAD_EXTRA_MM) / TAPER_COSINE,
      nearest,
    );
  const reliefFrom = wideEntryEdge + BAYONET_MINIMUMS_MM.wall / nearest;
  const crestAngle = reliefFrom + reliefEnd + bumpClockwise;
  const reliefTo = crestAngle + TRAVEL_RAD + bumpCounterClockwise + reliefEnd;
  const tipAngle = crestAngle - bumpClockwise - DETENT.tipBeyondBump / stemRadius;
  const beamRadius = stemRadius - BAYONET_FLEXURE.thickness / 2;
  const rootLimit =
    Math.PI -
    halfAngle(lugHalfWidth(narrowHalfWidth, lugRadius, stemRadius), stemRadius) -
    (BAYONET_FLEXURE.relief / 2 + CONNECTOR_MIN_WALL_MM) / stemRadius;
  const camBase = crestAngle + (DETENT.crestFlat / 2 + DETENT.pocketPlay - sideClearance) / stemRadius;
  const camCrest = camBase + camHeight / TAN_OPENING / boreRadius;
  const camCrestEnd = camCrest + DETENT.crestFlat / boreRadius;
  return {
    ...dimensions,
    stemRadius,
    sideClearance,
    boreRadius,
    lugDepth,
    lugRadius,
    lugTipHeight,
    lugUnderside: projection - lugTipHeight - lugDepth,
    trackRadius: lugRadius + sideClearance,
    wideHalfWidth,
    narrowHalfWidth,
    socketDepth: projection + axialClearance + lugRadius,
    coreRadius,
    grooveRadius,
    crestRadius,
    crestAngle,
    bumpClockwise,
    bumpCounterClockwise,
    tipAngle,
    rootAngle: tipAngle + BAYONET_FLEXURE.length / beamRadius,
    availableTongue: (rootLimit - tipAngle) * beamRadius,
    reliefFrom,
    reliefTo,
    cam: interference > 0 ? [camBase, camCrest, camCrestEnd, camCrestEnd + camHeight / TAN_CLOSING / boreRadius] : undefined,
    travel: bayonetFlexureTravel(),
  };
}

/** The deflection the tongue allows: what its relief leaves room for, and what the strain limit allows, 2εL²/(3t). */
export function bayonetFlexureTravel(): number {
  const { relief, travelMargin, strainLimit, length, thickness } = BAYONET_FLEXURE;
  return Math.min(relief - travelMargin, (2 * strainLimit * length * length) / (3 * thickness));
}

/** The prismatic beam's outer-fibre strain at a deflection: an upper bound of the tapered tongue's; no measured value. */
export const bayonetFlexureStrain = (deflection: number): number =>
  (3 * deflection * BAYONET_FLEXURE.thickness) / (2 * BAYONET_FLEXURE.length * BAYONET_FLEXURE.length);

/** How far the whole tongue's height and the gap beneath it reach below the stem's top, from the tip to the root's end. */
const tongueHeightAtRoot = (layout: BayonetLayout) =>
  BAYONET_FLEXURE.tipHeight + UNDERSIDE_SLOPE * (layout.rootAngle - layout.tipAngle) * layout.stemRadius;

/**
 * The least height for a stem: what its tongue needs, with the 45° underside from the tip to the root over the floor of the
 * relief, and what a lug needs over its ledge at the bore, through which the mouth's chamfer also runs.
 */
export function leastBayonetProjection(dimensions: Omit<BayonetDimensions, 'projection'>): number {
  const layout = bayonetLayout({ ...dimensions, projection: 0 });
  const forTongue = BAYONET_FLEXURE.floorAboveCut + BAYONET_FLEXURE.underGap + tongueHeightAtRoot(layout);
  const forLedge =
    BAYONET_MINIMUMS_MM.ledge +
    BAYONET_MOUTH_CHAMFER_MM +
    layout.axialClearance -
    layout.sideClearance +
    layout.lugTipHeight +
    layout.lugDepth;
  return Math.max(forTongue, forLedge);
}

/** How far the socket reaches at the mouth, the entries' lead-in included: its widest ring. */
const mouthRadius = ({ trackRadius }: Pick<BayonetLayout, 'trackRadius'>) =>
  trackRadius + ENTRY_RADIUS_EXTRA_MM + BAYONET_MOUTH_CHAMFER_MM + ENTRY_LEAD_EXTRA_MM;

type Measured<Code extends string> = { readonly code: Code; readonly valueMm: number; readonly minimumMm: number };

export type BayonetIssue = Measured<
  | 'lug-too-narrow'
  | 'lug-keying-lost'
  | 'lug-bearing-short'
  | 'ledge-gap-short'
  | 'stem-core-thin'
  | 'tongue-too-short'
  | 'detent-travel-short'
  | 'projection-too-low'
  | 'ledge-thin'
  | 'socket-rib-thin'
  | 'socket-wall-thin'
  | 'socket-roof-thin'
  | 'base-thin'
>;

/**
 * Every constraint of the mechanism, in the same order at any dimensions. The socket's widest ring is at the mouth, where the
 * chamfer widens the entries; its deepest point is the roof's apex, and each is measured on the actual cavity, reliefs included.
 * The ledge lies between a lug and the entry it left: `ledge-gap-short` is the arc left at the radius of the lug's bearing.
 */
export function bayonetChecks(section: ParallelCylinderSection, dimensions: BayonetDimensions): BayonetIssue[] {
  const layout = bayonetLayout(dimensions);
  const { boreRadius, lugRadius, lugDepth, sideClearance, wideHalfWidth, narrowHalfWidth } = layout;
  const { wall } = BAYONET_MINIMUMS_MM;
  const bearing = boreRadius + 0.3;
  const clearest = (kind: BayonetLugKind) => {
    const tip = kind === 'wide' ? wideHalfWidth : narrowHalfWidth;
    const half = lugHalfWidth(tip, lugRadius, bearing);
    return bearing * (TRAVEL_RAD - halfAngle(half, bearing) - halfAngle(half + sideClearance / TAPER_COSINE, bearing));
  };
  const largestSide = BAYONET_LIMITS.holeClearanceMm.max / 2;
  const narrowStop = Math.PI - halfAngle(lugHalfWidth(narrowHalfWidth, lugRadius, layout.grooveRadius), layout.grooveRadius);
  return [
    { code: 'lug-too-narrow', valueMm: 2 * narrowHalfWidth, minimumMm: BAYONET_MINIMUMS_MM.narrowLugWidth },
    {
      code: 'lug-keying-lost',
      valueMm: wideHalfWidth - narrowHalfWidth - largestSide / TAPER_COSINE,
      minimumMm: BAYONET_MINIMUMS_MM.keying,
    },
    { code: 'lug-bearing-short', valueMm: lugDepth - sideClearance, minimumMm: BAYONET_MINIMUMS_MM.lugBearing },
    {
      code: 'ledge-gap-short',
      valueMm: Math.min(clearest('wide'), clearest('narrow')),
      minimumMm: BAYONET_MINIMUMS_MM.ledgeGap,
    },
    { code: 'stem-core-thin', valueMm: 2 * layout.coreRadius, minimumMm: BAYONET_MINIMUMS_MM.stemCore },
    { code: 'tongue-too-short', valueMm: layout.availableTongue, minimumMm: BAYONET_FLEXURE.length },
    { code: 'detent-travel-short', valueMm: layout.travel, minimumMm: layout.interference },
    { code: 'projection-too-low', valueMm: layout.projection, minimumMm: leastBayonetProjection(dimensions) },
    {
      code: 'ledge-thin',
      valueMm: layout.lugUnderside - layout.axialClearance + sideClearance - BAYONET_MOUTH_CHAMFER_MM,
      minimumMm: BAYONET_MINIMUMS_MM.ledge,
    },
    { code: 'socket-rib-thin', valueMm: layout.grooveRadius * (narrowStop - layout.reliefTo), minimumMm: wall },
    {
      code: 'socket-wall-thin',
      valueMm: section.inradius - mouthRadius(layout),
      minimumMm: wall,
    },
    { code: 'socket-roof-thin', valueMm: section.upperThickness - layout.socketDepth, minimumMm: wall },
    { code: 'base-thin', valueMm: section.lowerThickness - ROOT_OVERLAP_MM, minimumMm: wall },
  ];
}

export interface BayonetPlan {
  readonly type: 'bayonet';
  readonly frame: SectionFrame;
  readonly layout: BayonetLayout;
  /** How far the finished parts may be simplified. */
  readonly cleanupMm: number;
  readonly issues: readonly BayonetIssue[];
}

/** Whether this prototype offers a bayonet here: a right cylinder cut parallel to its bases. */
export const bayonetSupported = (shape: SectionedShape, cut: SolidCut): boolean =>
  shape.kind === 'cylinder' && shape.offsetRatio === 0 && typeof cut === 'number';

function supportedSection(shape: SectionedShape, scale: PhysicalScale, cut: SolidCut): ParallelCylinderSection {
  if (!bayonetSupported(shape, cut)) throw new ConnectorUnsuitableError([{ code: 'bayonet-unsupported' }]);
  return solidCut(shape, scale, cut) as ParallelCylinderSection;
}

/** The mechanism's dimensions and what rules them out; pure, so that the interface can explain it before anything is built. */
export function planBayonet(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: BayonetConnector,
): BayonetPlan {
  const section = supportedSection(shape, scale, cut);
  const dimensions = bayonetDimensions(connector);
  return {
    type: 'bayonet',
    frame: section.frame,
    layout: bayonetLayout(dimensions),
    cleanupMm: Math.max(CLEANUP_MM, CLEANUP_PER_MODEL_MM * scale.longestDimensionMm),
    issues: bayonetChecks(section, dimensions).filter((check) => !satisfies(check)),
  };
}

export type BayonetParameter = 'diameter' | 'projection' | 'holeClearance' | 'axialClearance' | 'interference';

/** Which values of each dimension this cylinder, cut and the other dimensions allow, from the checks `planBayonet` applies. */
export function bayonetFeasibility(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: BayonetConnector,
): ConnectorFeasibility<BayonetParameter, BayonetIssue> {
  const section = supportedSection(shape, scale, cut);
  const dimensions = bayonetDimensions(connector);
  return connectorFeasibility((current) => bayonetChecks(section, current), dimensions, [
    {
      key: 'diameter',
      envelope: { min: 1, max: 2 * section.radius },
      value: dimensions.diameter,
      with: (current, diameter) => ({ ...current, diameter }),
    },
    {
      key: 'projection',
      envelope: { min: 0.5, max: section.depthExtent },
      value: dimensions.projection,
      with: (current, projection) => ({ ...current, projection }),
    },
    {
      key: 'holeClearance',
      envelope: BAYONET_LIMITS.holeClearanceMm,
      value: dimensions.holeClearance,
      with: (current, holeClearance) => ({ ...current, holeClearance }),
    },
    {
      key: 'axialClearance',
      envelope: BAYONET_LIMITS.axialClearanceMm,
      value: dimensions.axialClearance,
      with: (current, axialClearance) => ({ ...current, axialClearance }),
    },
    {
      key: 'interference',
      envelope: BAYONET_LIMITS.detentInterferenceMm,
      value: dimensions.interference,
      with: (current, interference) => ({ ...current, interference }),
    },
  ]);
}

const polar = (radius: number, angle: number): Vec2 => [radius * Math.cos(angle), radius * Math.sin(angle)];

/** The points of an arc, its ends included, no further apart than the arc step. */
function arc(radius: number, from: number, to: number): Vec2[] {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / ARC_STEP_RAD));
  return Array.from({ length: steps + 1 }, (_, index) => polar(radius, from + ((to - from) * index) / steps));
}

const signedArea = (points: readonly Vec2[]) =>
  points.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length] as Vec2;
    return sum + x * nextY - nextX * y;
  }, 0) / 2;

/** As the kernel's polygons: counter-clockwise, and with their own mutable points. */
const counterClockwise = (points: readonly Vec2[]): [number, number][] => {
  const copied = points.map(([x, y]): [number, number] => [x, y]);
  return signedArea(points) < 0 ? copied.reverse() : copied;
};

/** How far along a lug's centre line its flank, at `offset` outside the lug's, meets the circle of `radius`, and how far off it. */
function flankOnCircle(tip: number, lugRadius: number, offset: number, radius: number): { along: number; across: number } {
  const { taper } = LUG;
  const a = tip + taper * lugRadius + offset / TAPER_COSINE;
  const scale = 1 + taper * taper;
  const along = (a * taper + Math.sqrt(a * a * taper * taper - scale * (a * a - radius * radius))) / scale;
  return { along, across: a - taper * along };
}

const lugTip = (layout: BayonetLayout, kind: BayonetLugKind) => (kind === 'wide' ? layout.wideHalfWidth : layout.narrowHalfWidth);
const lugCentre = (kind: BayonetLugKind) => (kind === 'wide' ? WIDE_CENTRE_RAD : NARROW_CENTRE_RAD);

const turned = ([x, y]: Vec2, angle: number): Vec2 => [
  x * Math.cos(angle) - y * Math.sin(angle),
  x * Math.sin(angle) + y * Math.cos(angle),
];

/**
 * A lug's outline, or an entry's with `offset` outside it, with a fixed vertex count for any offset: the tapered flanks from where
 * they cross the circle `innerRadius`, inside what it joins, and the arc around the axis. Convex, centred on `centre`.
 */
function lugOutline(
  layout: BayonetLayout,
  kind: BayonetLugKind,
  centre: number,
  offset: number,
  innerRadius: number,
  radiusExtra = 0,
): Vec2[] {
  const tip = lugTip(layout, kind);
  const radius = layout.lugRadius + offset + radiusExtra;
  const { along, across } = flankOnCircle(tip, layout.lugRadius, offset, radius);
  const inner = flankOnCircle(tip, layout.lugRadius, offset, innerRadius);
  const reach = Math.atan2(across, along);
  const count = 8;
  const outer = Array.from({ length: count + 1 }, (_, index) => polar(radius, -reach + (2 * reach * index) / count));
  return [[inner.along, -inner.across] as Vec2, ...outer, [inner.along, inner.across] as Vec2].map((point) =>
    turned(point, centre),
  );
}

/**
 * A track in the upper part's coordinates, in the plan: from the stop, the plane of the lug's leading flank in the locked pose,
 * which no clearance moves, around the axis to its entry's centre line.
 */
function trackOutline(layout: BayonetLayout, kind: BayonetLugKind): Vec2[] {
  const centre = lugCentre(kind);
  const tip = lugTip(layout, kind);
  const inner = layout.boreRadius - OVERLAP_MM;
  const { along, across } = flankOnCircle(tip, layout.lugRadius, 0, layout.trackRadius);
  const stop = Math.atan2(across, along);
  const start = flankOnCircle(tip, layout.lugRadius, 0, inner);
  return [
    turned([start.along, -start.across], centre),
    ...arc(layout.trackRadius, centre - stop, centre + TRAVEL_RAD),
    polar(inner, centre + TRAVEL_RAD),
  ];
}

/** The bore's enlarged arc for the bump, in the plan, with the cam standing into it. */
function reliefOutline(layout: BayonetLayout): Vec2[] {
  const { grooveRadius, reliefFrom, reliefTo, cam } = layout;
  if (cam === undefined) return [[0, 0], ...arc(grooveRadius, reliefFrom, reliefTo)];
  const { crest, crestEnd } = camInsideBore(layout, cam);
  return [[0, 0], ...arc(grooveRadius, reliefFrom, cam[0]), crest, crestEnd, ...arc(grooveRadius, cam[3], reliefTo)];
}

/**
 * The cam's flanks continued a little inside the bore, whose wall then trims them: its crest is the bore's own surface, flush
 * with it wherever the polygons' vertices lie, with no surfaces that run along each other.
 */
function camInsideBore(
  { boreRadius, grooveRadius }: BayonetLayout,
  [base, crest, crestEnd, endBase]: readonly [number, number, number, number],
) {
  const further = OVERLAP_MM / 2;
  const perMillimetre = 1 / (grooveRadius - boreRadius);
  return {
    crest: polar(boreRadius - further, crest + (crest - base) * further * perMillimetre),
    crestEnd: polar(boreRadius - further, crestEnd - (endBase - crestEnd) * further * perMillimetre),
  };
}

function prism(kernel: GeometryKernel, track: Track, outline: readonly Vec2[], from: number, to: number): Manifold {
  const solid = track(kernel.Manifold.extrude([counterClockwise(outline)], to - from));
  return track(solid.translate([0, 0, from]));
}

/** A solid of revolution of a (ρ, z) polygon, whole or from `from` over `degrees`. */
function revolved(
  kernel: GeometryKernel,
  track: Track,
  profile: readonly Vec2[],
  segments: number,
  from?: number,
  degrees?: number,
): Manifold {
  const polygon = counterClockwise(profile);
  if (degrees === undefined) return track(kernel.Manifold.revolve([polygon], segments));
  const part = track(kernel.Manifold.revolve([polygon], segments, degrees));
  return track(part.rotate([0, 0, ((from ?? 0) * 180) / Math.PI]));
}

/** An angular loft whose ring angles keep clear of the stem polygon's vertices. */
const angularLoftOnStem = (
  kernel: GeometryKernel,
  track: Track,
  layout: BayonetLayout,
  rings: readonly { readonly angle: number; readonly polygon: readonly Vec2[] }[],
) =>
  angularLoft(
    kernel,
    track,
    rings.map((ring) => ({ ...ring, angle: clearOfStemVertices(layout, ring.angle) })),
  );

/**
 * A convex (ρ, z) quadrilateral or more swept around the axis through the given angles, in rising order, changing from one to
 * the next: a closed mesh with flat ends. Polygons run counter-clockwise in (ρ, z), whose normal is −θ.
 */
function angularLoft(
  kernel: GeometryKernel,
  track: Track,
  rings: readonly { readonly angle: number; readonly polygon: readonly Vec2[] }[],
): Manifold {
  const size = (rings[0] as (typeof rings)[number]).polygon.length;
  const positions: number[] = [];
  for (const { angle, polygon } of rings) {
    for (const [radius, z] of polygon) positions.push(radius * Math.cos(angle), radius * Math.sin(angle), z);
  }
  const triangles: number[] = [];
  for (let vertex = 1; vertex + 1 < size; vertex += 1) {
    triangles.push(0, vertex, vertex + 1);
    const last = (rings.length - 1) * size;
    triangles.push(last, last + vertex + 1, last + vertex);
  }
  for (let ring = 0; ring + 1 < rings.length; ring += 1) {
    for (let vertex = 0; vertex < size; vertex += 1) {
      const next = (vertex + 1) % size;
      const [a, b] = [ring * size + vertex, ring * size + next];
      const [aNext, bNext] = [a + size, b + size];
      triangles.push(a, aNext, b, b, aNext, bNext);
    }
  }
  const mesh = new kernel.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(positions),
    triVerts: Uint32Array.from(triangles),
  });
  return track(new kernel.Manifold(mesh));
}

/** A closed mesh through convex outlines with as many vertices, counter-clockwise, at rising heights. */
function heightLoft(
  kernel: GeometryKernel,
  track: Track,
  layers: readonly { readonly z: number; readonly outline: readonly Vec2[] }[],
): Manifold {
  const size = (layers[0] as (typeof layers)[number]).outline.length;
  const positions = layers.flatMap(({ z, outline }) => outline.flatMap(([x, y]) => [x, y, z]));
  const last = (layers.length - 1) * size;
  const triangles: number[] = [];
  for (let vertex = 0; vertex < size; vertex += 1) {
    const next = (vertex + 1) % size;
    for (let layer = 0; layer + 1 < layers.length; layer += 1) {
      const [low, high] = [layer * size, (layer + 1) * size];
      triangles.push(low + vertex, low + next, high + next, low + vertex, high + next, high + vertex);
    }
    if (vertex > 0 && next > 0) triangles.push(0, next, vertex, last, last + vertex, last + next);
  }
  const mesh = new kernel.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(positions),
    triVerts: Uint32Array.from(triangles),
  });
  return track(new kernel.Manifold(mesh));
}

/** The same N for every circle of the mechanism: the kernel's vertices then lie on one set of angles. */
const segmentsOf = (layout: BayonetLayout) => circularSegments(mouthRadius(layout));

/** How far an inscribed polygon's chord may lie inside its circle at the mechanism's largest radius. */
const sagOf = (layout: BayonetLayout) => mouthRadius(layout) * (1 - Math.cos(Math.PI / segmentsOf(layout)));

const stemProfile = (layout: BayonetLayout, grow = 0): Vec2[] => {
  const radius = layout.stemRadius + grow;
  return [
    [0, -ROOT_OVERLAP_MM],
    [radius + ROOT_CHAMFER_MM, -ROOT_OVERLAP_MM],
    [radius + ROOT_CHAMFER_MM, 0],
    [radius, ROOT_CHAMFER_MM],
    [radius, layout.projection],
    [0, layout.projection],
  ];
};

/** A lug's silhouette in (ρ, z), from inside the stem: flat on top, with its underside rising at 45° to the tip. */
function lugProfile(layout: BayonetLayout, outer: number, sag = 0): Vec2[] {
  const { stemRadius, lugUnderside, projection } = layout;
  const inner = stemRadius - OVERLAP_MM;
  return [
    [inner, lugUnderside - OVERLAP_MM - sag],
    [outer, lugUnderside + outer - stemRadius - sag],
    [outer, projection],
    [inner, projection],
  ];
}

function lugSolid(
  kernel: GeometryKernel,
  track: Track,
  layout: BayonetLayout,
  kind: BayonetLugKind,
  centre: number,
  sag = 0,
): Manifold {
  const { stemRadius, lugUnderside, projection, lugRadius } = layout;
  const outline = lugOutline(layout, kind, centre, 0, stemRadius - OVERLAP_MM, sag);
  const column = prism(kernel, track, outline, lugUnderside - OVERLAP_MM - sag, projection);
  const below = lugProfile(layout, lugRadius + 1, sag);
  return track(column.intersect(revolved(kernel, track, below, segmentsOf(layout))));
}

/** The underside of the tongue at an angle: at the tip one tip height below the top, falling towards the root. */
const tongueUnderside = (layout: BayonetLayout, angle: number) =>
  layout.projection - BAYONET_FLEXURE.tipHeight - UNDERSIDE_SLOPE * (angle - layout.tipAngle) * layout.stemRadius;

/** Angles from `from` to `to`, no further apart than the arc step. */
function angles(from: number, to: number): number[] {
  const steps = Math.max(1, Math.ceil((to - from) / ARC_STEP_RAD));
  return Array.from({ length: steps + 1 }, (_, index) => from + ((to - from) * index) / steps);
}

/**
 * What separates the tongue from the stem, as one closed solid, so that no two of its surfaces coincide: the relief behind it,
 * the gap beneath its rising underside, and the gap at its free tip. In (ρ, z) it is an L, starred from its reflex corner. The
 * relief and the gap end rounded at the root, so that it has no sharp notch; everything that faces down here is the tongue's
 * underside, at least 45° on the stem's surface and steeper inside it.
 */
function tongueGap(kernel: GeometryKernel, track: Track, layout: BayonetLayout): Manifold {
  const { thickness, relief, underGap, tipGap } = BAYONET_FLEXURE;
  const { stemRadius, rootAngle, tipAngle, projection } = layout;
  const behindOuter = stemRadius - thickness;
  const behindInner = behindOuter - relief;
  const behindMiddle = behindOuter - relief / 2;
  const top = projection + CUTTER_MARGIN_MM;
  const outer = stemRadius + OVERLAP_MM;
  const ring = (angle: number, inner: number, facing: number, floor: number, underside: number) => ({
    angle,
    polygon: [
      [facing, underside],
      [facing, top],
      [inner, top],
      [inner, floor],
      [outer, floor],
      [outer, underside],
    ] as Vec2[],
  });
  const floorAtTip = tongueUnderside(layout, tipAngle) - underGap;
  // Over the tip's gap nothing remains of the stem: the same L, with its corner above the stem's top.
  const overStem = projection + CUTTER_MARGIN_MM / 2;
  const startGap = tipAngle - tipGap / behindOuter;
  const atRoot = tongueUnderside(layout, rootAngle);
  const middle = atRoot - underGap / 2;
  // How far the middle has fallen on the stem's surface, for a share of the rounding's radius along the relief's middle.
  const fallen = (along: number) => middle - (UNDERSIDE_SLOPE * along * relief * stemRadius) / 2 / behindMiddle;
  return angularLoftOnStem(kernel, track, layout, [
    ring(startGap, behindInner, behindOuter, floorAtTip, overStem),
    ring(tipAngle - 1e-3, behindInner, behindOuter, floorAtTip, overStem),
    ...angles(tipAngle, rootAngle).map((angle) => {
      const underside = tongueUnderside(layout, angle);
      return ring(angle, behindInner, behindOuter, underside - underGap, underside);
    }),
    ...[15, 35, 55, 72, 85].map((degrees) => {
      const [along, half] = [Math.sin((degrees * Math.PI) / 180), Math.cos((degrees * Math.PI) / 180)];
      return ring(
        rootAngle + (along * relief) / 2 / behindMiddle,
        behindMiddle - (half * relief) / 2,
        behindMiddle + (half * relief) / 2,
        // The end follows the underside's fall, so that its ceiling only steepens as it turns: no flat spot to print over a void.
        fallen(along) - (half * underGap) / 2,
        fallen(along) + (half * underGap) / 2,
      );
    }),
  ]);
}

/** How far the bump's flanks continue inside the tongue, so that they cross its surface instead of ending on it. */
const BUMP_ROOT_MM = 0.2;
// The bump's underside starts rising this far inside the tongue's polygon, which lies up to one sag inside its circle.
const BUMP_INSET_MM = 0.05;
// And its flat start lies this far over the tongue's underside at its lowest point on the bump's width.
const BUMP_LOW_MARGIN_MM = 0.1;

/** The bump's rings, in the plan from its clockwise base to its counter-clockwise base, with its crest at `crest`. */
function bumpRings(layout: BayonetLayout, crest: number) {
  const { stemRadius, crestAngle, bumpClockwise, bumpCounterClockwise, projection } = layout;
  const halfFlat = DETENT.crestFlat / 2 / stemRadius;
  const inner = stemRadius - OVERLAP_MM / 2 - BUMP_ROOT_MM / 2;
  const low = bumpLow(layout);
  const ring = (angle: number, outer: number) => ({
    angle,
    polygon: [
      [inner, low],
      // Flat within the tongue; from its surface the underside rises at 45°, so that the crest prints without support.
      [Math.min(stemRadius - BUMP_INSET_MM, outer - BUMP_ROOT_MM / 10), low],
      [outer, low + Math.max(0, outer - stemRadius + BUMP_INSET_MM)],
      [outer, projection],
      [inner, projection],
    ] as Vec2[],
  });
  const root = stemRadius - BUMP_ROOT_MM;
  return [
    ring(crestAngle - bumpClockwise - BUMP_ROOT_MM / TAN_CLOSING / stemRadius, root),
    ring(crestAngle - halfFlat, crest),
    ring(crestAngle + halfFlat, crest),
    ring(crestAngle + bumpCounterClockwise + BUMP_ROOT_MM / TAN_OPENING / stemRadius, root),
  ];
}

/** Where the bump starts: on the tongue over all of its width, roots included, with an underside that rises at 45° to the crest. */
const bumpLow = (layout: BayonetLayout) =>
  tongueUnderside(layout, layout.crestAngle - layout.bumpClockwise - BUMP_ROOT_MM / TAN_CLOSING / layout.stemRadius) +
  BUMP_LOW_MARGIN_MM;

/**
 * The turn of the stem's polygon about its axis, none or half a segment, whichever keeps its vertices further from where the lugs'
 * flanks cross it: a vertex a few micrometres from such a crossing leaves an edge that float32 rounds into a sliver. It follows
 * from the stem alone, so that the model's male and the trial's are the same. The rigid sweep holds the circle grown by the sag,
 * which holds the polygon at any turn.
 */
function stemPhase(layout: BayonetLayout): number {
  const step = (2 * Math.PI) / segmentsOf(layout);
  const crossings = (['wide', 'narrow'] as const).flatMap((kind) => {
    const { along, across } = flankOnCircle(lugTip(layout, kind), layout.lugRadius, 0, layout.stemRadius);
    const half = Math.atan2(across, along);
    return [lugCentre(kind) - half, lugCentre(kind) + half];
  });
  const clearance = (phase: number) =>
    Math.min(
      ...crossings.map((angle) => {
        const offset = (((angle - phase) % step) + step) % step;
        return Math.min(offset, step - offset);
      }),
    );
  return clearance(step / 2) > clearance(0) ? step / 2 : 0;
}

/** How far a construction angle on the stem keeps from the stem polygon's vertices, along its surface. */
const STEM_VERTEX_CLEARANCE_MM = 0.01;

/**
 * The angle, moved if it lies within 0,01 mm of a vertex of the stem's polygon to that distance: the tongue's and the bump's rings
 * otherwise cross the stem's edges micrometres from its vertices. A monotone map, so that rings keep their order.
 */
function clearOfStemVertices(layout: BayonetLayout, angle: number): number {
  const step = (2 * Math.PI) / segmentsOf(layout);
  const least = STEM_VERTEX_CLEARANCE_MM / layout.stemRadius;
  const offset = (((angle - stemPhase(layout)) % step) + step) % step;
  if (offset < least) return angle + least - offset;
  return step - offset < least ? angle - (least - (step - offset)) : angle;
}

/** The stem and both lugs alone: what a sweep must let pass as a rigid body. */
export function buildBayonetRigidBody(kernel: GeometryKernel, track: Track, layout: BayonetLayout): Manifold {
  const stem = track(
    revolved(kernel, track, stemProfile(layout), segmentsOf(layout)).rotate([0, 0, (stemPhase(layout) * 180) / Math.PI]),
  );
  return [
    stem,
    lugSolid(kernel, track, layout, 'wide', WIDE_CENTRE_RAD),
    lugSolid(kernel, track, layout, 'narrow', NARROW_CENTRE_RAD),
  ].reduce((sum, solid) => track(sum.add(solid)));
}

/** The integral male, without any solid of the lower part: the stem, both lugs, the separated tongue and its bump. */
export function buildBayonetMale(kernel: GeometryKernel, track: Track, layout: BayonetLayout): Manifold {
  const separated = track(buildBayonetRigidBody(kernel, track, layout).subtract(tongueGap(kernel, track, layout)));
  return track(separated.add(angularLoftOnStem(kernel, track, layout, bumpRings(layout, layout.crestRadius))));
}

/**
 * The socket: all of it under one 45° conical roof that closes on the axis, so that it needs no support with the cut face on
 * the bed. In the plan: the bore, both entries, each with its track, and the bump's arc. Everything but the tracks is open
 * from the mouth; the tracks start on their floor, parallel to the lug's underside, which is the ledge's top. The mouth has a
 * 45° lead-in; the bump's arc needs none, since nothing touches it there.
 */
export function buildBayonetCavity(kernel: GeometryKernel, track: Track, layout: BayonetLayout): Manifold {
  const { boreRadius, trackRadius, socketDepth, lugUnderside, stemRadius, axialClearance, sideClearance, lugRadius, projection } =
    layout;
  const segments = segmentsOf(layout);
  const reach = trackRadius + 1;
  const below = -CUTTER_MARGIN_MM;
  const top = socketDepth + CUTTER_MARGIN_MM;
  const roofAt = (radius: number) => projection + axialClearance + lugRadius - radius;
  const floorAt = (radius: number) => lugUnderside - axialClearance + radius - stemRadius;
  const underRoof = revolved(
    kernel,
    track,
    [
      [0, below],
      [reach, below],
      [reach, roofAt(reach)],
      [0, socketDepth],
    ],
    segments,
  );
  const aboveFloor = revolved(
    kernel,
    track,
    [
      [0, floorAt(0)],
      [reach, floorAt(reach)],
      [reach, top],
      [0, top],
    ],
    segments,
  );
  const chamfer = BAYONET_MOUTH_CHAMFER_MM;
  const lead = chamfer - below;
  const inner = boreRadius - OVERLAP_MM;
  const entry = (kind: BayonetLugKind) => {
    const centre = lugCentre(kind) + TRAVEL_RAD;
    const outline = (offset: number) => counterClockwise(lugOutline(layout, kind, centre, offset, inner, ENTRY_RADIUS_EXTRA_MM));
    return heightLoft(kernel, track, [
      // A little more than the bore's, so that the rings where their lead-ins end never share a plane.
      { z: below, outline: outline(sideClearance + lead + ENTRY_LEAD_EXTRA_MM) },
      { z: chamfer + ENTRY_LEAD_EXTRA_MM, outline: outline(sideClearance) },
      { z: top, outline: outline(sideClearance) },
    ]);
  };
  const bore = revolved(
    kernel,
    track,
    [
      [0, below],
      [boreRadius + lead, below],
      [boreRadius, chamfer],
      [boreRadius, top],
      [0, top],
    ],
    segments,
  );
  const tracks = (['wide', 'narrow'] as const).map((kind) =>
    track(prism(kernel, track, trackOutline(layout, kind), floorAt(inner) - 1, top).intersect(aboveFloor)),
  );
  const plan = [bore, entry('wide'), entry('narrow'), prism(kernel, track, reliefOutline(layout), below, top), ...tracks].reduce(
    (sum, solid) => track(sum.add(solid)),
  );
  return track(plan.intersect(underRoof));
}

/** The cam alone, reaching into the wall behind it, for telling it from the socket's rigid surfaces. */
function camSolid(kernel: GeometryKernel, track: Track, layout: BayonetLayout): Manifold | undefined {
  const { cam, grooveRadius, boreRadius, socketDepth } = layout;
  if (cam === undefined) return undefined;
  // The flanks continue straight into the wall too, so that the solid holds all of the cam, from inside the bore to its base.
  const further = 0.2;
  const perMillimetre = 1 / (grooveRadius - boreRadius);
  const [base, camCrest, camCrestEnd, endBase] = cam;
  const { crest, crestEnd } = camInsideBore(layout, cam);
  return prism(
    kernel,
    track,
    [
      polar(grooveRadius + further, base - (camCrest - base) * further * perMillimetre),
      crest,
      crestEnd,
      polar(grooveRadius + further, endBase + (endBase - camCrestEnd) * further * perMillimetre),
    ],
    -CUTTER_MARGIN_MM,
    socketDepth + CUTTER_MARGIN_MM,
  );
}

const toLocal = ({ origin, u, v, n }: SectionFrame): Mat4 => {
  const dot = (a: Vec3) => a[0] * origin[0] + a[1] * origin[1] + a[2] * origin[2];
  return [v[0], u[0], n[0], 0, v[1], u[1], n[1], 0, v[2], u[2], n[2], 0, -dot(v), -dot(u), -dot(n), 1] as Mat4;
};

export interface BayonetParts {
  readonly lower: Manifold;
  readonly upper: Manifold;
}

/** The part simplified by the cleanup; the fit is verified on what comes out, so that no tolerance here can hide a collision. */
const cleaned = (track: Track, solid: Manifold, cleanupMm: number): Manifold => track(solid.simplify(cleanupMm));

/** The male on the lower part and the socket in the upper part, in the model's position. */
export function buildBayonet(
  kernel: GeometryKernel,
  track: Track,
  parts: { readonly lower: Manifold; readonly upper: Manifold },
  { frame, layout, cleanupMm }: BayonetPlan,
): BayonetParts {
  const place = frameMatrix(frame, frame.origin);
  const male = track(buildBayonetMale(kernel, track, layout).transform(place));
  const cavity = track(buildBayonetCavity(kernel, track, layout).transform(place));
  return {
    lower: cleaned(track, track(parts.lower.add(male)), cleanupMm),
    upper: cleaned(track, track(parts.upper.subtract(cavity)), cleanupMm),
  };
}

/** The male seen from the upper part, for the pose φ: everything of it turned by −φ. */
const seenFromUpper = (track: Track, solid: Manifold, poseDeg: number) => track(solid.rotate([0, 0, -poseDeg]));

/** What sweeps through the upper part from the locked pose to the insertion pose, in its own coordinates. */
export interface BayonetSweeps {
  /** The stem and both lugs: exact, and grown by the polygons' sag, so that every pose in between lies inside. */
  readonly rigid: Manifold;
  /** The bump, deflected inwards by the interference and a margin. */
  readonly deflectedBump: Manifold;
  /** The bump as printed, which must meet the cam and nothing else. */
  readonly freeBump: Manifold;
}

/**
 * The exact volumes swept by a rotation about z. A point at (ρ, θ, z) of a lug sweeps θ…θ + 45°, so that what the lug occupies at
 * (ρ, z), an interval of θ around its centre line, sweeps that interval widened by 45°: the union of the lug in both end poses
 * with its whole silhouette revolved between their centre lines. Inscribed polygons lie inside their circles by at most the
 * sag, so that all curved surfaces grow by it, while the straight flanks, which rotate exactly, stay as they are: no pose between
 * the end poses can leave the volume, which is why no sampling step needs bounding. The bump is a superset the same way: its silhouette over all the angles it covers.
 */
export function buildBayonetSweeps(kernel: GeometryKernel, track: Track, layout: BayonetLayout): BayonetSweeps {
  const segments = segmentsOf(layout);
  const sag = sagOf(layout);
  const lugSweep = (kind: BayonetLugKind) => {
    const centre = lugCentre(kind);
    const silhouette = lugProfile(layout, layout.lugRadius + sag, sag);
    return [
      lugSolid(kernel, track, layout, kind, centre, sag),
      lugSolid(kernel, track, layout, kind, centre + TRAVEL_RAD, sag),
      revolved(kernel, track, silhouette, segments, centre, BAYONET_TRAVEL_DEG),
    ].reduce((sum, solid) => track(sum.add(solid)));
  };
  const rigid = [revolved(kernel, track, stemProfile(layout, sag), segments), lugSweep('wide'), lugSweep('narrow')].reduce(
    (sum, solid) => track(sum.add(solid)),
  );
  const { crestAngle, bumpClockwise, bumpCounterClockwise, stemRadius, projection } = layout;
  const low = bumpLow(layout);
  const bumpSweep = (crest: number) => {
    const inner = stemRadius - OVERLAP_MM / 2;
    const from = crestAngle - bumpClockwise;
    const span = bumpClockwise + bumpCounterClockwise + TRAVEL_RAD;
    return revolved(
      kernel,
      track,
      [
        [inner, low],
        [stemRadius - BUMP_INSET_MM, low],
        [crest, low + crest - stemRadius + BUMP_INSET_MM],
        [crest, projection],
        [inner, projection],
      ],
      segments,
      from,
      (span * 180) / Math.PI,
    );
  };
  return {
    rigid,
    // The cam's crest is the bore's polygon, up to one sag inside its circle, and this sweep's polygon must hold the bump's circle.
    deflectedBump: bumpSweep(layout.crestRadius - layout.interference - sag - CAM_PASS_MARGIN_MM),
    freeBump: bumpSweep(layout.crestRadius + sag),
  };
}

/**
 * What the male sweeps while it is inserted axially, in its own coordinates: the plan of the stem, the lugs and the bump, from
 * far below up to its top. The root's chamfer is left out, since it only arrives at the mouth's lead-in at the very end, which
 * the seated pose checks.
 */
export function buildBayonetCorridor(kernel: GeometryKernel, track: Track, layout: BayonetLayout): Manifold {
  const { stemRadius, projection, crestAngle, bumpClockwise, bumpCounterClockwise, crestRadius } = layout;
  const sag = sagOf(layout);
  const halfFlat = DETENT.crestFlat / 2 / stemRadius;
  const inner = stemRadius - OVERLAP_MM;
  const from = -projection - 5;
  const bump: Vec2[] = [
    polar(inner, crestAngle - bumpClockwise),
    polar(stemRadius, crestAngle - bumpClockwise),
    polar(crestRadius, crestAngle - halfFlat),
    polar(crestRadius, crestAngle + halfFlat),
    polar(stemRadius, crestAngle + bumpCounterClockwise),
    polar(inner, crestAngle + bumpCounterClockwise),
  ];
  return [
    prism(kernel, track, arc(stemRadius + sag, 0, 2 * Math.PI).slice(0, -1), from, projection),
    prism(kernel, track, lugOutline(layout, 'wide', WIDE_CENTRE_RAD, sag, inner), from, projection),
    prism(kernel, track, lugOutline(layout, 'narrow', NARROW_CENTRE_RAD, sag, inner), from, projection),
    prism(kernel, track, bump, from, projection),
  ].reduce((sum, solid) => track(sum.add(solid)));
}

/**
 * Checks the built parts in three dimensions; throws ConnectorVerificationError naming the first failed check. All of it in the
 * cut plane's coordinates.
 *
 * - Each part is one connected solid, also with its tongue.
 * - Neither leaves the uncut solid, and the socket stays inside it: it opens on the cut face only.
 * - Nothing overlaps in the locked pose or seated in the insertion pose.
 * - The corridor of the axial insertion at −45° is free.
 * - The rigid sweep from −45° to 0 and the bump's, deflected by the interference, are free; the free bump's meets the cam alone.
 * - Turned 1° past the stop, the male meets the upper part, as it does when pulled straight out while locked or inserted turned
 *   by 180°.
 */
export function verifyBayonet(
  kernel: GeometryKernel,
  track: Track,
  whole: Manifold,
  built: BayonetParts,
  { frame, layout }: Pick<BayonetPlan, 'frame' | 'layout'>,
): void {
  const tolerance = FIT_VOLUME_TOLERANCE_MM3;
  const volume = (solid: Manifold) => track(solid).volume();
  const fail = (check: string): never => {
    throw new ConnectorVerificationError(check);
  };
  const local = toLocal(frame);
  const lower = track(built.lower.transform(local));
  const upper = track(built.upper.transform(local));
  const envelope = track(track(whole.transform(local)).scale(1 + 1e-6));
  for (const solid of [lower, upper]) {
    const pieces = solid.decompose();
    for (const piece of pieces) track(piece);
    if (pieces.length !== 1) fail('connected');
  }
  if (volume(lower.subtract(envelope)) > tolerance) fail('lower-inside-envelope');
  if (volume(upper.subtract(envelope)) > tolerance) fail('upper-inside-envelope');
  const cavity = buildBayonetCavity(kernel, track, layout);
  if (volume(track(cavity.trimByPlane([0, 0, 1], 0)).subtract(envelope)) > tolerance) fail('no-breakthrough');
  const male = buildBayonetMale(kernel, track, layout);
  if (volume(lower.intersect(upper)) > tolerance) fail('locked-fit');
  if (volume(seenFromUpper(track, male, -BAYONET_TRAVEL_DEG).intersect(upper)) > tolerance) fail('seated-fit');
  const corridor = buildBayonetCorridor(kernel, track, layout);
  if (volume(seenFromUpper(track, corridor, -BAYONET_TRAVEL_DEG).intersect(upper)) > tolerance) fail('insertion-path');
  const sweeps = buildBayonetSweeps(kernel, track, layout);
  if (volume(sweeps.rigid.intersect(upper)) > tolerance) fail('rotation-sweep');
  if (volume(sweeps.deflectedBump.intersect(upper)) > tolerance) fail('detent-deflection');
  const cam = camSolid(kernel, track, layout);
  const withoutCam = cam === undefined ? upper : track(upper.subtract(cam));
  if (volume(sweeps.freeBump.intersect(withoutCam)) > tolerance) fail('detent-rigid-contact');
  if (cam !== undefined && !(volume(sweeps.freeBump.intersect(upper)) > tolerance)) fail('detent-engagement');
  const rigid = buildBayonetRigidBody(kernel, track, layout);
  if (!(volume(seenFromUpper(track, rigid, 1).intersect(upper)) > BLOCKED_MM3)) fail('end-stop');
  const pulled = track(rigid.translate([0, 0, -(layout.axialClearance + 0.2)]));
  if (!(volume(pulled.intersect(upper)) > BLOCKED_MM3)) fail('axial-retention');
  const turnedEntry = seenFromUpper(track, corridor, -BAYONET_TRAVEL_DEG + 180);
  if (!(volume(turnedEntry.intersect(upper)) > BLOCKED_MM3)) fail('keying');
}

/** The height of the male holder's base, and the wall the holders leave around the socket and over its roof. */
const TRIAL = { base: 6, wall: 4, roof: 3, markDepth: 0.8 } as const;

/** The trial holders' outline: a hexagon around the socket, with flats to grip, and the wall that it keeps at its flats. */
const holderApothem = (layout: BayonetLayout) => mouthRadius(layout) + TRIAL.wall;

function holderOutline(layout: BayonetLayout): Vec2[] {
  const radius = holderApothem(layout) / Math.cos(Math.PI / 6);
  return Array.from({ length: 6 }, (_, index) => polar(radius, (index * Math.PI) / 3));
}

/** A V notch on the outside at an angle, as a mark: away from every contact surface, and shallower than the wall. */
function markNotch(
  kernel: GeometryKernel,
  track: Track,
  layout: BayonetLayout,
  angle: number,
  from: number,
  to: number,
): Manifold {
  // How far the hexagon's surface lies along this angle, from the normal of its nearest flat, at 30° + k·60°.
  const fromFlat = ((angle - Math.PI / 6) % (Math.PI / 3)) + (angle < Math.PI / 6 ? Math.PI / 3 : 0);
  const surface = holderApothem(layout) / Math.cos(fromFlat > Math.PI / 6 ? fromFlat - Math.PI / 3 : fromFlat);
  const inner = surface - TRIAL.markDepth;
  const outer = surface + 2;
  const halfAngleAtOuter = 0.5 / outer;
  return prism(
    kernel,
    track,
    [polar(inner, angle), polar(outer, angle - halfAngleAtOuter), polar(outer, angle + halfAngleAtOuter)],
    from,
    to,
  );
}

export interface BayonetTrialHolders {
  readonly male: Manifold;
  readonly female: Manifold;
  /** The holders uncut, as the envelope to verify them in. */
  readonly whole: Manifold;
}

/**
 * Two small holders around the same male and socket, with the same builders and dimensions, in the same coordinates as a
 * model's, unscaled, so that a test print shows how the model's own connector fits. Each has flats to grip and marks on the
 * outside: with the male holder's mark at 90°, one notch of the female holder lines up when locked, and two when it is at −45°.
 */
export function buildBayonetTrial(kernel: GeometryKernel, track: Track, layout: BayonetLayout): BayonetTrialHolders {
  const outline = holderOutline(layout);
  const height = layout.socketDepth + TRIAL.roof;
  const base = prism(kernel, track, outline, -TRIAL.base, 0);
  const female = prism(kernel, track, outline, 0, height);
  const locked = Math.PI / 2;
  const open = locked + TRAVEL_RAD;
  const marksOf = (angle: number, from: number, to: number) => markNotch(kernel, track, layout, angle, from, to);
  const marked = track(base.subtract(marksOf(locked, -TRIAL.base - 1, 1)));
  const male = cleaned(track, track(marked.add(buildBayonetMale(kernel, track, layout))), CLEANUP_MM);
  const notched = [
    marksOf(locked, -1, height + 1),
    marksOf(open - 0.06, -1, height + 1),
    marksOf(open + 0.06, -1, height + 1),
  ].reduce((sum, cutter) => track(sum.subtract(cutter)), female);
  const socket = cleaned(track, track(notched.subtract(buildBayonetCavity(kernel, track, layout))), CLEANUP_MM);
  return { male, female: socket, whole: track(base.add(female)) };
}

/** The identity frame of the holders, whose cut plane is z = 0. */
export const BAYONET_TRIAL_FRAME: SectionFrame = { origin: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0], n: [0, 0, 1] };
