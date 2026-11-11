import {
  type PhysicalScale,
  TWIST_AXIAL_CLEARANCE_LIMITS,
  TWIST_CLEARANCE_LIMITS,
  type TwistConnector,
} from '@diploma-3d/schema';
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
 * A rigid twist connector between the parts of a right cylinder cut parallel to its bases, in the cut plane's coordinates: x
 * along v, y along u, z along n from the lower part into the upper one, angles counter-clockwise about z from +x.
 *
 * The male on the lower part is a short neck under a low head: a disc with three radial lugs, the one at 0° wider than those at
 * 120° and 240°. The upper part has a shallow blind recess: a central opening for the neck and disc, an entry per lug, the ledges
 * between the entries under which the lugs turn, and a stop for each lug.
 *
 * The lower part stands still; the upper part's pose φ is its turn about z. Locked: φ = 0, the cut faces meet. Inserted: φ = −45°.
 * A point fixed on the male appears in the upper part's own coordinates turned by −φ, so that a lug at θ enters at θ + 45° and
 * ends at θ: every space of the recess runs from there clockwise back to the locked position.
 *
 * Its functions have their own surfaces: the side clearance g = Δ/2 around the neck, disc, entries and the lugs' running
 * surfaces; the axial gap a above and below the head; the ledges, which keep the lugs from being pulled straight out; and the
 * stops, the planes of the lugs' leading flanks in the locked pose, which no clearance moves, so that the stop is at exactly
 * φ = 0. Nothing resists turning back, by design: no detent, ramp or interference.
 */

export const TWIST_TRAVEL_DEG = 45;
export const TWIST_LUG_COUNT = 3;

/**
 * The construction's internal proportions, of the head's radius R = size/2, with absolute floors for printing with a 0,4 mm
 * nozzle and 0,2 mm layers. At 16–20 mm across, neck and head are 2 mm each. Prototype values, not validated strengths.
 */
export const TWIST_PROPORTIONS = {
  /** The neck's height and the head's thickness: a tenth of the size, at least 2 mm each. */
  heightPerSize: 0.1,
  minHeight: 2,
  /** The disc's radius, where the lugs start. */
  discPerRadius: 0.72,
  /** By how much the disc overhangs the neck, under a 45° chamfer. */
  rimPerRadius: 0.06,
  minRim: 0.4,
  /** Half the tip width of a narrow lug, and by how much the wide lug's is larger. */
  narrowHalfWidthPerRadius: 0.125,
  widthDifferencePerRadius: 0.08,
  minWidthDifference: 0.75,
  /** Half a lug's width grows by this much per millimetre towards its root, which keeps it from being a notched tab. */
  taper: 0.05,
} as const;

/**
 * Thresholds for first trials, not a strength guarantee: the narrow lug's tip width (five lines), how far a lug reaches over its
 * ledge, the arc by which every locked lug clears its own entry, so that all of it bears on the ledge, and by how much the wide
 * lug is wider than a narrow entry at the current clearance, on the actual flanks.
 */
export const TWIST_MINIMUMS_MM = {
  wall: CONNECTOR_MIN_WALL_MM,
  narrowLugWidth: 2,
  bearing: 1,
  engagementGap: 0.5,
  keying: 0.2,
  neckDiameter: 4,
} as const;

/** The 45° lead-in around the central opening and the entries, which also leaves room for a first layer's elephant foot. */
export const TWIST_MOUTH_CHAMFER_MM = 0.42;
const ROOT_CHAMFER_MM = 0.3;
const ROOT_OVERLAP_MM = 0.2;
// Entries reach this much beyond the tracks, so that arcs of nearly one circle cross instead of running along each other, and
// their lead-ins this much more than the opening's, so that the rings where they end never share a plane.
const ENTRY_RADIUS_EXTRA_MM = 0.02;
const ENTRY_LEAD_EXTRA_MM = 0.05;
// The roof's cone starts this far outside the tracks.
const ROOF_EXTRA_MM = 0.05;
// Outlines start this far inside what they join, so that no two surfaces of a Boolean operation coincide.
const OVERLAP_MM = 0.5;
// The disc's chamfer ends this far inside its rim, for the same reason: a 0,1 mm step no print shows.
const RIM_INSET_MM = 0.1;
const CUTTER_MARGIN_MM = 1;
// Surfaces that meet at the head can leave edges this short, which float32 would round into zero-area triangles: three
// micrometres, far below every clearance; a large model's coordinates round more coarsely, so that it follows the model's size.
const CLEANUP_MM = 3e-3;
const CLEANUP_PER_MODEL_MM = 1e-5;
// A contact below this is Boolean roundoff of surfaces that coincide, such as a flank at its stop. Fixed: the connector's size
// does not follow the model's, and neither may what its checks overlook.
const FIT_VOLUME_TOLERANCE_MM3 = 0.002;
// More than roundoff and less than any real contact, which is a whole flank or ledge.
const BLOCKED_MM3 = 0.01;
const LUG_ARC_POINTS = 8;

