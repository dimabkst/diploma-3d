import { type MagnetConnector, magnetPocketMm, type PhysicalScale } from '@diploma-3d/schema';
import type { Manifold, Mat4 } from 'manifold-3d';
import { ConnectorVerificationError } from '../errors.ts';
import type { GeometryKernel } from '../kernel.ts';
import { dot, length, type Vec3 } from '../mesh.ts';
import type { Track } from '../scope.ts';
import { ballCentreMm } from '../shapes/ball.ts';
import type { RoundShape } from '../shapes/round.ts';
import { circularSegments } from '../shapes/round.ts';
import {
  type BallHorizontalSection,
  CONSTRAINT_ROUNDOFF_MM,
  connectorVolumeTolerance,
  type FacetedSection,
  facesOfPart,
  facetedCut,
  framePoint,
  insideEnvelope,
  isPlateCut,
  middleOf,
  type SectionedShape,
  type SectionFrame,
  type SolidCut,
  type SolidFace,
  solidCut,
} from './frame.ts';

type Part = 'lower' | 'upper';

/**
 * One pair of pockets: their shared axis through `centre` on the cut's middle plane, along its normal n, given in the model's
 * millimetres as assembled. The lower part's pocket opens on its face and runs along −n, the upper part's along +n, both from
 * the same centre, so that they stay coaxial whatever moves the parts afterwards.
 */
export interface MagnetSite {
  readonly centre: Vec3;
  /** The same centre along the frame's u and v from its origin. */
  readonly along: number;
  readonly across: number;
}

/** Why the requested magnets do not fit; nothing is shrunk, moved or left out to make them fit. */
export type MagnetIssue =
  /** The part reaches less far from its face along the axis than a pocket and the material beneath it need. */
  | { readonly code: 'too-shallow'; readonly part: Part; readonly valueMm: number; readonly minimumMm: number }
  /** No position keeps one opening the edge clearance inside both mating faces. */
  | { readonly code: 'face-too-small' }
  /** Openings fit on the faces, but nowhere does a whole pocket keep its wall in this part. */
  | { readonly code: 'wall-thin'; readonly part: Part }
  /** The search found single positions, but no arrangement of all pairs that keeps the spacing between them. */
  | { readonly code: 'no-arrangement'; readonly placed: number }
  /** Between two parallel planes the middle part is too thin for the pockets of both and the material between them. */
  | { readonly code: 'middle-thin'; readonly valueMm: number; readonly minimumMm: number };

export interface MagnetPlan {
  readonly type: 'magnet';
  /** The cut's middle frame; with a section plate, each part's face lies `faceGap` from it along n. */
  readonly frame: SectionFrame;
  readonly faceGap: number;
  readonly count: number;
  /** d + Δd and t + Δt: the pocket's nominal diameter, which its polygon circumscribes, and its depth from the face. */
  readonly holeDiameter: number;
  readonly holeDepth: number;
  /** The automatic 45° entry chamfer's size, 0 for none; see `MAGNET_PLACEMENT_POLICY`. */
  readonly chamfer: number;
  /** The sides of the pocket's polygon; its corners lie at (d + Δd)/2 / cos(π/sides), its flats on the nominal circle. */
  readonly segments: number;
  /** The least material around a pocket's sides and beneath its bottom, and between neighbouring openings. */
  readonly wall: number;
  readonly bottomWall: number;
  readonly spacing: number;
  /** The least gap from each opening's outer edge, chamfer included, to the edge of the mating faces. */
  readonly edgeGap: number;
  readonly sites: readonly MagnetSite[];
  readonly issues: readonly MagnetIssue[];
}

/** A plane bounding a convex solid from inside: normal·x ≤ offset. */
interface BoundingPlane {
  readonly normal: Vec3;
  readonly offset: number;
}

/**
 * A mating face and the part behind it, as a pocket opening there sees them: the least material between a ring of the pocket
 * and the part's outer surface, the distance from a point of the face to the face's edge within it, and how far the part
 * reaches from the face along the axis. The cut face itself bounds no wall, as the pocket opens on it.
 */
interface PocketSide {
  readonly part: Part;
  readonly inward: Vec3;
  /** Where the face lies along the middle frame's n. */
  readonly faceOffset: number;
  readonly wall: (centre: Vec3, radius: number) => number;
  readonly edge: (point: Vec3) => number;
  readonly reach: number;
}

const scaled = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * A part of a cone or a cylinder: a convex polyhedron, so that the material between a convex pocket and its surface is the least
 * distance to the planes of its faces, a ring's farthest point setting it for each, and a point of the face is as far from the
 * face's edge as from the nearest line where another face meets it.
 */
