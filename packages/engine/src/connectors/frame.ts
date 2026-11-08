import {
  type ConeShape,
  type CylinderShape,
  type PhysicalScale,
  SECTION_POSITION_LIMITS,
  type Section,
} from '@diploma-3d/schema';
import type { Manifold, Mat4 } from 'manifold-3d';
import { GeometryError } from '../errors.ts';
import { cross, dot, length, type Vec3 } from '../mesh.ts';
import { cosSinDeg } from '../shapes/angle.ts';
import { circularSegments, type RoundShape, roundDimensionsMm } from '../shapes/round.ts';

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

/**
 * One flat face of the polygonal cylinder, seen from the frame of a cut: the plane's distance from the frame's origin,
 * the outward unit normal in the frame's axes, and which parts of the cut the face actually bounds. A face wholly on the
 * other side of the cut is not a wall of a part, however close its plane comes.
 */
export interface SolidFace {
  readonly clearance: number;
  readonly alongU: number;
  readonly alongV: number;
  readonly alongN: number;
  readonly boundsNegative: boolean;
  readonly boundsPositive: boolean;
}

/**
 * A cut read off the actual polygonal solid rather than from a formula of its ideal shape. The solid is convex, so its
 * section is the convex `contour` with `frame.origin` at the contour's area centroid, and an interior point is exactly
 * as far from its surface as from the nearest of `faces`.
 */
export interface FacetedSection extends CutGeometry {
  /** The plane itself: its unit normal, and the distance of the plane along it from the world's origin. */
  readonly plane: { readonly normal: Vec3; readonly offset: number };
  /** The section's corners, counter-clockwise seen along −n. */
  readonly contour: readonly Vec3[];
  readonly area: number;
  readonly faces: readonly SolidFace[];
  /** How far each part reaches from the plane along the normal. */
  readonly reach: { readonly negative: number; readonly positive: number };
  /**
   * How far from the centroid the part on the positive side reaches towards a dovetail's entrance, within this distance
   * above the plane: where a tongue that slides off has left that part.
   */
  readonly entranceReachWithin: (thickness: number) => number;
}

/**
 * A cylinder's oblique cut: part A (`negative`) lies on the negative side of the normal, part B (`positive`) on the
 * positive one. Either base may clip the contour; u points uphill within the plane, v = u × n is horizontal.
 */
export interface ObliqueCylinderSection extends FacetedSection {
  readonly type: 'oblique';
  /** P = C0 + t·(C1 − C0), through which the plane passes. */
  readonly axisPoint: Vec3;
  /** Whether the whole axis lies in the plane, so that the position along it changes nothing. */
  readonly containsAxis: boolean;
}

/**
 * A cone's cut parallel to its base: the frustum lies below the plane, the smaller cone with the apex above it. The upper
 * part narrows and, in an oblique cone, leans over the section, so nothing above the cut can be read off its radius.
 */
export interface ConeParallelSection extends FacetedSection {
  readonly type: 'cone-parallel';
}

export type SolidSection = ParallelCylinderSection | VerticalCylinderSection | ObliqueCylinderSection | ConeParallelSection;

/** A vertical cut's position: the signed distance from the axis in percent of the radius. */
export interface VerticalCut {
  readonly offsetPercent: number;
}

/** An oblique cut: the point on the axis, the angle to the base plane, and the horizontal direction it rises along. */
export interface ObliqueCut {
  readonly positionPercent: number;
  readonly inclinationDeg: number;
  readonly directionDeg: number;
}

/** Where a round solid is cut: a plane parallel to the base at this percentage of the height, or another plane. */
export type SolidCut = number | VerticalCut | ObliqueCut;

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