const TRAVEL_RAD = (TWIST_TRAVEL_DEG * Math.PI) / 180;
const TAPER_COSINE = Math.cos(Math.atan(TWIST_PROPORTIONS.taper));

export type TwistLugKind = 'wide' | 'narrow';

/** The lugs in the locked pose, the wide one first. */
export const TWIST_LUGS: readonly { readonly kind: TwistLugKind; readonly centre: number }[] = [
  { kind: 'wide', centre: 0 },
  { kind: 'narrow', centre: (2 * Math.PI) / 3 },
  { kind: 'narrow', centre: (4 * Math.PI) / 3 },
];

export interface TwistDimensions {
  /** S: the diameter around the head, lugs included. */
  readonly size: number;
  /** Δ = 2g. */
  readonly holeClearance: number;
  /** a: per opposed axial pair of faces. */
  readonly axialClearance: number;
}

export const twistDimensions = (connector: TwistConnector): TwistDimensions => ({
  size: connector.sizeMm,
  holeClearance: connector.holeClearanceMm,
  axialClearance: connector.axialClearanceMm,
});

export interface TwistLayout extends TwistDimensions {
  /** R: the lugs' tips. */
  readonly radius: number;
  /** g = Δ/2. */
  readonly sideClearance: number;
  readonly neckRadius: number;
  readonly discRadius: number;
  readonly neckHeight: number;
  readonly headThickness: number;
  readonly wideHalfWidth: number;
  readonly narrowHalfWidth: number;
  /** The central opening's radius: the disc's with the clearance. */
  readonly openingRadius: number;
  /** R + g: the tracks around the lugs' tips. */
  readonly trackRadius: number;
  /** The ledges' top faces, and the top of the space the head turns in. */
  readonly ledgeTop: number;
  readonly spaceTop: number;
  /** Where the 45° roof starts, and its apex: the recess's whole depth. */
  readonly roofRadius: number;
  readonly recessDepth: number;
  /** The recess's widest ring, at the mouth's lead-in. */
  readonly mouthRadius: number;
}

export function twistLayout(dimensions: TwistDimensions): TwistLayout {
  const { size, holeClearance, axialClearance } = dimensions;
  const p = TWIST_PROPORTIONS;
  const radius = size / 2;
  const sideClearance = holeClearance / 2;
  const height = Math.max(p.minHeight, p.heightPerSize * size);
  const discRadius = p.discPerRadius * radius;
  const narrowHalfWidth = p.narrowHalfWidthPerRadius * radius;
  const trackRadius = radius + sideClearance;
  const spaceTop = height + height + axialClearance;
  const roofRadius = trackRadius + ENTRY_RADIUS_EXTRA_MM + ROOF_EXTRA_MM;
  return {
    ...dimensions,
    radius,
    sideClearance,
    neckRadius: discRadius - Math.max(p.minRim, p.rimPerRadius * radius),
    discRadius,
    neckHeight: height,
    headThickness: height,
    wideHalfWidth: narrowHalfWidth + Math.max(p.minWidthDifference, p.widthDifferencePerRadius * radius),
    narrowHalfWidth,
    openingRadius: discRadius + sideClearance,
    trackRadius,
    ledgeTop: height - axialClearance,
    spaceTop,
    roofRadius,
    recessDepth: spaceTop + roofRadius,
    mouthRadius: trackRadius + ENTRY_RADIUS_EXTRA_MM + TWIST_MOUTH_CHAMFER_MM + ENTRY_LEAD_EXTRA_MM,
  };
}

const lugTip = (layout: TwistLayout, kind: TwistLugKind) => (kind === 'wide' ? layout.wideHalfWidth : layout.narrowHalfWidth);