function facetedSide(part: Part, section: FacetedSection, side: 'negative' | 'positive', faceOffset: number): PocketSide {
  const { u, v, n, origin } = section.frame;
  const inward = side === 'positive' ? n : scaled(n, -1);
  const toPlane = (face: SolidFace): BoundingPlane => {
    const normal = plus(plus(scaled(u, face.alongU), scaled(v, face.alongV)), scaled(n, face.alongN));
    return { normal, offset: face.clearance + dot(normal, origin) };
  };
  const sine = ({ normal }: BoundingPlane) => Math.sqrt(Math.max(0, 1 - dot(normal, inward) ** 2));
  const bounding = facesOfPart(section, side).map(toPlane);
  const edges = section.faces
    .map(toPlane)
    .map((plane) => ({ ...plane, sine: sine(plane) }))
    .filter((plane) => plane.sine > SINE_ROUNDOFF);
  return {
    part,
    inward,
    faceOffset,
    wall: (centre, radius) =>
      Math.min(...bounding.map((plane) => plane.offset - dot(plane.normal, centre) - radius * sine(plane))),
    edge: (point) => Math.min(...edges.map((plane) => (plane.offset - dot(plane.normal, point)) / plane.sine)),
    reach: side === 'positive' ? section.reach.positive : section.reach.negative,
  };
}

// A face this close to parallel to the cut meets it nowhere near the section.
const SINE_ROUNDOFF = 1e-9;

/**
 * A part of a ball, measured to the sphere inside its polyhedron as the ball's other connectors are: a ring's farthest point
 * from the centre sets its wall, and the face is the circle where that sphere meets its plane.
 */
function ballSide(part: Part, scale: PhysicalScale, inradius: number, inward: Vec3, faceOffset: number, face: Vec3): PocketSide {
  const centre = ballCentreMm(scale);
  const split = (point: Vec3) => {
    const relative = minus(point, centre);
    const along = dot(relative, inward);
    return { along, across: length(minus(relative, scaled(inward, along))) };
  };
  return {
    part,
    inward,
    faceOffset,
    wall: (point, radius) => {
      const { along, across } = split(point);
      return inradius - Math.hypot(across + radius, along);
    },
    edge: (point) => {
      const { along, across } = split(point);
      return Math.sqrt(Math.max(0, inradius ** 2 - along ** 2)) - across;
    },
    reach: inradius - split(face).along,
  };
}

/** The middle frame, the section's outline there, the faces' distance from it, and both parts as their pockets see them. */
function pocketSides(shape: SectionedShape, scale: PhysicalScale, cut: SolidCut) {
  const section = solidCut(shape, scale, cut);
  const { frame } = section;
  const { n, origin } = frame;
  if (section.type === 'ball-horizontal' || section.type === 'ball-plate') {
    const gap = section.type === 'ball-plate' ? section.halfThickness : 0;
    const sides: [PocketSide, PocketSide] = [
      ballSide('lower', scale, section.inradius, scaled(n, -1), -gap, plus(origin, scaled(n, -gap))),
      ballSide('upper', scale, section.inradius, n, gap, plus(origin, scaled(n, gap))),
    ];
    return { frame, contour: (section as BallHorizontalSection).contour, gap, sides };
  }
  if (section.type === 'cone-plate' || section.type === 'cylinder-plate') {
    const gap = section.halfThickness;
    const sides: [PocketSide, PocketSide] = [
      facetedSide('lower', section.interfaces.lower, 'positive', -gap),
      facetedSide('upper', section.interfaces.upper, 'positive', gap),
    ];
    return { frame, contour: section.contour, gap, sides };
  }
  if (shape.kind === 'ball' || isPlateCut(cut)) throw new Error('Unexpected cut.');
  // Every cut of a cylinder or a cone read off its faces, also those its other connectors measure by formulas; a cube's or
  // parallelepiped's section is read off its faces already.
  const faceted = section.type === 'box-section' ? section : facetedCut(shape as RoundShape, scale, cut);
  const sides: [PocketSide, PocketSide] = [
    facetedSide('lower', faceted, 'negative', 0),
    facetedSide('upper', faceted, 'positive', 0),
  ];
  return { frame: faceted.frame, contour: faceted.contour, gap: 0, sides };
}

/**
 * The placement's own engineering defaults, in printed millimetres: starting values for small educational models, not a
 * material-strength guarantee, and never lowered to make a configuration fit.
 *
 * - Material around a pocket's sides, beneath its bottom and between neighbouring openings, and from each opening's outer edge,
 *   chamfer included, to the edge of the faces: 2 mm each.
 * - The preferred centres follow from the section's outline alone, see `preferredMagnetCentres`: a ring at 0,6 of the way from
 *   the centroid to the outline. An internal layout preference, not a physical optimum.
 * - A small 45° entry chamfer of min(0,2 mm, t/4), shortened where it would leave less than three quarters of the magnet's
 *   thickness in the cylindrical seat, and left out below 0,05 mm.
 */
export const MAGNET_PLACEMENT_POLICY = {
  sideMaterialMm: 2,
  bottomMaterialMm: 2,
  spacingMm: 2,
  minimumEdgeGapMm: 2,
  ringShare: 0.6,
  chamfer: { maximumMm: 0.2, thicknessShare: 0.25, seatShare: 0.75, leastMm: 0.05 },
} as const;