/** n = −sin α·q + cos α·Z, with q = (cos φ, sin φ, 0) the direction the plane rises along; 360° gives what 0° gives. */
export function obliqueAxes(
  inclinationDeg: number,
  directionDeg: number,
): { readonly n: Vec3; readonly u: Vec3; readonly v: Vec3 } {
  const [cosAlpha, sinAlpha] = cosSinDeg(inclinationDeg);
  const [cosPhi, sinPhi] = cosSinDeg(directionDeg % 360);
  return {
    // + 0 turns −sin α·0 into 0.
    n: [-sinAlpha * cosPhi + 0, -sinAlpha * sinPhi + 0, cosAlpha],
    // Z − (Z·n)·n = sin α·(cos α·q + sin α·Z): well-defined for every α > 0, and of unit length once sin α is taken out.
    u: [cosAlpha * cosPhi, cosAlpha * sinPhi, sinAlpha],
    // u × n = q × Z, written out so that it is exactly horizontal, which an upright part's half turn relies on.
    v: [sinPhi, -cosPhi, 0],
  };
}

/**
 * Whether the plane contains the cylinder's whole axis a = (d, 0, H), so that every P on it gives the same plane:
 * n·a = 0. The ratio d/H decides, whatever the size. Compared rather than solved for, so nothing divides by n·a.
 */
export function obliquePlaneContainsAxis(shape: CylinderShape, inclinationDeg: number, directionDeg: number): boolean {
  const { n } = obliqueAxes(inclinationDeg, directionDeg);
  const axis: Vec3 = [shape.offsetRatio, 0, shape.heightRatio];
  return Math.abs(dot(n, axis)) <= AXIS_IN_PLANE_RELATIVE * length(axis);
}

// Relative to the axis's length; far below any change of the plane that a printed part could show.
const AXIS_IN_PLANE_RELATIVE = 1e-9;

/** The convex polygon where a plane meets the polyhedron's edges, in order around it; empty when it misses them. */
function planeContour(
  vertices: readonly Vec3[],
  edges: readonly (readonly [number, number])[],
  { n, u, v }: { readonly n: Vec3; readonly u: Vec3; readonly v: Vec3 },
  offset: number,
): Vec3[] {
  const sides = vertices.map((vertex) => dot(n, vertex) - offset);
  const crossings: Vec3[] = [];
  for (const [first, second] of edges) {
    const [a, b] = [sides[first] as number, sides[second] as number];
    if (a < 0 === b < 0) continue;
    const share = a / (a - b);
    const [p, q] = [vertices[first] as Vec3, vertices[second] as Vec3];
    crossings.push([p[0] + share * (q[0] - p[0]), p[1] + share * (q[1] - p[1]), p[2] + share * (q[2] - p[2])]);
  }
  if (crossings.length === 0) return [];
  const centre = crossings.reduce<Vec3>((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0]);
  const middle: Vec3 = [centre[0] / crossings.length, centre[1] / crossings.length, centre[2] / crossings.length];
  const angleOf = (point: Vec3) => {
    const relative: Vec3 = [point[0] - middle[0], point[1] - middle[1], point[2] - middle[2]];
    return Math.atan2(dot(relative, u), dot(relative, v));
  };
  const ordered = crossings.map((point) => ({ point, angle: angleOf(point) })).sort((a, b) => a.angle - b.angle);
  return ordered
    .filter(({ point }, index) => {
      const next = (ordered[(index + 1) % ordered.length] as (typeof ordered)[number]).point;
      // A plane through a vertex crosses each edge at that vertex: the same corner, once.
      return ordered.length === 1 || Math.hypot(point[0] - next[0], point[1] - next[1], point[2] - next[2]) > CONTOUR_MERGE_MM;
    })
    .map(({ point }) => point);
}

// Far below any feature of the polygon, whose sides are never shorter than a fraction of a millimetre.
const CONTOUR_MERGE_MM = 1e-9;

/**
 * The area and area centroid of a convex polygon, in the plane with axes (v, u) through its first corner: the sum of the
 * triangle fan, each triangle's centroid weighted by its area. The average of the corners would follow their spacing.
 */