/**
 * Where a lug's flank, `offset` outside it, crosses the circle of `circle`: how far along the lug's centre line and how far off
 * it. The flank is the line across = a − taper·along with a = tip + taper·R + offset/cos.
 */
function flankOnCircle(tip: number, radius: number, offset: number, circle: number): { along: number; across: number } {
  const { taper } = TWIST_PROPORTIONS;
  const a = tip + taper * radius + offset / TAPER_COSINE;
  const scale = 1 + taper * taper;
  const along = (a * taper + Math.sqrt(Math.max(0, a * a * taper * taper - scale * (a * a - circle * circle)))) / scale;
  return { along, across: a - taper * along };
}

/** The half angle a lug, or its outline `offset` outside it, covers on the circle of `circle`. */
const flankAngle = (layout: TwistLayout, kind: TwistLugKind, offset: number, circle: number) => {
  const { along, across } = flankOnCircle(lugTip(layout, kind), layout.radius, offset, circle);
  return Math.atan2(across, along);
};

/** A construction constraint of the twist connector with its measured value; an issue when it falls short of its minimum. */
export type TwistIssue = {
  readonly code:
    | 'lug-too-narrow'
    | 'keying-lost'
    | 'bearing-short'
    | 'engagement-short'
    | 'neck-too-thin'
    | 'ledge-thin'
    | 'rib-thin'
    | 'recess-wall-thin'
    | 'recess-roof-thin'
    | 'base-thin';
  readonly valueMm: number;
  readonly minimumMm: number;
};

/**
 * Every constraint of the connector, the same ones in the same order at any dimensions, measured on the actual cavity with its
 * lead-ins and its roof.
 *
 * - The narrow lugs are at least 2 mm wide at their tips.
 * - The wide lug is wider than a narrow entry at every radius, both being tapered alike: wide − narrow − g/cos(taper) ≥ 0,2 mm.
 *   So it passes neither narrow entry, which leaves one orientation of the three.
 * - Each lug reaches at least 1 mm over its ledge, from the opening's edge, and in the locked pose all of it lies over the ledge:
 *   its trailing flank clears its own entry by at least 0,5 mm, at the opening and at its tip.
 * - The ledges are at least a wall thick under the space; between one track's entry and the next lug's stop a rib of a wall
 *   remains, at the mouth's widest; the recess keeps a wall to the cylinder's side and above its roof; the lower part a wall under
 *   the neck's root overlap.
 */
export function twistChecks(section: ParallelCylinderSection, dimensions: TwistDimensions): TwistIssue[] {
  const layout = twistLayout(dimensions);
  const { radius, sideClearance, openingRadius, wideHalfWidth, narrowHalfWidth } = layout;
  const { wall } = TWIST_MINIMUMS_MM;
  const engagement = (kind: TwistLugKind) =>
    Math.min(
      ...[openingRadius, radius].map(
        (circle) => circle * (TRAVEL_RAD - flankAngle(layout, kind, 0, circle) - flankAngle(layout, kind, sideClearance, circle)),
      ),
    );
  // Between the entry of each lug and the stop of the next one, at the mouth, where the lead-in widens the entry most.
  const outer = layout.mouthRadius;
  const entryOffset = layout.mouthRadius - radius;
  const ribs = TWIST_LUGS.map(({ kind, centre }, index) => {
    const next = TWIST_LUGS[(index + 1) % TWIST_LUGS.length] as (typeof TWIST_LUGS)[number];
    const nextCentre = index + 1 === TWIST_LUGS.length ? next.centre + 2 * Math.PI : next.centre;
    const entryEnd = centre + TRAVEL_RAD + flankAngle(layout, kind, entryOffset, outer);
    const stop = nextCentre - flankAngle(layout, next.kind, 0, layout.trackRadius);
    return layout.trackRadius * (stop - entryEnd);
  });
  return [
    { code: 'lug-too-narrow', valueMm: 2 * narrowHalfWidth, minimumMm: TWIST_MINIMUMS_MM.narrowLugWidth },
    {
      code: 'keying-lost',
      valueMm: wideHalfWidth - narrowHalfWidth - sideClearance / TAPER_COSINE,
      minimumMm: TWIST_MINIMUMS_MM.keying,
    },
    { code: 'bearing-short', valueMm: radius - openingRadius, minimumMm: TWIST_MINIMUMS_MM.bearing },
    {
      code: 'engagement-short',
      valueMm: Math.min(engagement('wide'), engagement('narrow')),
      minimumMm: TWIST_MINIMUMS_MM.engagementGap,
    },
    { code: 'neck-too-thin', valueMm: 2 * layout.neckRadius, minimumMm: TWIST_MINIMUMS_MM.neckDiameter },
    { code: 'ledge-thin', valueMm: layout.ledgeTop, minimumMm: wall },
    { code: 'rib-thin', valueMm: Math.min(...ribs), minimumMm: wall },
    { code: 'recess-wall-thin', valueMm: section.inradius - layout.mouthRadius, minimumMm: wall },
    { code: 'recess-roof-thin', valueMm: section.upperThickness - layout.recessDepth, minimumMm: wall },
    { code: 'base-thin', valueMm: section.lowerThickness - ROOT_OVERLAP_MM, minimumMm: wall },
  ];
}