/** The automatic entry chamfer for this magnet and pocket depth; see `MAGNET_PLACEMENT_POLICY`. */
export function magnetChamferMm(magnetThicknessMm: number, holeDepthMm: number): number {
  const { maximumMm, thicknessShare, seatShare, leastMm } = MAGNET_PLACEMENT_POLICY.chamfer;
  const chamfer = Math.min(maximumMm, thicknessShare * magnetThicknessMm, holeDepthMm - seatShare * magnetThicknessMm);
  return chamfer < leastMm ? 0 : chamfer;
}

/** The pocket's measures as built: the polygon's corner radius for the nominal circle and for the chamfer's opening. */
export function magnetPocketGeometry(connector: MagnetConnector) {
  const { diameter, depth } = magnetPocketMm(connector);
  const chamfer = magnetChamferMm(connector.magnetThicknessMm, depth);
  const segments = circularSegments(diameter / 2 + chamfer);
  // The polygon circumscribes the circle: its flats, never its corners, lie on the nominal diameter, so the magnet fits.
  const corner = 1 / Math.cos(Math.PI / segments);
  return { diameter, depth, chamfer, segments, radius: (diameter / 2) * corner, opening: (diameter / 2 + chamfer) * corner };
}

/** A position in the middle frame: along u and v from its origin. */
export type FramePoint = readonly [along: number, across: number];

/**
 * One position, and how both pockets fare there: the gap from the opening's outer edge to the nearer edge of the faces, and per
 * part the least slack of the material around and beneath the whole pocket.
 */
interface Candidate {
  readonly along: number;
  readonly across: number;
  readonly edge: number;
  readonly walls: Readonly<Record<Part, number>>;
}

// The fallback's grid across the section's larger extent: about a millimetre on the largest sections.
const GRID_DIVISIONS = 72;

/**
 * The pockets of the magnet connector, in the model's millimetres, and the issues that rule them out; pure, so that the
 * interface can explain a configuration before anything is built. Every value is physical: nothing follows the model's size.
 *
 * The placement first takes the preferred centres of the section and the count, which no pocket dimension changes (see
 * `preferredMagnetCentres`), exactly as they are wherever the pockets fit there. Where they do not, it moves them jointly to
 * the nearest arrangement that fits (see `settle`): apart where neighbouring openings would come too close, inwards where the
 * material outside them would be too thin. Only if that fails does it try a bounded set of other patterns, keeping the one
 * nearest to the preferred centres, and last the positions of a grid. Every position is tested with the whole pocket of both
 * parts: the gap from its opening, chamfer included, to the edge of both mating faces, and the material around every ring of
 * it (the opening, the chamfer's end and the bottom) to the part's outer surface; for these convex parts that bounds the whole
 * cavity. The result is deterministic. A failed search does not prove that no arrangement exists.
 */
export function planMagnets(shape: SectionedShape, scale: PhysicalScale, cut: SolidCut, connector: MagnetConnector): MagnetPlan {
  const policy = MAGNET_PLACEMENT_POLICY;
  const pocket = magnetPocketGeometry(connector);
  const { frame, contour, gap, sides } = pocketSides(shape, scale, cut);
  const base = {
    type: 'magnet' as const,
    frame,
    faceGap: gap,
    count: connector.count,
    holeDiameter: pocket.diameter,
    holeDepth: pocket.depth,
    chamfer: pocket.chamfer,
    segments: pocket.segments,
    wall: policy.sideMaterialMm,
    bottomWall: policy.bottomMaterialMm,
    spacing: policy.spacingMm,
    edgeGap: policy.minimumEdgeGapMm,
  };
  const unavailable = (issues: MagnetIssue[]): MagnetPlan => ({ ...base, sites: [], issues });
  const needed = pocket.depth + policy.bottomMaterialMm;
  const shallow = sides.flatMap((side): MagnetIssue[] =>
    side.reach < needed ? [{ code: 'too-shallow', part: side.part, valueMm: side.reach, minimumMm: needed }] : [],
  );
  if (shallow.length > 0) return unavailable(shallow);
  // The middle part between two parallel planes takes a pocket from each plane, of the same depth; wherever they lie, the
  // material beneath one is what separates it from the other plane's, so both stacked keep the bottom's material between them.
  const middle = middleOf(solidCut(shape, scale, cut));
  if (middle !== undefined && middle.thickness < 2 * pocket.depth + policy.bottomMaterialMm) {
    return unavailable([
      { code: 'middle-thin', valueMm: middle.thickness - 2 * pocket.depth, minimumMm: policy.bottomMaterialMm },
    ]);
  }
  const at = ([along, across]: FramePoint) => measure(frame, sides, pocket, along, across);
  const slack = (point: FramePoint) => slackOf(at(point));
  const apart = 2 * pocket.opening + policy.spacingMm;
  const outline = outlineOf(contour, frame);
  const preferred = preferredMagnetCentres(outline, connector.count);
  const done = (centres: readonly FramePoint[]): MagnetPlan => ({
    ...base,
    sites: centres.map(([along, across]) => ({ centre: framePoint(frame, [along, across, 0]), along, across })),
    issues: [],
  });
  if (fits(preferred, slack, apart)) return done(preferred);
  let best: { centres: FramePoint[]; moved: number } | undefined;
  for (const start of alternativeCentres(outline, connector.count)) {
    const settled = settle(start, slack, apart);
    if (settled === undefined) continue;
    const moved = displacement(settled, preferred);
    if (best === undefined || moved < best.moved - CONSTRAINT_ROUNDOFF_MM) best = { centres: settled, moved };
  }
  if (best !== undefined) return done(best.centres);
  // Nothing near the preferred centres fits: what does fit anywhere, and why not, from a grid over the section.
  const candidates = gridOf(contour, frame).map(at);
  const onFaces = candidates.filter((candidate) => candidate.edge >= policy.minimumEdgeGapMm);
  if (onFaces.length === 0) return unavailable([{ code: 'face-too-small' }]);
  const thin = sides.flatMap((side): MagnetIssue[] =>
    onFaces.some((candidate) => candidate.walls[side.part] >= 0) ? [] : [{ code: 'wall-thin', part: side.part }],
  );
  if (thin.length > 0) return unavailable(thin);
  const feasible = onFaces.filter((candidate) => slackOf(candidate) >= 0);
  if (feasible.length === 0)
    return unavailable([
      { code: 'wall-thin', part: 'lower' },
      { code: 'wall-thin', part: 'upper' },
    ]);
  const spread = spreadOver(feasible, connector.count);
  const placed = largestSpacedSubset(spread, apart);
  if (placed === connector.count) {
    const settled = settle(spread, slack, apart);
    if (settled !== undefined) return done(settled);
  }
  return unavailable([{ code: 'no-arrangement', placed: Math.min(placed, connector.count - 1) }]);
}