function polygonCentroid(corners: readonly Vec3[], u: Vec3, v: Vec3): { readonly area: number; readonly centroid: Vec3 } {
  const origin = corners[0] as Vec3;
  const relative = corners.map((corner): Vec3 => [corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2]]);
  let area = 0;
  let sum: Vec3 = [0, 0, 0];
  for (let index = 1; index + 1 < relative.length; index += 1) {
    const [b, c] = [relative[index] as Vec3, relative[index + 1] as Vec3];
    const twice = dot(b, v) * dot(c, u) - dot(b, u) * dot(c, v);
    area += twice / 2;
    sum = [sum[0] + (twice * (b[0] + c[0])) / 6, sum[1] + (twice * (b[1] + c[1])) / 6, sum[2] + (twice * (b[2] + c[2])) / 6];
  }
  return { area, centroid: [origin[0] + sum[0] / area, origin[1] + sum[1] / area, origin[2] + sum[2] / area] };
}

/** The polygonal solid as manifold-3d builds it: its corners, its edges, and its faces with their corners. */
interface Polyhedron {
  readonly vertices: readonly Vec3[];
  readonly edges: readonly (readonly [number, number])[];
  readonly faces: readonly { readonly normal: Vec3; readonly offset: number; readonly corners: readonly number[] }[];
  /** The number of sides of the base polygon. */
  readonly sides: number;
}

/** The base polygon's edges, and its face on z = 0; the rest of a round solid follows from these. */
function baseOf(radius: number) {
  const polygon = basePolygon(radius);
  const indices = polygon.map((_, index) => index);
  const baseFace = { normal: [0, 0, -1] as Vec3, offset: 0, corners: indices };
  return { polygon, indices, baseFace, sides: polygon.length };
}

/** The base polygon, the same polygon at z = H moved by d along X, and the sides between them. */
function cylinderPolyhedron({ radius, height, offset: d }: { radius: number; height: number; offset: number }): Polyhedron {
  const { polygon, indices, baseFace, sides } = baseOf(radius);
  const shear = d / height;
  return {
    vertices: [...polygon.map(([x, y]): Vec3 => [x, y, 0]), ...polygon.map(([x, y]): Vec3 => [x + d, y, height])],
    edges: indices.flatMap((index) => {
      const next = (index + 1) % sides;
      return [
        [index, next],
        [sides + index, sides + next],
        [index, sides + index],
      ] as const;
    }),
    faces: [
      baseFace,
      { normal: [0, 0, 1], offset: height, corners: indices.map((index) => sides + index) },
      ...indices.map((index) => {
        const next = (index + 1) % sides;
        const [[x0, y0], [x1, y1]] = [polygon[index] as [number, number], polygon[next] as [number, number]];
        // The right prism's side (a, b, 0)·p = c becomes (a, b, −a·d/H) under the shear x' = x + (d/H)·z.
        const [a, b] = [y1 - y0, x0 - x1];
        const norm = Math.hypot(a, b, a * shear);
        const normal: Vec3 = [a / norm, b / norm, (-a * shear) / norm];
        return { normal, offset: dot(normal, [x0, y0, 0]), corners: [index, next, sides + index, sides + next] };
      }),
    ],
    sides,
  };
}

/** The base polygon and the triangles from each of its sides to the apex at (d, 0, H). */
function conePolyhedron({ radius, height, offset: d }: { radius: number; height: number; offset: number }): Polyhedron {
  const { polygon, indices, baseFace, sides } = baseOf(radius);
  const apex: Vec3 = [d, 0, height];
  return {
    vertices: [...polygon.map(([x, y]): Vec3 => [x, y, 0]), apex],
    edges: indices.flatMap((index) => [[index, (index + 1) % sides] as const, [index, sides] as const]),
    faces: [
      baseFace,
      ...indices.map((index) => {
        const next = (index + 1) % sides;
        const [[x0, y0], [x1, y1]] = [polygon[index] as [number, number], polygon[next] as [number, number]];
        // Edge × (apex − corner) points outwards, as the polygon runs counter-clockwise under the apex.
        const outward = cross([x1 - x0, y1 - y0, 0], [d - x0, -y0, height]);
        const normal = normalised(outward);
        return { normal, offset: dot(normal, [x0, y0, 0]), corners: [index, next, sides] };
      }),
    ],
    sides,
  };
}