export interface TwistPlan {
  readonly type: 'twist';
  readonly frame: SectionFrame;
  readonly layout: TwistLayout;
  /** How far the finished parts may be simplified. */
  readonly cleanupMm: number;
  readonly issues: readonly TwistIssue[];
}

/** Whether this first version offers a twist connector here: a right cylinder cut parallel to its bases. */
export const twistSupported = (shape: SectionedShape, cut: SolidCut): boolean =>
  shape.kind === 'cylinder' && shape.offsetRatio === 0 && typeof cut === 'number';

function supportedSection(shape: SectionedShape, scale: PhysicalScale, cut: SolidCut): ParallelCylinderSection {
  if (!twistSupported(shape, cut)) throw new ConnectorUnsuitableError([{ code: 'twist-unsupported' }]);
  return solidCut(shape, scale, cut) as ParallelCylinderSection;
}

/** The connector's dimensions and what rules them out; pure, so that the interface can explain it before anything is built. */
export function planTwist(shape: SectionedShape, scale: PhysicalScale, cut: SolidCut, connector: TwistConnector): TwistPlan {
  const section = supportedSection(shape, scale, cut);
  const dimensions = twistDimensions(connector);
  return {
    type: 'twist',
    frame: section.frame,
    layout: twistLayout(dimensions),
    cleanupMm: Math.max(CLEANUP_MM, CLEANUP_PER_MODEL_MM * scale.longestDimensionMm),
    issues: twistChecks(section, dimensions).filter((check) => !satisfies(check)),
  };
}

export type TwistParameter = 'size' | 'holeClearance' | 'axialClearance';

/** Which values of each setting the cylinder, the cut and the others allow, from the checks `planTwist` applies. */
export function twistFeasibility(
  shape: SectionedShape,
  scale: PhysicalScale,
  cut: SolidCut,
  connector: TwistConnector,
): ConnectorFeasibility<TwistParameter, TwistIssue> {
  const section = supportedSection(shape, scale, cut);
  const dimensions = twistDimensions(connector);
  return connectorFeasibility((current) => twistChecks(section, current), dimensions, [
    {
      key: 'size',
      envelope: { min: 1, max: 2 * section.radius },
      value: dimensions.size,
      with: (current, size) => ({ ...current, size }),
    },
    {
      key: 'holeClearance',
      envelope: TWIST_CLEARANCE_LIMITS,
      value: dimensions.holeClearance,
      with: (current, holeClearance) => ({ ...current, holeClearance }),
    },
    {
      key: 'axialClearance',
      envelope: TWIST_AXIAL_CLEARANCE_LIMITS,
      value: dimensions.axialClearance,
      with: (current, axialClearance) => ({ ...current, axialClearance }),
    },
  ]);
}

const polar = (radius: number, angle: number): Vec2 => [radius * Math.cos(angle), radius * Math.sin(angle)];

const turned = ([x, y]: Vec2, angle: number): Vec2 => [
  x * Math.cos(angle) - y * Math.sin(angle),
  x * Math.sin(angle) + y * Math.cos(angle),
];

const ARC_STEP_RAD = (3 * Math.PI) / 180;

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

/** As the kernel's polygons: counter-clockwise, with their own mutable points. */
const counterClockwise = (points: readonly Vec2[]): [number, number][] => {
  const copied = points.map(([x, y]): [number, number] => [x, y]);
  return signedArea(points) < 0 ? copied.reverse() : copied;
};