/** The least slack of every hard constraint of both pockets at a position: the edge gap's and each part's material. */
const slackOf = (candidate: Candidate) =>
  Math.min(candidate.edge - MAGNET_PLACEMENT_POLICY.minimumEdgeGapMm, candidate.walls.lower, candidate.walls.upper);

/** Whether every position keeps its material and every pair of openings the spacing. */
function fits(centres: readonly FramePoint[], slack: (point: FramePoint) => number, apart: number): boolean {
  return (
    centres.every((point) => slack(point) >= -CONSTRAINT_ROUNDOFF_MM) &&
    centres.every((first, index) =>
      centres.slice(index + 1).every((second) => pointDistance(first, second) >= apart - CONSTRAINT_ROUNDOFF_MM),
    )
  );
}

const pointDistance = (a: FramePoint, b: FramePoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** How far a set of centres lies from the preferred ones: each preferred centre matched to the nearest one not yet taken. */
function displacement(centres: readonly FramePoint[], preferred: readonly FramePoint[]): number {
  const free = [...centres];
  let total = 0;
  for (const target of preferred) {
    let nearest = 0;
    for (let index = 1; index < free.length; index += 1) {
      if (pointDistance(free[index] as FramePoint, target) < pointDistance(free[nearest] as FramePoint, target)) nearest = index;
    }
    total += pointDistance(free[nearest] as FramePoint, target) ** 2;
    free.splice(nearest, 1);
  }
  return total;
}

const SETTLE_ITERATIONS = 150;
// The iteration gives up when the worst violation has not shrunk by a hundredth over this many rounds.
const SETTLE_PATIENCE = 25;
// Each correction overshoots its constraint by this much, so that the iteration ends on positions that satisfy it.
const SETTLE_MARGIN_MM = 1e-6;
const GRADIENT_STEP_MM = 1e-4;

/**
 * The positions moved jointly to the nearest ones that fit, by alternating corrections of whatever is violated, each the least
 * move that satisfies it: a pair of openings too close moves apart symmetrically along the line between them, and a position
 * whose material or edge gap falls short moves along the gradient of that slack. So a ring whose openings overlap widens about
 * its centre and one that comes too close to the outline narrows, both keeping its shape; nothing that fits moves. Undefined
 * when the corrections conflict, as where the spacing needs more room than the material leaves.
 */
function settle(start: readonly FramePoint[], slack: (point: FramePoint) => number, apart: number): FramePoint[] | undefined {
  const points = start.map(([along, across]): [number, number] => [along, across]);
  let [worst, since] = [Number.POSITIVE_INFINITY, 0];
  for (let iteration = 0; iteration < SETTLE_ITERATIONS; iteration += 1) {
    let changed = false;
    let violation = 0;
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        const [a, b] = [points[first] as [number, number], points[second] as [number, number]];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (distance >= apart) continue;
        violation = Math.max(violation, apart - distance);
        const [sa, sb] = [start[first] as FramePoint, start[second] as FramePoint];
        const fallback = Math.hypot(sa[0] - sb[0], sa[1] - sb[1]);
        const [dx, dy] =
          distance > CONSTRAINT_ROUNDOFF_MM
            ? [(a[0] - b[0]) / distance, (a[1] - b[1]) / distance]
            : fallback > CONSTRAINT_ROUNDOFF_MM
              ? [(sa[0] - sb[0]) / fallback, (sa[1] - sb[1]) / fallback]
              : [1, 0];
        const push = (apart - distance) / 2 + SETTLE_MARGIN_MM;
        [a[0], a[1], b[0], b[1]] = [a[0] + dx * push, a[1] + dy * push, b[0] - dx * push, b[1] - dy * push];
        changed = true;
      }
    }
    for (const point of points) {
      const value = slack(point);
      if (value >= 0) continue;
      violation = Math.max(violation, -value);
      const gradient = [
        (slack([point[0] + GRADIENT_STEP_MM, point[1]]) - slack([point[0] - GRADIENT_STEP_MM, point[1]])) /
          (2 * GRADIENT_STEP_MM),
        (slack([point[0], point[1] + GRADIENT_STEP_MM]) - slack([point[0], point[1] - GRADIENT_STEP_MM])) /
          (2 * GRADIENT_STEP_MM),
      ] as const;
      const squared = gradient[0] ** 2 + gradient[1] ** 2;
      if (squared < 1e-12) return undefined;
      const step = (SETTLE_MARGIN_MM - value) / squared;
      [point[0], point[1]] = [point[0] + gradient[0] * step, point[1] + gradient[1] * step];
      changed = true;
    }
    if (!changed) break;
    if (violation < 0.99 * worst) {
      [worst, since] = [violation, 0];
    } else {
      since += 1;
      if (since > SETTLE_PATIENCE) break;
    }
  }
  return fits(points, slack, apart) ? points : undefined;
}