/**
 * Reads a plane's section off the polyhedron: the convex polygon where the plane crosses its edges, clipped by a base
 * wherever it reaches one; no ellipse or circle is assumed. Only faces with a corner strictly on a part's side bound that
 * part. `towardsEntrance` is +1 or −1 along u.
 */
function facetedSection(
  { vertices, edges, faces, sides }: Polyhedron,
  axes: { readonly n: Vec3; readonly u: Vec3; readonly v: Vec3 },
  offset: number,
  radius: number,
  towardsEntrance: 1 | -1,
): FacetedSection {
  const { n, u, v } = axes;
  const contour = planeContour(vertices, edges, axes, offset);
  if (contour.length < 3) throw new GeometryError('The plane does not cut the solid.');
  const { area, centroid } = polygonCentroid(contour, u, v);
  const alongPlane = contour.map((corner) => dot(corner, u));
  const across = vertices.map((vertex) => dot(n, vertex) - offset);
  return {
    frame: { origin: centroid, u, v, n },
    radius,
    inradius: radius * Math.cos(Math.PI / sides),
    span: Math.max(...alongPlane) - Math.min(...alongPlane),
    depthExtent: Math.max(...across) - Math.min(...across),
    plane: { normal: n, offset },
    contour,
    area,
    faces: faces.map(({ normal, offset: faceOffset, corners }) => ({
      clearance: faceOffset - dot(normal, centroid),
      alongU: dot(normal, u),
      alongV: dot(normal, v),
      alongN: dot(normal, n),
      boundsNegative: corners.some((corner) => (across[corner] as number) < -CONTOUR_MERGE_MM),
      boundsPositive: corners.some((corner) => (across[corner] as number) > CONTOUR_MERGE_MM),
    })),
    reach: { negative: -Math.min(...across), positive: Math.max(...across) },
    entranceReachWithin: (thickness) => {
      // The layer's farthest point lies on one of its two planes or at a corner of the solid between them.
      const inLayer = vertices.filter((_, index) => (across[index] as number) >= 0 && (across[index] as number) <= thickness);
      const candidates = [...contour, ...planeContour(vertices, edges, axes, offset + thickness), ...inLayer];
      return Math.max(...candidates.map((point) => towardsEntrance * (dot(point, u) - dot(centroid, u))));
    },
  };
}

/** The oblique cut of the cylinder as it is built: P = t·C1 with C0 at the origin, whatever the lean, and n·x = n·P. */
export function obliqueCylinderSection(shape: CylinderShape, scale: PhysicalScale, cut: ObliqueCut): ObliqueCylinderSection {
  const dimensions = roundDimensionsMm(shape, scale);
  const axes = obliqueAxes(cut.inclinationDeg, cut.directionDeg);
  const t = cut.positionPercent / 100;
  const axisPoint: Vec3 = [t * dimensions.offset, 0, t * dimensions.height];
  return {
    ...facetedSection(cylinderPolyhedron(dimensions), axes, dot(axes.n, axisPoint), dimensions.radius, 1),
    type: 'oblique',
    axisPoint,
    containsAxis: obliquePlaneContainsAxis(shape, cut.inclinationDeg, cut.directionDeg),
  };
}

/**
 * A cone's cut at z = t·H, with the frame of a cylinder's parallel cut: u is perpendicular to the lean, +Y for every cone,
 * and the groove's entrance lies at −u. The section is the base polygon scaled by 1 − t about the apex, centred on
 * C0 + t·(A − C0), which the tests compare with its contour; the walls come from the faces alone.
 */
export function coneSection(shape: ConeShape, scale: PhysicalScale, positionPercent: number): ConeParallelSection {
  const dimensions = roundDimensionsMm(shape, scale);
  const n: Vec3 = [0, 0, 1];
  const u: Vec3 = [0, 1, 0];
  const v = cross(u, n);
  const offset = (positionPercent / 100) * dimensions.height;
  return {
    ...facetedSection(conePolyhedron(dimensions), { n, u, v }, offset, dimensions.radius, -1),
    type: 'cone-parallel',
  };
}