/**
 * A lug's outline, or an entry's `offset` outside it with its arc `radiusExtra` further out: the tapered flanks from where they
 * cross the circle `innerRadius`, inside what it joins, and the arc around the axis. Convex, centred on `centre`, with a fixed
 * vertex count for any offset.
 */
function lugOutline(
  layout: TwistLayout,
  kind: TwistLugKind,
  centre: number,
  offset: number,
  innerRadius: number,
  radiusExtra = 0,
): Vec2[] {
  const tip = lugTip(layout, kind);
  const radius = layout.radius + offset + radiusExtra;
  const { along, across } = flankOnCircle(tip, layout.radius, offset, radius);
  const inner = flankOnCircle(tip, layout.radius, offset, innerRadius);
  const reach = Math.atan2(across, along);
  const outer = Array.from({ length: LUG_ARC_POINTS + 1 }, (_, index) =>
    polar(radius, -reach + (2 * reach * index) / LUG_ARC_POINTS),
  );
  return [[inner.along, -inner.across] as Vec2, ...outer, [inner.along, inner.across] as Vec2].map((point) =>
    turned(point, centre),
  );
}

/**
 * A lug's track in the plan, in the upper part's coordinates: from the stop, the plane of the lug's leading flank in the locked
 * pose, which no clearance moves, around the axis at R + g to its entry's centre line, where the entry takes over.
 */
function trackOutline(layout: TwistLayout, kind: TwistLugKind, centre: number): Vec2[] {
  const inner = layout.openingRadius - OVERLAP_MM;
  const start = flankOnCircle(lugTip(layout, kind), layout.radius, 0, inner);
  const stop = flankAngle(layout, kind, 0, layout.trackRadius);
  return [
    turned([start.along, -start.across], centre),
    ...arc(layout.trackRadius, centre - stop, centre + TRAVEL_RAD),
    polar(inner, centre + TRAVEL_RAD),
  ];
}

function prism(kernel: GeometryKernel, track: Track, outline: readonly Vec2[], from: number, to: number): Manifold {
  const solid = track(kernel.Manifold.extrude([counterClockwise(outline)], to - from));
  return track(solid.translate([0, 0, from]));
}