/** The section's outline in the frame's (along, across), in order around it. */
function outlineOf(contour: readonly Vec3[], { origin, u, v }: SectionFrame): FramePoint[] {
  return contour.map((point) => [dot(minus(point, origin), u), dot(minus(point, origin), v)] as const);
}

/** The outline's area centroid and its central second moments of area, from the triangle fan of its edges. */
function momentsOf(outline: readonly FramePoint[]) {
  let [area, cx, cy, xx, xy, yy] = [0, 0, 0, 0, 0, 0];
  outline.forEach(([x0, y0], index) => {
    const [x1, y1] = outline[(index + 1) % outline.length] as FramePoint;
    const cross = x0 * y1 - x1 * y0;
    area += cross / 2;
    cx += (cross * (x0 + x1)) / 6;
    cy += (cross * (y0 + y1)) / 6;
    xx += (cross * (x0 * x0 + x0 * x1 + x1 * x1)) / 12;
    yy += (cross * (y0 * y0 + y0 * y1 + y1 * y1)) / 12;
    xy += (cross * (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0)) / 24;
  });
  const [mx, my] = [cx / area, cy / area];
  // The outline may run either way round; the moments of its area are positive whichever.
  const sign = Math.sign(area);
  return {
    centroid: [mx, my] as FramePoint,
    xx: sign * (xx - area * mx * mx),
    xy: sign * (xy - area * mx * my),
    yy: sign * (yy - area * my * my),
  };
}

/** How far the outline lies from a point along a direction: the nearest crossing of the ray with its edges. */
function reachAlong(outline: readonly FramePoint[], [px, py]: FramePoint, angle: number): number {
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
  let nearest = Number.POSITIVE_INFINITY;
  outline.forEach(([ax, ay], index) => {
    const [bx, by] = outline[(index + 1) % outline.length] as FramePoint;
    const [ex, ey] = [bx - ax, by - ay];
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-15) return;
    const t = ((ax - px) * ey - (ay - py) * ex) / denominator;
    const share = ((ax - px) * dy - (ay - py) * dx) / denominator;
    if (t > 0 && share >= -1e-12 && share <= 1 + 1e-12) nearest = Math.min(nearest, t);
  });
  return Number.isFinite(nearest) ? nearest : 0;
}

// Second moments this close to equal make the outline round for the layout, whose orientation then follows the frame's u.
const ROUND_ANISOTROPY = 0.02;

/**
 * The centroid, the direction of the outline's major principal axis, along the frame's u for a round one, and its elongation,
 * the ratio of its principal radii of gyration: a/b for an a × b rectangle.
 */
function axesOf(outline: readonly FramePoint[]): { centroid: FramePoint; angle: number; elongation: number } {
  const { centroid, xx, xy, yy } = momentsOf(outline);
  const spread = Math.hypot(xx - yy, 2 * xy);
  const round = spread <= ROUND_ANISOTROPY * (xx + yy);
  const [major, minor] = [(xx + yy + spread) / 2, (xx + yy - spread) / 2];
  return {
    centroid,
    angle: round ? 0 : Math.atan2(2 * xy, xx - yy) / 2,
    elongation: minor > 0 ? Math.sqrt(major / minor) : Number.POSITIVE_INFINITY,
  };
}

// From this elongation on, a strip rather than a round region: pairs go along its length rather than round a ring.
const STRIP_ELONGATION = 2.5;

type Pattern = 'ring' | 'line' | 'rows';