/**
 * The least distance each part must keep from the plane along the normal for a usable part, in millimetres: the rule of
 * a vertical cut, at least one wall and a tenth of the solid's extent. The position's limits already keep that share,
 * since the part's reach from P is a mean of t·|n·a| and the polygon's own reach. An application restriction: it does
 * not make every thin part printable.
 */
export function obliquePartMinimumMm(section: ObliqueCylinderSection): number {
  return Math.max((SECTION_POSITION_LIMITS.min / 100) * section.depthExtent, CONNECTOR_MIN_WALL_MM);
}

/** How far the thinner part reaches from an oblique plane, in millimetres, with what it must reach. */
export function obliqueSplitReach(
  shape: CylinderShape,
  scale: PhysicalScale,
  cut: ObliqueCut,
): { readonly valueMm: number; readonly minimumMm: number } {
  const section = obliqueCylinderSection(shape, scale, cut);
  return { valueMm: Math.min(section.reach.negative, section.reach.positive), minimumMm: obliquePartMinimumMm(section) };
}

/** A round cavity's circle in the plane normal to n: the wall to one face, which its nearest point to that plane sets. */
export const discWall = (face: SolidFace, along: number, normal: number, radius: number): number =>
  face.clearance - along * face.alongU - normal * face.alongN - radius * Math.hypot(face.alongU, face.alongV);

/** The wall from a point (along u, across v, along n) in the frame to one face. */
export const pointWall = (face: SolidFace, along: number, across: number, normal: number): number =>
  face.clearance - along * face.alongU - across * face.alongV - normal * face.alongN;

/** The faces that bound the part on one side of the plane. */
export const facesOfPart = ({ faces }: FacetedSection, part: 'negative' | 'positive'): readonly SolidFace[] =>
  faces.filter((face) => (part === 'negative' ? face.boundsNegative : face.boundsPositive));

/** Where the specification's section cuts the cylinder. */
export const cutOfSection = (section: Section): SolidCut => {
  switch (section.type) {
    case 'vertical':
      return { offsetPercent: section.offsetPercent };
    case 'oblique':
      return {
        positionPercent: section.positionPercent,
        inclinationDeg: section.inclinationDeg,
        directionDeg: section.directionDeg,
      };
    case 'parallel-to-bases':
      return section.positionPercent;
  }
};

/** The geometry of the cut. */
export function solidCut(shape: RoundShape, scale: PhysicalScale, cut: SolidCut): SolidSection {
  if (shape.kind === 'cone') {
    if (typeof cut !== 'number') throw new GeometryError('A cone offers only a cut parallel to its base.');
    return coneSection(shape, scale, cut);
  }
  if (typeof cut === 'number') return cylinderSection(shape, scale, cut);
  return 'offsetPercent' in cut
    ? verticalCylinderSection(shape, scale, cut.offsetPercent)
    : obliqueCylinderSection(shape, scale, cut);
}

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

/**
 * The uncut solid for "stays inside it" checks: grown about the section's centre by a millionth, which moves its faces by
 * far less than any print can show. A part's own surface coincides with the solid's, and exactly coincident surfaces are
 * where a Boolean operation can leave a sliver of volume that is not there; what really leaves the solid still shows.
 */
export function insideEnvelope(track: (manifold: Manifold) => Manifold, whole: Manifold, { origin }: SectionFrame): Manifold {
  const centred = track(whole.translate([-origin[0], -origin[1], -origin[2]]));
  return track(track(centred.scale(1 + 1e-6)).translate([origin[0], origin[1], origin[2]]));
}

/** Below this volume, in mm³ for M = 80 mm and scaled with M³, an intersection is Boolean roundoff, not contact. */
const VOLUME_TOLERANCE_AT_80_MM = 1e-3;

export const connectorVolumeTolerance = (longestDimensionMm: number): number =>
  VOLUME_TOLERANCE_AT_80_MM * (longestDimensionMm / 80) ** 3;