/** A solid of revolution of a (ρ, z) polygon, whole or over `degrees` from `from`, turned by `phase`. */
function revolved(
  kernel: GeometryKernel,
  track: Track,
  profile: readonly Vec2[],
  segments: number,
  { from = 0, degrees, phase = 0 }: { from?: number; degrees?: number; phase?: number } = {},
): Manifold {
  const polygon = counterClockwise(profile);
  const solid =
    degrees === undefined
      ? track(kernel.Manifold.revolve([polygon], segments))
      : track(kernel.Manifold.revolve([polygon], segments, degrees));
  const turn = from + phase;
  return turn === 0 ? solid : track(solid.rotate([0, 0, (turn * 180) / Math.PI]));
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

/** The same N for every circle of the connector, the kernel's resolution for its widest. */
const segmentsOf = (layout: TwistLayout) => circularSegments(layout.mouthRadius);

/** How far an inscribed polygon's chord may lie inside its circle, at the connector's largest radius. */
const sagOf = (layout: TwistLayout) => layout.mouthRadius * (1 - Math.cos(Math.PI / segmentsOf(layout)));

/**
 * The turn of the disc's polygon, none or half a segment, whichever keeps its vertices further from where the lugs' flanks cross
 * it: a vertex micrometres from such a crossing leaves an edge that float32 rounds into a sliver. From the layout alone, so that
 * the model's male and the trial's are the same; the sweeps hold the circle grown by the sag, which holds the polygon at any turn.
 */
function discPhase(layout: TwistLayout): number {
  const step = (2 * Math.PI) / segmentsOf(layout);
  const crossings = TWIST_LUGS.flatMap(({ kind, centre }) => {
    const half = flankAngle(layout, kind, 0, layout.discRadius);
    return [centre - half, centre + half];
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

/**
 * The neck in (ρ, z): a 45° gusset at its root, which overlaps the lower part, and a 45° chamfer under the disc's rim, both
 * printable upwards; it ends inside the head.
 */
function neckProfile(layout: TwistLayout, grow = 0): Vec2[] {
  const { neckRadius, discRadius, neckHeight } = layout;
  const rim = discRadius - RIM_INSET_MM;
  return [
    [0, -ROOT_OVERLAP_MM],
    [neckRadius + ROOT_CHAMFER_MM + grow, -ROOT_OVERLAP_MM],
    [neckRadius + ROOT_CHAMFER_MM + grow, 0],
    [neckRadius + grow, ROOT_CHAMFER_MM],
    [neckRadius + grow, neckHeight - (rim - neckRadius)],
    [rim + grow, neckHeight],
    [rim + grow, neckHeight + OVERLAP_MM],
    [0, neckHeight + OVERLAP_MM],
  ];
}

/** The head's plan: the disc and the three lugs, as one outline. */
function headPlan(kernel: GeometryKernel, track: Track, layout: TwistLayout, grow = 0) {
  const segments = segmentsOf(layout);
  const phase = discPhase(layout);
  const disc = Array.from({ length: segments }, (_, index) =>
    polar(layout.discRadius + grow, phase + (2 * Math.PI * index) / segments),
  );
  const inner = layout.discRadius - OVERLAP_MM;
  const polygons = [disc, ...TWIST_LUGS.map(({ kind, centre }) => lugOutline(layout, kind, centre, grow, inner))].map(
    counterClockwise,
  );
  return track(kernel.CrossSection.union(polygons.map((polygon) => track(new kernel.CrossSection([polygon])))));
}

/** The integral male, without any solid of the lower part: the neck, and the head over it. */
export function buildTwistMale(kernel: GeometryKernel, track: Track, layout: TwistLayout): Manifold {
  const { neckHeight, headThickness } = layout;
  const neck = revolved(kernel, track, neckProfile(layout), segmentsOf(layout), { phase: discPhase(layout) });
  const head = track(
    track(kernel.Manifold.extrude(headPlan(kernel, track, layout), headThickness)).translate([0, 0, neckHeight]),
  );
  return track(neck.add(head));
}

/**
 * The recess, opening on the cut face z = 0. The central opening and the entries run through it; the tracks start at the ledges'
 * tops, a under the lugs; above the space the head turns in, a 45° cone closes all of it on the axis, so that the upper part
 * prints with its cut face on the bed without support: the ledges are its first layers, and nothing over the recess is flat.
 */
export function buildTwistCavity(kernel: GeometryKernel, track: Track, layout: TwistLayout): Manifold {
  const { openingRadius, sideClearance, ledgeTop, spaceTop, roofRadius, recessDepth, mouthRadius } = layout;
  const segments = segmentsOf(layout);
  const below = -CUTTER_MARGIN_MM;
  const top = recessDepth + CUTTER_MARGIN_MM;
  const chamfer = TWIST_MOUTH_CHAMFER_MM;
  const lead = chamfer - below;
  const base = mouthRadius + OVERLAP_MM;
  const underRoof = revolved(
    kernel,
    track,
    [
      [0, below],
      [base, below],
      [base, spaceTop - (base - roofRadius)],
      [0, recessDepth],
    ],
    segments,
  );
  // Circumscribed, so that the polygon's flats keep the whole clearance from the disc's circle.
  const opened = openingRadius / Math.cos(Math.PI / segments);
  const opening = revolved(
    kernel,
    track,
    [
      [0, below],
      [opened + lead, below],
      [opened, chamfer],
      [opened, top],
      [0, top],
    ],
    segments,
  );
  const inner = openingRadius - OVERLAP_MM;
  const entries = TWIST_LUGS.map(({ kind, centre }) => {
    const outline = (offset: number) =>
      counterClockwise(lugOutline(layout, kind, centre + TRAVEL_RAD, offset, inner, ENTRY_RADIUS_EXTRA_MM));
    return heightLoft(kernel, track, [
      { z: below, outline: outline(sideClearance + lead + ENTRY_LEAD_EXTRA_MM) },
      { z: chamfer + ENTRY_LEAD_EXTRA_MM, outline: outline(sideClearance) },
      { z: top, outline: outline(sideClearance) },
    ]);
  });
  const tracks = TWIST_LUGS.map(({ kind, centre }) => prism(kernel, track, trackOutline(layout, kind, centre), ledgeTop, top));
  const dome = prism(kernel, track, arc(roofRadius + OVERLAP_MM, 0, 2 * Math.PI).slice(0, -1), spaceTop, top);
  const plan = [opening, ...entries, ...tracks, dome].reduce((sum, solid) => track(sum.add(solid)));
  return track(plan.intersect(underRoof));
}

const toLocal = ({ origin, u, v, n }: SectionFrame): Mat4 => {
  const dot = (a: Vec3) => a[0] * origin[0] + a[1] * origin[1] + a[2] * origin[2];
  return [v[0], u[0], n[0], 0, v[1], u[1], n[1], 0, v[2], u[2], n[2], 0, -dot(v), -dot(u), -dot(n), 1] as Mat4;
};

export interface TwistParts {
  readonly lower: Manifold;
  readonly upper: Manifold;
}

/** The part simplified by the cleanup; the fit is verified on what comes out, so that no tolerance here can hide a collision. */
const cleaned = (track: Track, solid: Manifold, cleanupMm: number): Manifold => track(solid.simplify(cleanupMm));

/** The male on the lower part and the recess in the upper part, in the model's position. */
export function buildTwist(
  kernel: GeometryKernel,
  track: Track,
  parts: { readonly lower: Manifold; readonly upper: Manifold },
  { frame, layout, cleanupMm }: TwistPlan,
): TwistParts {
  const place = frameMatrix(frame, frame.origin);
  const male = track(buildTwistMale(kernel, track, layout).transform(place));
  const cavity = track(buildTwistCavity(kernel, track, layout).transform(place));
  return {
    lower: cleaned(track, track(parts.lower.add(male)), cleanupMm),
    upper: cleaned(track, track(parts.upper.subtract(cavity)), cleanupMm),
  };
}

/** The male seen from the upper part at its pose φ: turned by −φ, and moved by `lift` along z. */
export const seenFromUpper = (track: Track, solid: Manifold, poseDeg: number, lift = 0): Manifold =>
  track(track(solid.rotate([0, 0, -poseDeg])).translate([0, 0, lift]));

/**
 * What the male sweeps through the upper part from the insertion pose to the locked pose, in that part's coordinates: an exact
 * envelope, not a sampling. A lug's point at (ρ, θ, z) sweeps θ…θ + 45°; at (ρ, z) the lug covers one interval of θ around its
 * centre line, so that its sweep is the union of the lug in both end poses with its whole (ρ, z) silhouette revolved between
 * their centre lines. The neck and disc are round. The kernel's polygons, the lugs' arcs among them, lie inside their circles by
 * at most the sag, so that the curved parts grow by it, also along z, which no axial gap is as small as, while the straight
 * flanks rotate exactly: no pose in between can leave the envelope.
 */
export function buildTwistSweep(kernel: GeometryKernel, track: Track, layout: TwistLayout): Manifold {
  const segments = segmentsOf(layout);
  const sag = sagOf(layout);
  const { neckHeight, headThickness, radius, discRadius } = layout;
  const [low, high] = [neckHeight - sag, neckHeight + headThickness + sag];
  const silhouette: Vec2[] = [
    [discRadius - OVERLAP_MM, low],
    [radius + sag, low],
    [radius + sag, high],
    [discRadius - OVERLAP_MM, high],
  ];
  // A lug's arc is a polygon too: turned, its chords lie up to their sag outside the end pose's own, so that its arc grows.
  const lug = (kind: TwistLugKind, centre: number) =>
    prism(kernel, track, lugOutline(layout, kind, centre, 0, discRadius - OVERLAP_MM, sag), low, high);
  const lugs = TWIST_LUGS.flatMap(({ kind, centre }) => [
    lug(kind, centre),
    lug(kind, centre + TRAVEL_RAD),
    revolved(kernel, track, silhouette, segments, { from: centre, degrees: TWIST_TRAVEL_DEG }),
  ]);
  const disc = revolved(
    kernel,
    track,
    [
      [0, low],
      [discRadius + sag, low],
      [discRadius + sag, high],
      [0, high],
    ],
    segments,
  );
  const neck = revolved(kernel, track, neckProfile(layout, sag), segments);
  return [neck, disc, ...lugs].reduce((sum, solid) => track(sum.add(solid)));
}

/**
 * What the male sweeps while it is inserted along the axis, in its own coordinates: its plan, the disc grown by the sag, from far
 * below up to its top. The root's gusset is left out, since it only meets the mouth's lead-in at the very end, which the seated
 * pose checks.
 */
export function buildTwistCorridor(kernel: GeometryKernel, track: Track, layout: TwistLayout): Manifold {
  const top = layout.neckHeight + layout.headThickness;
  const plan = headPlan(kernel, track, layout, sagOf(layout));
  const from = -top - 5;
  return track(track(kernel.Manifold.extrude(plan, top - from)).translate([0, 0, from]));
}

/**
 * Checks the built parts in three dimensions, in the cut plane's coordinates; throws ConnectorVerificationError naming the first
 * failed check.
 *
 * - Each part is one connected solid that stays within the uncut one, and the recess opens on the cut face only.
 * - Nothing overlaps in the locked pose, or seated at −45°; the axial corridor at −45° and the envelope of the turn are free, so
 *   that the parts close, and open again by the same motion backwards.
 * - Blocked: turning 1° past the stop, pulling straight out once the axial gap is used up, and inserting at 120° or 240°.
 */
export function verifyTwist(
  kernel: GeometryKernel,
  track: Track,
  whole: Manifold,
  built: TwistParts,
  { frame, layout }: Pick<TwistPlan, 'frame' | 'layout'>,
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
  const cavity = buildTwistCavity(kernel, track, layout);
  if (volume(track(cavity.trimByPlane([0, 0, 1], 0)).subtract(envelope)) > tolerance) fail('no-breakthrough');
  const male = buildTwistMale(kernel, track, layout);
  if (volume(lower.intersect(upper)) > tolerance) fail('locked-fit');
  if (volume(seenFromUpper(track, male, -TWIST_TRAVEL_DEG).intersect(upper)) > tolerance) fail('seated-fit');
  const corridor = buildTwistCorridor(kernel, track, layout);
  if (volume(seenFromUpper(track, corridor, -TWIST_TRAVEL_DEG).intersect(upper)) > tolerance) fail('insertion-path');
  if (volume(buildTwistSweep(kernel, track, layout).intersect(upper)) > tolerance) fail('rotation-sweep');
  if (!(volume(seenFromUpper(track, male, 1).intersect(upper)) > BLOCKED_MM3)) fail('end-stop');
  const pulled = seenFromUpper(track, male, 0, -(layout.axialClearance + 0.2));
  if (!(volume(pulled.intersect(upper)) > BLOCKED_MM3)) fail('axial-retention');
  for (const wrong of [120, 240]) {
    const turnedEntry = seenFromUpper(track, corridor, -TWIST_TRAVEL_DEG + wrong);
    if (!(volume(turnedEntry.intersect(upper)) > BLOCKED_MM3)) fail('keying');
  }
}

/** The trial holders: the base under the male, and the wall around the recess and over its roof. */
const TRIAL = { base: 3, wall: 3, roof: 1.6 } as const;

/** The trial holders' own size, in millimetres: their outer radius, the base under the male and the female's height. */
export const twistTrialDimensions = (layout: TwistLayout) => ({
  outerRadius: layout.mouthRadius + TRIAL.wall,
  maleBaseHeight: TRIAL.base,
  femaleHeight: layout.recessDepth + TRIAL.roof,
});

export interface TwistTrialHolders {
  readonly male: Manifold;
  readonly female: Manifold;
  /** The holders uncut, as the envelope to verify them in. */
  readonly whole: Manifold;
}

/**
 * Two low round holders around the same male and recess, by the same builders from the same dimensions, in the coordinates of a
 * model's cut and unscaled, so that a test print shows how the model's own connector fits. Each keeps the wall the model's checks
 * require and a little more to grip, and a plain round outside.
 */
export function buildTwistTrial(kernel: GeometryKernel, track: Track, layout: TwistLayout): TwistTrialHolders {
  const { outerRadius: outer, maleBaseHeight, femaleHeight: height } = twistTrialDimensions(layout);
  const segments = circularSegments(outer);
  const circle = Array.from({ length: segments }, (_, index) => polar(outer, (2 * Math.PI * index) / segments));
  const base = prism(kernel, track, circle, -maleBaseHeight, 0);
  const body = prism(kernel, track, circle, 0, height);
  const male = cleaned(track, track(base.add(buildTwistMale(kernel, track, layout))), CLEANUP_MM);
  const female = cleaned(track, track(body.subtract(buildTwistCavity(kernel, track, layout))), CLEANUP_MM);
  return { male, female, whole: track(base.add(body)) };
}

/** The identity frame of the holders, whose cut plane is z = 0. */
export const TWIST_TRIAL_FRAME: SectionFrame = { origin: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0], n: [0, 0, 1] };