/**
 * Positions of `count` pairs on the outline's own geometry, about its centroid and turned with its major axis: none depends on
 * a pocket's size. `ring`: one pair at the centroid; two along the major axis; more as a regular polygon, one corner on the
 * major axis for an odd count and two straddling it for an even one, each `share` of the way from the centroid to the outline
 * along its own direction, so that the ring follows a long or uneven outline; seven and more as an outer and an inner ring.
 * `line`: evenly along the major axis. `rows`: two such lines either side of it.
 */
function patternOf(outline: readonly FramePoint[], count: number, pattern: Pattern, share: number, turn = 0): FramePoint[] {
  const { centroid, angle } = axesOf(outline);
  const toward = (direction: number, fraction: number): FramePoint => {
    const reach = fraction * reachAlong(outline, centroid, direction);
    return [centroid[0] + reach * Math.cos(direction), centroid[1] + reach * Math.sin(direction)];
  };
  if (count === 1) return [centroid];
  const lineOf = (points: number, offset: number): FramePoint[] => {
    const across = angle + Math.PI / 2;
    const shift = offset === 0 ? 0 : offset * reachAlong(outline, centroid, offset > 0 ? across : across + Math.PI);
    const base: FramePoint = [
      centroid[0] + Math.abs(shift) * Math.cos(offset > 0 ? across : across + Math.PI),
      centroid[1] + Math.abs(shift) * Math.sin(offset > 0 ? across : across + Math.PI),
    ];
    return Array.from({ length: points }, (_, index) => {
      const t = points === 1 ? 0 : -1 + (2 * index) / (points - 1);
      const direction = t >= 0 ? angle : angle + Math.PI;
      const reach = share * Math.abs(t) * reachAlong(outline, base, direction);
      return [base[0] + reach * Math.cos(direction), base[1] + reach * Math.sin(direction)] as FramePoint;
    });
  };
  if (pattern === 'line') return lineOf(count, 0);
  if (pattern === 'rows') return [...lineOf(Math.ceil(count / 2), 0.5), ...lineOf(Math.floor(count / 2), -0.5)];
  const ring = (points: number, fraction: number, offset: number): FramePoint[] => {
    const start = points === 2 ? 0 : points % 2 === 0 ? Math.PI / points : 0;
    return Array.from({ length: points }, (_, index) =>
      toward(angle + start + offset + turn + (2 * Math.PI * index) / points, fraction),
    );
  };
  if (count <= 6) return ring(count, share, 0);
  const inner = Math.floor(count / 3);
  return [...ring(count - inner, share * 1.2, 0), ...ring(inner, share * 0.55, Math.PI / inner)];
}

/**
 * The preferred centres of `count` pairs on this section, from its outline alone, so that no magnet dimension changes them: the
 * ring of `patternOf` at `MAGNET_PLACEMENT_POLICY.ringShare` of the way to the outline, or, for three and more pairs on an
 * elongated section, its line along the length. On a round section three pairs form an equilateral triangle of circumradius
 * 0,6·R with one corner along the frame's u. An internal layout preference only.
 */
export function preferredMagnetCentres(outline: readonly FramePoint[], count: number): FramePoint[] {
  return patternOf(outline, count, preferredPattern(outline, count), MAGNET_PLACEMENT_POLICY.ringShare);
}

/** A ring, or on an elongated section a line along its length. */
const preferredPattern = (outline: readonly FramePoint[], count: number): Pattern =>
  count >= 3 && axesOf(outline).elongation >= STRIP_ELONGATION ? 'line' : 'ring';

/**
 * Where the search starts when the preferred centres cannot be settled into a fit: the preferred ring itself, then narrower and
 * wider rings, the ring turned by quarters of its step, and lines and rows along the major axis. Bounded and in a fixed order.
 */
function alternativeCentres(outline: readonly FramePoint[], count: number): FramePoint[][] {
  const share = MAGNET_PLACEMENT_POLICY.ringShare;
  if (count === 1) return [patternOf(outline, 1, 'ring', share)];
  const step = (2 * Math.PI) / Math.min(count, 6);
  return [
    patternOf(outline, count, preferredPattern(outline, count), share),
    patternOf(outline, count, 'ring', share),
    patternOf(outline, count, 'ring', share * 0.75),
    patternOf(outline, count, 'ring', share * 1.25),
    ...[1, 2, 3].map((quarter) => patternOf(outline, count, 'ring', share, (quarter * step) / 4)),
    patternOf(outline, count, 'line', share),
    patternOf(outline, count, 'line', share * 1.3),
    ...(count >= 4 ? [patternOf(outline, count, 'rows', share), patternOf(outline, count, 'rows', share * 1.3)] : []),
  ];
}

/** The grid's positions within the section's bounding box in the frame, row by row: the fallback's candidates alone. */
function gridOf(contour: readonly Vec3[], { origin, u, v }: SectionFrame): FramePoint[] {
  const local = contour.map((point) => [dot(minus(point, origin), u), dot(minus(point, origin), v)] as const);
  const [alongs, acrosses] = [local.map(([along]) => along), local.map(([, across]) => across)];
  const box = {
    along: { min: Math.min(...alongs), max: Math.max(...alongs) },
    across: { min: Math.min(...acrosses), max: Math.max(...acrosses) },
  };
  const step = Math.max(box.along.max - box.along.min, box.across.max - box.across.min) / GRID_DIVISIONS;
  const steps = (extent: { min: number; max: number }) => Math.max(0, Math.floor((extent.max - extent.min) / step));
  const points: FramePoint[] = [];
  const [rows, columns] = [steps(box.along), steps(box.across)];
  const [startAlong, startAcross] = [
    (box.along.min + box.along.max - rows * step) / 2,
    (box.across.min + box.across.max - columns * step) / 2,
  ];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) points.push([startAlong + row * step, startAcross + column * step]);
  }
  return points;
}

function measure(
  frame: SectionFrame,
  sides: readonly PocketSide[],
  pocket: ReturnType<typeof magnetPocketGeometry>,
  along: number,
  across: number,
): Candidate {
  const { sideMaterialMm, bottomMaterialMm } = MAGNET_PLACEMENT_POLICY;
  const centre = framePoint(frame, [along, across, 0]);
  let edge = Number.POSITIVE_INFINITY;
  const walls = { lower: Number.POSITIVE_INFINITY, upper: Number.POSITIVE_INFINITY };
  for (const side of sides) {
    const face = plus(centre, scaled(frame.n, side.faceOffset));
    edge = Math.min(edge, side.edge(face) - pocket.opening);
    // Each ring with the material it needs: the sides around the opening and the chamfer's end, both beneath the bottom.
    const rings: [depth: number, radius: number, needed: number][] = [
      [0, pocket.opening, sideMaterialMm],
      ...(pocket.chamfer > 0 ? ([[pocket.chamfer, pocket.radius, sideMaterialMm]] as [number, number, number][]) : []),
      [pocket.depth, pocket.radius, Math.max(sideMaterialMm, bottomMaterialMm)],
    ];
    walls[side.part] = Math.min(
      ...rings.map(([depth, radius, needed]) => side.wall(plus(face, scaled(side.inward, depth)), radius) - needed),
    );
  }
  return { along, across, edge, walls };
}

/** How many of the positions, taken in order, keep the spacing from all those before them. */
function largestSpacedSubset(points: readonly FramePoint[], apart: number): number {
  const kept: FramePoint[] = [];
  for (const point of points) {
    if (kept.every((other) => pointDistance(point, other) >= apart - CONSTRAINT_ROUNDOFF_MM)) kept.push(point);
  }
  return kept.length;
}

/** The last resort: the farthest-point spread over the feasible grid positions, from the one nearest to the centroid. */
function spreadOver(feasible: readonly Candidate[], count: number): FramePoint[] {
  const points = feasible.map(({ along, across }): FramePoint => [along, across]);
  const nearest = (point: FramePoint, chosen: readonly FramePoint[]) =>
    chosen.reduce((least, other) => Math.min(least, pointDistance(point, other)), Number.POSITIVE_INFINITY);
  const chosen = [points.reduce((best, point) => (Math.hypot(...point) < Math.hypot(...best) ? point : best))];
  while (chosen.length < count && chosen.length < points.length) {
    chosen.push(points.reduce((far, point) => (nearest(point, chosen) > nearest(far, chosen) ? point : far)));
  }
  return chosen;
}

/** The face point, the inward axis and a proper rotation of the local (x, y, z) onto the face, z inward, for a pocket. */
function pocketPlacement(plan: MagnetPlan, site: MagnetSite, part: Part): { face: Vec3; inward: Vec3; matrix: Mat4 } {
  const { u, v, n } = plan.frame;
  const sign = part === 'upper' ? 1 : -1;
  const face = plus(site.centre, scaled(n, sign * plan.faceGap));
  // (v, u, n) and (u, v, −n) both have determinant +1: v·(u × n) = 1, u·(v × −n) = u·u = 1.
  const [first, second, inward] = part === 'upper' ? [v, u, n] : [u, v, scaled(n, -1)];
  return { face, inward, matrix: [...first, 0, ...second, 0, ...inward, 0, ...face, 1] as Mat4 };
}

/**
 * A closed solid of revolution's polygon along its local z from layer to layer, each ring of `segments` corners at the given
 * corner radius; the caps close it at the first and last heights.
 */
function lathe(
  kernel: GeometryKernel,
  track: Track,
  layers: readonly (readonly [height: number, radius: number])[],
  segments: number,
  matrix: Mat4,
): Manifold {
  const positions: number[] = [];
  for (const [height, radius] of layers) {
    for (let index = 0; index < segments; index += 1) {
      const angle = (2 * Math.PI * index) / segments;
      positions.push(radius * Math.cos(angle), radius * Math.sin(angle), height);
    }
  }
  const bottom = positions.length / 3;
  positions.push(
    0,
    0,
    (layers[0] as readonly [number, number])[0],
    0,
    0,
    (layers[layers.length - 1] as readonly [number, number])[0],
  );
  const triangles: number[] = [];
  const last = (layers.length - 1) * segments;
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    triangles.push(bottom, next, index, bottom + 1, last + index, last + next);
    for (let ring = 0; ring + 1 < layers.length; ring += 1) {
      const [below, above] = [ring * segments, (ring + 1) * segments];
      triangles.push(below + index, below + next, above + next, below + index, above + next, above + index);
    }
  }
  const mesh = new kernel.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(positions),
    triVerts: Uint32Array.from(triangles),
  });
  return track(track(new kernel.Manifold(mesh)).transform(matrix));
}

// The cutter continues past the face, so that no membrane is left over the opening.
const CUTTER_MARGIN_MM = 0.5;

/** One pocket's cutter: from beyond the face, through the chamfer, to the bottom at the hole's depth. */
function pocketCutter(kernel: GeometryKernel, track: Track, plan: MagnetPlan, site: MagnetSite, part: Part): Manifold {
  const corner = 1 / Math.cos(Math.PI / plan.segments);
  const radius = (plan.holeDiameter / 2) * corner;
  const layers: [number, number][] =
    plan.chamfer > 0
      ? [
          [-CUTTER_MARGIN_MM, radius + (plan.chamfer + CUTTER_MARGIN_MM) * corner],
          [plan.chamfer, radius],
          [plan.holeDepth, radius],
        ]
      : [
          [-CUTTER_MARGIN_MM, radius],
          [plan.holeDepth, radius],
        ];
  return lathe(kernel, track, layers, plan.segments, pocketPlacement(plan, site, part).matrix);
}

export interface MagnetParts {
  readonly lower: Manifold;
  readonly upper: Manifold;
  /** Per site, the cutter of each part's pocket, in the order of the plan's sites. */
  readonly pockets: readonly Readonly<Record<Part, Manifold>>[];
}

/** Subtracts every pocket from its part; every object is tracked. */
export function buildMagnetPockets(
  kernel: GeometryKernel,
  track: Track,
  parts: { readonly lower: Manifold; readonly upper: Manifold },
  plan: MagnetPlan,
): MagnetParts {
  const pockets = plan.sites.map((site) => ({
    lower: pocketCutter(kernel, track, plan, site, 'lower'),
    upper: pocketCutter(kernel, track, plan, site, 'upper'),
  }));
  const cut = (part: Part) => pockets.reduce<Manifold>((result, pocket) => track(result.subtract(pocket[part])), parts[part]);
  return { lower: cut('lower'), upper: cut('upper'), pockets };
}

/**
 * Checks the built parts in three dimensions; throws ConnectorVerificationError naming the first failed check.
 *
 * - Each part is one connected solid, of genus 0: every pocket is blind.
 * - Each pocket, within its part, stays inside the uncut solid, and is empty in the built part.
 * - The material the plan promises is there: the pocket's polygon grown by the wall over its depth, and continued by the wall
 *   beneath its bottom, lies within the uncut solid.
 * - No two pockets of a part meet.
 */
export function verifyMagnetPockets(
  kernel: GeometryKernel,
  track: Track,
  whole: Manifold,
  built: MagnetParts,
  plan: MagnetPlan,
  longestDimensionMm: number,
): void {
  const tolerance = connectorVolumeTolerance(longestDimensionMm);
  const volume = (manifold: Manifold) => track(manifold).volume();
  const fail = (check: string): never => {
    throw new ConnectorVerificationError(check);
  };
  for (const part of [built.lower, built.upper]) {
    const pieces = part.decompose();
    for (const piece of pieces) track(piece);
    if (pieces.length !== 1) fail('connected');
    if (part.genus() !== 0) fail('blind');
  }
  const envelope = insideEnvelope(track, whole, plan.frame);
  const corner = 1 / Math.cos(Math.PI / plan.segments);
  const radius = (plan.holeDiameter / 2) * corner;
  for (const part of ['lower', 'upper'] as const) {
    const insides = plan.sites.map((site, index) => {
      const { face, inward, matrix } = pocketPlacement(plan, site, part);
      const cutter = (built.pockets[index] as Record<Part, Manifold>)[part];
      const inside = track(cutter.trimByPlane([inward[0], inward[1], inward[2]], dot(inward, face)));
      if (volume(inside.subtract(envelope)) > tolerance) fail('no-breakthrough');
      if (volume(inside.intersect(built[part])) > tolerance) fail('pocket-empty');
      const side = lathe(
        kernel,
        track,
        [
          [0, radius + plan.wall],
          [plan.holeDepth, radius + plan.wall],
        ],
        plan.segments,
        matrix,
      );
      const beneath = lathe(
        kernel,
        track,
        [
          [0, radius],
          [plan.holeDepth + plan.bottomWall, radius],
        ],
        plan.segments,
        matrix,
      );
      if (volume(side.subtract(envelope)) > tolerance || volume(beneath.subtract(envelope)) > tolerance) fail('wall');
      return inside;
    });
    insides.forEach((first, index) => {
      for (const second of insides.slice(index + 1)) if (volume(first.intersect(second)) > tolerance) fail('pockets-apart');
    });
  }
}
