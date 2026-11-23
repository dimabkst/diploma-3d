import {
  type BoxFace,
  type BoxSectionSpec,
  type BoxSegment,
  type BoxVertex,
  boxFaceSegmentKind,
  type CubeShape,
  type CuboidShape,
  type ParallelepipedShape,
  type PhysicalScale,
  type PrismShape,
  type PrismTopology,
  prismSidesOf,
  prismTopology,
  SECTION_POSITION_LIMITS,
  type Shape,
} from '@diploma-3d/schema';
import { GeometryError } from '../errors.ts';
import { cross, dot, length, type Vec3 } from '../mesh.ts';
import { cosSinDeg } from '../shapes/angle.ts';
import { boxEdgeLengthsMm } from '../shapes/box.ts';
import { parallelepipedProportions } from '../shapes/parallelepiped.ts';
import { prismShapeProportions } from '../shapes/prism.ts';
import { type PrismProportions, prismScaleMm, prismVertices } from '../shapes/prism-geometry.ts';
import {
  type BoxSection,
  CONNECTOR_MIN_WALL_MM,
  type FrameExtent,
  facetedSection,
  obliqueAxes,
  type Polyhedron,
} from './frame.ts';

/**
 * The solids whose sections are planes through their named vertices: a cube, the parallelepipeds and the prisms, each a prism
 * over its base polygon, with 2n vertices, 3n edges and n + 2 faces; see `PrismTopology`.
 */
export type BoxLikeShape = CubeShape | CuboidShape | ParallelepipedShape | PrismShape;

export const isBoxShape = (shape: { readonly kind: string }): shape is BoxLikeShape =>
  shape.kind === 'cube' || shape.kind === 'cuboid' || shape.kind === 'parallelepiped' || shape.kind === 'prism';

/** The solid's vertices, faces and edges by name. */
export const boxTopologyOf = (shape: BoxLikeShape): PrismTopology => prismTopology(prismSidesOf(shape as Shape) as number);

/** Vertices by name: those of one topology, the 2n names of its prism. */
export type BoxVertices = Readonly<Record<BoxVertex, Vec3>>;

/** The topology of a set of vertices: half of them are a base's. */
export const topologyOf = (vertices: BoxVertices): PrismTopology => prismTopology(Object.keys(vertices).length / 2);

/**
 * A box section's cut: the section without its connector, and whether it is seen from its second plane, for that plane's own
 * connector. The planes follow from the solid each time, so that they keep their relation to its faces and edges.
 */
export interface BoxCut {
  readonly box: BoxSectionSpec;
  readonly atSecond?: true;
}

/**
 * The vertices in millimetres, which the solid is built from as their convex hull, its sections' planes are constructed through
 * and the preview names: a cube or rectangular parallelepiped centred on the Z axis on the plate, z from 0 to c; a
 * parallelepiped's or prism's base the polygon of its proportions, AB along +X, scaled as the prism is, and its upper base moved
 * by the scaled displacement (dx, dy, h).
 */
export function boxVertices(shape: BoxLikeShape, scale: PhysicalScale): BoxVertices {
  let points: Vec3[];
  if (shape.kind === 'parallelepiped' || shape.kind === 'prism') {
    const proportions: PrismProportions =
      shape.kind === 'parallelepiped' ? parallelepipedProportions(shape) : prismShapeProportions(shape);
    const s = prismScaleMm(proportions, scale);
    points = prismVertices(proportions).map(([x, y, z]): Vec3 => [x * s, y * s, z * s]);
  } else {
    const [a, b, c] = boxEdgeLengthsMm(shape, scale);
    const base: [number, number][] = [
      [-a / 2, -b / 2],
      [a / 2, -b / 2],
      [a / 2, b / 2],
      [-a / 2, b / 2],
    ];
    points = [...base.map(([x, y]): Vec3 => [x, y, 0]), ...base.map(([x, y]): Vec3 => [x, y, c])];
  }
  const { vertices } = prismTopology(points.length / 2);
  return Object.fromEntries(vertices.map((name, index) => [name, points[index] as Vec3])) as Record<BoxVertex, Vec3>;
}

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => times(a, 1 / length(a));
const mean = (points: readonly Vec3[]): Vec3 => times(points.reduce(plus, [0, 0, 0]), 1 / points.length);

const pointsOf = (vertices: BoxVertices): Vec3[] => topologyOf(vertices).vertices.map((name) => vertices[name]);

const cornersOf = (topology: PrismTopology, face: BoxFace): readonly BoxVertex[] => {
  const corners = topology.faces[face];
  if (corners === undefined) throw new GeometryError(`The solid has no face ${face}.`);
  return corners;
};

/** The solid as a convex polyhedron of its own vertices, edges and faces, each face with its outward normal. */
export function boxPolyhedron(vertices: BoxVertices): Polyhedron {
  const topology = topologyOf(vertices);
  const index = (name: BoxVertex) => topology.vertices.indexOf(name);
  const centre = mean(pointsOf(vertices));
  return {
    vertices: pointsOf(vertices),
    edges: topology.edges.map(([a, b]) => [index(a), index(b)] as const),
    faces: topology.faceNames.map((face) => {
      const corners = cornersOf(topology, face);
      const normal = faceNormal(vertices, corners, centre);
      return { normal, offset: dot(normal, vertices[corners[0] as BoxVertex]), corners: corners.map(index) };
    }),
    // Its faces are its own; this only scales the unused inscribed radius of round solids.
    sides: topology.sides,
  };
}

/** A face's outward unit normal, away from the solid's centre, by Newell's sum over its corners, for any number of them. */
function faceNormal(vertices: BoxVertices, corners: readonly BoxVertex[], centre: Vec3): Vec3 {
  const points = corners.map((name) => vertices[name]);
  const sum = points.reduce<Vec3>(
    (total, point, index) => plus(total, cross(point, points[(index + 1) % points.length] as Vec3)),
    [0, 0, 0],
  );
  const normal = unit(sum);
  return dot(normal, minus(points[0] as Vec3, centre)) > 0 ? normal : times(normal, -1);
}

/** Where the solid lies along a unit normal: min and max of n·vertex. */
export function boxExtent(vertices: BoxVertices, normal: Vec3): FrameExtent {
  const along = pointsOf(vertices).map((point) => dot(normal, point));
  return { min: Math.min(...along), max: Math.max(...along) };
}

/** A plane as a mode constructs it: the unit normal it is measured along, and its offset n·x = d. */
export interface BoxPlane {
  readonly normal: Vec3;
  readonly offset: number;
  /** The solid's extent along that normal, which positions are percentages of. */
  readonly extent: FrameExtent;
}

const at = ({ min, max }: FrameExtent, percent: number) => min + (percent / 100) * (max - min);

// A normal component this small makes the plane horizontal or vertical for its orientation.
const AXIS_ROUNDOFF = 1e-12;

/**
 * The plane a section's mode makes on this solid, before its orientation is settled; see the section schemas.
 *
 * - Parallel to a face: the face's inward normal, at the percentage of the way to the farthest vertex beyond it.
 * - Longitudinal: the trace t on the base plane, at its angle to AB or along a line of the base, see `boxTraceLine`, swept
 *   along the lateral edge a, so that the normal t × a is perpendicular to a whatever the lean, n·a = 0; at the percentage of
 *   the solid's extent along it, or through the line itself.
 * - Through a line PQ of a face: turned from the face's plane by the angle, n = e × (cos θ·m + sin θ·(−n_F)), with e along PQ
 *   and m in the face, perpendicular to PQ and towards the face's inside (towards the mean of its other corners for a diagonal);
 *   or through the point R of another edge, n = (Q − P) × (R − P), refused where R lies on the line.
 * - Inclined: n = (−sin α cos φ, −sin α sin φ, cos α), or along the chosen segment, such as a lateral edge, n = a/|a|.
 */
export function boxPlane(vertices: BoxVertices, spec: BoxSectionSpec): BoxPlane {
  const measured = (normal: Vec3, offset?: number): BoxPlane => {
    const extent = boxExtent(vertices, normal);
    return { normal, offset: offset ?? at(extent, 'positionPercent' in spec ? spec.positionPercent : 50), extent };
  };
  const topology = topologyOf(vertices);
  switch (spec.type) {
    case 'face-parallel': {
      const centre = mean(pointsOf(vertices));
      return measured(times(faceNormal(vertices, cornersOf(topology, spec.face ?? topology.lowerBase), centre), -1));
    }
    case 'longitudinal': {
      const lateral = minus(vertices.A1, vertices.A);
      const line = boxTraceLine(vertices, spec);
      const trace = line?.direction ?? rotatedInBase(minus(vertices.B, vertices.A), spec.traceAngleDeg);
      const normal = unit(cross(unit(trace), lateral));
      return measured(normal, spec.through === true && line !== undefined ? dot(normal, line.point) : undefined);
    }
    case 'through-line': {
      const [p, q] = [vertices[spec.line[0]], vertices[spec.line[1]]];
      if (spec.method === 'point') {
        const point = pointOnEdge(vertices, spec.pointEdge as BoxSegment, spec.pointPercent as number);
        const raw = cross(minus(q, p), minus(point, p));
        if (length(raw) <= COLLINEAR_RELATIVE * length(minus(q, p)) * Math.max(length(minus(point, p)), 1)) {
          throw new GeometryError('The point lies on the line: they do not fix one plane.');
        }
        const normal = unit(raw);
        return measured(normal, dot(normal, p));
      }
      const frame = lineFrame(vertices, spec.face, spec.line);
      const normal = turnedNormal(frame, spec.angleDeg as number);
      return measured(normal, dot(normal, p));
    }
    case 'inclined': {
      const normal =
        spec.normalAlong === undefined
          ? obliqueAxes(spec.inclinationDeg, spec.directionDeg).n
          : unit(minus(vertices[spec.normalAlong[1]], vertices[spec.normalAlong[0]]));
      return measured(normal);
    }
  }
}

/**
 * The line of the lower base that a longitudinal plane's trace runs along, as a point of it and its direction, computed from the
 * actual base: a diagonal PR; for a triangle, the median from V to the midpoint of the opposite side, the altitude from V
 * perpendicular to that side's line, whose foot may lie on its extension, the internal bisector from V along the sum of the
 * unit vectors to the other vertices, and the midline through the midpoints of the two sides other than the one it is
 * parallel to. Undefined for a trace at an angle.
 */
export function boxTraceLine(
  vertices: BoxVertices,
  spec: Extract<BoxSectionSpec, { type: 'longitudinal' }>,
): { readonly point: Vec3; readonly direction: Vec3 } | undefined {
  const segment = (first: BoxVertex, second: BoxVertex) => ({
    point: vertices[first],
    direction: minus(vertices[second], vertices[first]),
  });
  const topology = topologyOf(vertices);
  const base = cornersOf(topology, topology.lowerBase);
  switch (spec.trace) {
    case 'angle':
      return undefined;
    case 'AC':
      return segment('A', 'C');
    case 'BD':
      return segment('B', 'D');
    case 'diagonal':
    case 'midline': {
      const [first, second] = spec.traceSegment as BoxSegment;
      if (spec.trace === 'diagonal') return segment(first, second);
      const other = base.find((name) => name !== first && name !== second) as BoxVertex;
      const middle = (a: BoxVertex, b: BoxVertex) => times(plus(vertices[a], vertices[b]), 0.5);
      return { point: middle(first, other), direction: minus(vertices[second], vertices[first]) };
    }
    case 'median':
    case 'height':
    case 'bisector': {
      const vertex = spec.traceVertex as BoxVertex;
      const [left, right] = base.filter((name) => name !== vertex).map((name) => vertices[name]) as [Vec3, Vec3];
      const point = vertices[vertex];
      const side = minus(right, left);
      const direction =
        spec.trace === 'median'
          ? minus(times(plus(left, right), 0.5), point)
          : spec.trace === 'height'
            ? ([-side[1], side[0], 0] as Vec3)
            : plus(unit(minus(left, point)), unit(minus(right, point)));
      return { point, direction };
    }
  }
}

// Relative to the lengths involved: far below any edge a print could show, far above roundoff of vertex coordinates.
const COLLINEAR_RELATIVE = 1e-9;

const pointOnEdge = (vertices: BoxVertices, [first, second]: BoxSegment, percent: number): Vec3 =>
  plus(vertices[first], times(minus(vertices[second], vertices[first]), percent / 100));

/**
 * The planes through a line PQ of a face, by the angle they turn from the face's plane into the solid: P, the unit e along PQ,
 * the unit w in the face perpendicular to PQ towards the face's inside (towards its first other corner for a diagonal, which
 * halves it), and the face's outward normal o. The plane at θ holds e and cos θ·w − sin θ·o, so 0° and 180° are the face's.
 */
interface LineFrame {
  readonly p: Vec3;
  readonly along: Vec3;
  readonly within: Vec3;
  readonly outward: Vec3;
}

function lineFrame(vertices: BoxVertices, face: BoxFace, line: readonly [BoxVertex, BoxVertex]): LineFrame {
  const p = vertices[line[0]];
  const corners = cornersOf(topologyOf(vertices), face);
  const outward = faceNormal(vertices, corners, mean(pointsOf(vertices)));
  const along = unit(minus(vertices[line[1]], p));
  const within = unit(cross(along, outward));
  const others = corners.filter((name) => !line.includes(name));
  const inside = dot(within, minus(mean(others.map((name) => vertices[name])), p));
  const towards =
    Math.abs(inside) > COLLINEAR_RELATIVE
      ? Math.sign(inside)
      : Math.sign(dot(within, minus(vertices[others[0] as BoxVertex], p)));
  return { p, along, within: times(within, towards), outward };
}

/** The unit normal e × (cos θ·w − sin θ·o) of the plane at θ. */
function turnedNormal({ along, within, outward }: LineFrame, angleDeg: number): Vec3 {
  const [cos, sin] = cosSinDeg(angleDeg);
  return unit(cross(along, plus(times(within, cos), times(outward, -sin))));
}

/**
 * The angle of the plane through the frame's line and a point off it: the direction from the line to the point, in the plane
 * perpendicular to the line, as cos θ·w − sin θ·o. A point of the solid lies on the inner side of the face, −o·r ≥ 0, so θ lies
 * in [0°, 180°]; undefined for a point on the line.
 */
function angleOfPoint({ p, along, within, outward }: LineFrame, point: Vec3, size: number): number | undefined {
  const offset = minus(point, p);
  const across = minus(offset, times(along, dot(along, offset)));
  if (length(across) <= COLLINEAR_RELATIVE * size) return undefined;
  return (Math.atan2(Math.max(-dot(outward, across), 0), dot(within, across)) * 180) / Math.PI;
}

/**
 * Which planes leave both parts usable: `printed`, the application's rule at the export scale, see `boxPartMinimumMm`;
 * `proportional`, its part that does not depend on the scale, a tenth of the solid's extent along the normal. Choices are
 * offered by the proportional rule, so that a plane that exists for the solid's shape is never hidden for a small model, whose
 * fields then say why it does not fit; the fields' ranges follow the printed rule.
 */
export type BoxPartRule = 'printed' | 'proportional';

const partMinimum = (rule: BoxPartRule, extent: FrameExtent): number =>
  rule === 'printed' ? boxPartMinimumMm(extent) : (SECTION_POSITION_LIMITS.min / 100) * (extent.max - extent.min);

/** A direction of the base plane turned counter-clockwise, seen from above, by the angle. */
function rotatedInBase(direction: Vec3, angleDeg: number): Vec3 {
  const [cos, sin] = cosSinDeg(angleDeg % 360);
  return [direction[0] * cos - direction[1] * sin, direction[0] * sin + direction[1] * cos, 0];
}

/**
 * The plane's settled orientation: its normal turned upwards, or, for a vertical plane, towards +Y and then +X, so that the
 * parts below and above a horizontal plane are the lower and the upper one, and a frame's directions do not depend on how a
 * mode happened to construct it. The plane itself does not change.
 */
function settled({ normal, offset }: { normal: Vec3; offset: number }): { normal: Vec3; offset: number } {
  const [x, y, z] = normal;
  const flip =
    z < -AXIS_ROUNDOFF || (Math.abs(z) <= AXIS_ROUNDOFF && (y < -AXIS_ROUNDOFF || (Math.abs(y) <= AXIS_ROUNDOFF && x < 0)));
  // + 0 turns −0 into 0.
  return flip ? { normal: [-x + 0, -y + 0, -z + 0], offset: -offset } : { normal: [x + 0, y + 0, z + 0], offset };
}

/** The positions of a section's planes along its measured normal, the first and the second, in percent of the extent. */
export function boxPlanePercents(vertices: BoxVertices, spec: BoxSectionSpec) {
  const plane = boxPlane(vertices, spec);
  const span = plane.extent.max - plane.extent.min;
  return { first: (100 * (plane.offset - plane.extent.min)) / span, second: spec.secondPositionPercent };
}

/**
 * The section of a cube or parallelepiped by the plane its mode makes, read off the actual solid's faces like any polyhedron's,
 * so that a triangle, a quadrilateral, a pentagon or a hexagon is what it is: a plane through vertices merges the corners it
 * meets. From its second plane, the plane parallel to the first at that percentage of the extent. u points uphill within the
 * plane, or along the plane's +Y for a horizontal one; part A lies on the negative side of the settled normal.
 */
export function boxSection(shape: BoxLikeShape, scale: PhysicalScale, cut: BoxCut): BoxSection {
  const vertices = boxVertices(shape, scale);
  const plane = boxPlane(vertices, cut.box);
  const second = cut.box.secondPositionPercent;
  const own = cut.atSecond === true && second !== undefined ? at(plane.extent, second) : plane.offset;
  const { normal: n, offset } = settled({ normal: plane.normal, offset: own });
  const flipped = n[0] !== plane.normal[0] + 0 || n[1] !== plane.normal[1] + 0 || n[2] !== plane.normal[2] + 0;
  const up: Vec3 = Math.abs(n[2]) > 1 - AXIS_ROUNDOFF ? [0, 1, 0] : [0, 0, 1];
  const u = unit(minus(up, times(n, dot(up, n))));
  const v = cross(u, n);
  const diagonal = Math.max(...pointsOf(vertices).map((point) => length(minus(point, vertices.A))));
  const section = facetedSection(boxPolyhedron(vertices), { n, u, v }, offset, diagonal / 2);
  const other = second === undefined ? undefined : cut.atSecond === true ? plane.offset : at(plane.extent, second);
  const otherOffset = other === undefined ? undefined : flipped ? -other : other;
  return {
    ...section,
    type: 'box-section',
    cutType: cut.box.type,
    ...(otherOffset === undefined
      ? {}
      : { middle: { side: otherOffset > offset ? 'positive' : 'negative', thickness: Math.abs(otherOffset - offset) } }),
  };
}

/**
 * The least distance each part must keep from a plane along its normal, and a middle part between two planes its thickness: the
 * rule of the other solids' cuts, a tenth of the solid's extent along the normal and at least one wall, which excludes cuts that
 * only touch a face, an edge or a vertex and slivers; an application restriction that does not make every thin part printable.
 */
export function boxPartMinimumMm(extent: FrameExtent): number {
  return Math.max((SECTION_POSITION_LIMITS.min / 100) * (extent.max - extent.min), CONNECTOR_MIN_WALL_MM);
}

/** How far each part of a single cut reaches from its plane, and what each must reach; see `boxPartMinimumMm`. */
export function boxSplitReach(shape: BoxLikeShape, scale: PhysicalScale, cut: BoxCut) {
  const vertices = boxVertices(shape, scale);
  const plane = boxPlane(vertices, cut.box);
  const own =
    cut.atSecond === true && cut.box.secondPositionPercent !== undefined
      ? at(plane.extent, cut.box.secondPositionPercent)
      : plane.offset;
  return { valueMm: Math.min(own - plane.extent.min, plane.extent.max - own), minimumMm: boxPartMinimumMm(plane.extent) };
}

/**
 * The faces whose planes are parallel, by representative: a plane parallel to a face is parallel to every face of its group, so
 * one face of each group gives every such plane. The bases are always parallel. Lateral faces XYY1X1 all hold the lateral
 * direction, and two of them are parallel exactly when their base edges are, a pair of opposite edges of a parallelogram, a
 * trapezoid's bases or a regular polygon with an even number of sides; their edges are compared in the base, not by face
 * normals, which a strong lean makes nearly parallel without making them so. The representative is the first face of its group
 * in the faces' order: the lower base, then lateral faces from AB on.
 */
export function boxFaceOrientations(vertices: BoxVertices): Readonly<Record<BoxFace, BoxFace>> {
  const topology = topologyOf(vertices);
  const representatives: Record<BoxFace, BoxFace> = {
    [topology.lowerBase]: topology.lowerBase,
    [topology.upperBase]: topology.lowerBase,
  };
  const laterals = topology.faceNames.slice(2);
  const edgeOf = (face: BoxFace) => {
    const [first, second] = cornersOf(topology, face);
    return minus(vertices[second as BoxVertex], vertices[first as BoxVertex]);
  };
  for (const face of laterals) {
    const edge = edgeOf(face);
    const parallel = laterals.find((other) => {
      if (representatives[other] !== other) return false;
      const otherEdge = edgeOf(other);
      return Math.abs(edge[0] * otherEdge[1] - edge[1] * otherEdge[0]) <= COLLINEAR_RELATIVE * length(edge) * length(otherEdge);
    });
    representatives[face] = parallel ?? face;
  }
  return representatives;
}

/** One face of each group of parallel faces, in the faces' order; see `boxFaceOrientations`. */
export const boxParallelFaces = (vertices: BoxVertices): BoxFace[] => {
  const representatives = boxFaceOrientations(vertices);
  return topologyOf(vertices).faceNames.filter((face) => representatives[face] === face);
};

/**
 * The position from another face of the same plane parallel to a face, read through the plane itself: n·x = d measured from
 * the face becomes n'·x = d' measured from the other one, with n' = ±n and d' = ±d, and its percentage of that face's extent.
 * From the opposite face, n' = −n, so a position p becomes 100 − p.
 */
export function boxFaceParallelPercent(
  shape: BoxLikeShape,
  scale: PhysicalScale,
  from: BoxFace,
  percent: number,
  to: BoxFace,
): number {
  const vertices = boxVertices(shape, scale);
  const plane = boxPlane(vertices, { type: 'face-parallel', face: from, positionPercent: percent });
  const target = boxPlane(vertices, { type: 'face-parallel', face: to, positionPercent: 0 });
  const offset = Math.sign(dot(plane.normal, target.normal)) * plane.offset;
  return (100 * (offset - target.extent.min)) / (target.extent.max - target.extent.min);
}

/** Whether a face holds the segment as an edge or a diagonal; the faces a segment belongs to. */
export const facesOfSegment = (topology: PrismTopology, [first, second]: readonly [BoxVertex, BoxVertex]): BoxFace[] =>
  topology.faceNames.filter((face) => {
    const corners = cornersOf(topology, face);
    return corners.includes(first) && corners.includes(second);
  });

/**
 * The angles about a face's edge or diagonal at which the plane leaves both parts usable by the rule: from the face's own
 * plane, 0°, the plane turns into the solid until it leaves it, at the dihedral angle of the adjacent face for an edge, or at
 * 180° for a diagonal; null when none does. Each vertex's distance from the plane at θ is cos θ·a + sin θ·b, so the parts'
 * reach is read off the eight vertices directly. The usable angles are one interval, as the thinner part grows and then
 * shrinks: its best angle is found on a fine grid and refined between the neighbouring samples, so that a narrow interval is
 * not missed between them, and its ends are refined by bisection, to a thousandth of a degree.
 */
export function boxLineAngleBounds(
  shape: BoxLikeShape,
  scale: PhysicalScale,
  face: BoxFace,
  line: readonly [BoxVertex, BoxVertex],
  rule: BoxPartRule = 'printed',
): FrameExtent | null {
  return lineAngleBounds(boxVertices(shape, scale), face, line, rule);
}

function lineAngleBounds(
  vertices: BoxVertices,
  face: BoxFace,
  line: readonly [BoxVertex, BoxVertex],
  rule: BoxPartRule,
): FrameExtent | null {
  const frame = lineFrame(vertices, face, line);
  const cosine = cross(frame.along, frame.within);
  const sine = times(cross(frame.along, frame.outward), -1);
  const offsets = pointsOf(vertices).map((point) => minus(point, frame.p));
  const [a, b] = [offsets.map((offset) => dot(cosine, offset)), offsets.map((offset) => dot(sine, offset))];
  const margin = (angleDeg: number) => {
    const [cos, sin] = cosSinDeg(angleDeg);
    const along = a.map((value, index) => cos * value + sin * (b[index] as number));
    const extent = { min: Math.min(...along), max: Math.max(...along) };
    return Math.min(-extent.min, extent.max) - partMinimum(rule, extent);
  };
  const step = 0.5;
  let best = { angle: step, margin: margin(step) };
  for (let angle = 2 * step; angle < 180; angle += step) {
    const value = margin(angle);
    if (value > best.margin) best = { angle, margin: value };
  }
  if (best.margin < 0) best = goldenMaximum(margin, Math.max(best.angle - step, 0), Math.min(best.angle + step, 180));
  if (best.margin < 0) return null;
  const refine = (inside: number, outside: number) => {
    let [good, bad] = [inside, outside];
    while (Math.abs(good - bad) > ANGLE_PRECISION_DEG) {
      const middle = (good + bad) / 2;
      if (margin(middle) >= 0) good = middle;
      else bad = middle;
    }
    return good;
  };
  const edge = (direction: -1 | 1) => {
    let inside = best.angle;
    for (let next = inside + direction * step; next > 0 && next < 180; next += direction * step) {
      if (margin(next) < 0) return refine(inside, next);
      inside = next;
    }
    return refine(inside, direction < 0 ? 0 : 180);
  };
  return { min: edge(-1), max: edge(1) };
}

const ANGLE_PRECISION_DEG = 1e-3;

/** The largest value of a function on an interval where it has a single maximum, by golden-section search. */
function goldenMaximum(value: (x: number) => number, low: number, high: number): { angle: number; margin: number } {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let [a, b] = [low, high];
  while (b - a > ANGLE_PRECISION_DEG) {
    const [left, right] = [b - ratio * (b - a), a + ratio * (b - a)];
    if (value(left) < value(right)) a = left;
    else b = right;
  }
  const angle = (a + b) / 2;
  return { angle, margin: value(angle) };
}

/** The edges a point of a plane through a face's line may lie on: those that leave the face, the opposite face's first. */
export function boxPointEdges(topology: PrismTopology, face: BoxFace): BoxSegment[] {
  const corners = cornersOf(topology, face);
  const inFace = (vertex: BoxVertex) => corners.includes(vertex);
  const off = topology.edges.filter(([first, second]) => !inFace(first) || !inFace(second));
  return [
    ...off.filter(([first, second]) => !inFace(first) && !inFace(second)),
    ...off.filter(([first, second]) => inFace(first) !== inFace(second)),
  ].map(([first, second]) => [first, second] as BoxSegment);
}

/**
 * The edges and the diagonals of a face, edges first in the order around it, then the diagonals from each corner in turn: a
 * triangle has none, a quadrilateral two, a hexagon nine.
 */
export function boxFaceLines(topology: PrismTopology, face: BoxFace): BoxSegment[] {
  const corners = cornersOf(topology, face);
  const edges = corners.map((corner, index): BoxSegment => [corner, corners[(index + 1) % corners.length] as BoxVertex]);
  const diagonals = corners.flatMap((corner, index) =>
    corners.slice(index + 2, index === 0 ? corners.length - 1 : corners.length).map((other): BoxSegment => [corner, other]),
  );
  return [...edges, ...diagonals];
}

/**
 * The positions of a point on an edge, in percent from its first vertex, at which the plane through a face's line and that
 * point leaves both parts usable by the rule; an end is open where the point lies on the line, which fixes no plane there.
 */
export interface BoxPointRange {
  readonly min: number;
  readonly max: number;
  readonly minOpen: boolean;
  readonly maxOpen: boolean;
}

/**
 * The usable positions of the point, or null when there are none. Every plane through the line is one of its angles; as the
 * point runs along a straight edge, the angle of the plane through it changes monotonically, or not at all where the edge
 * meets the line, so the usable points are where the angle lies within `boxLineAngleBounds`, one interval. Its ends are where
 * the planes at the bounding angles meet the edge, t = n·(P − E₀) / n·(E₁ − E₀), or the edge's own ends.
 */
export function boxPointRange(
  shape: BoxLikeShape,
  scale: PhysicalScale,
  face: BoxFace,
  line: readonly [BoxVertex, BoxVertex],
  edge: BoxSegment,
  rule: BoxPartRule = 'printed',
): BoxPointRange | null {
  const vertices = boxVertices(shape, scale);
  return pointRange(vertices, face, line, edge, lineAngleBounds(vertices, face, line, rule));
}

function pointRange(
  vertices: BoxVertices,
  face: BoxFace,
  line: readonly [BoxVertex, BoxVertex],
  edge: BoxSegment,
  bounds: FrameExtent | null,
): BoxPointRange | null {
  if (bounds === null) return null;
  const frame = lineFrame(vertices, face, line);
  const [start, end] = [vertices[edge[0]], vertices[edge[1]]];
  const size = Math.max(...pointsOf(vertices).map((point) => length(minus(point, vertices.A))));
  const [first, last] = [angleOfPoint(frame, start, size), angleOfPoint(frame, end, size)];
  const within = (angle: number) => angle >= bounds.min && angle <= bounds.max;
  if (first === undefined || last === undefined) {
    // The edge meets the line at one end: every other point of it fixes the same plane.
    const angle = first ?? last;
    if (angle === undefined || !within(angle)) return null;
    return { min: 0, max: 100, minOpen: first === undefined, maxOpen: last === undefined };
  }
  // An edge parallel to the line lies in one plane through it.
  if (Math.abs(first - last) <= ANGLE_PRECISION_DEG * 1e-3) {
    return within(first) ? { min: 0, max: 100, minOpen: false, maxOpen: false } : null;
  }
  const low = Math.max(bounds.min, Math.min(first, last));
  const high = Math.min(bounds.max, Math.max(first, last));
  if (low > high) return null;
  const direction = minus(end, start);
  const percentAt = (angle: number) => {
    if (angle === first) return 0;
    if (angle === last) return 100;
    const normal = turnedNormal(frame, angle);
    const across = dot(normal, direction);
    // Parallel to the edge, the plane holds all of it, and the angle does not change along it.
    if (Math.abs(across) <= COLLINEAR_RELATIVE * size) return 0;
    return Math.min(Math.max((100 * dot(normal, minus(frame.p, start))) / across, 0), 100);
  };
  const [a, b] = [percentAt(low), percentAt(high)];
  return { min: Math.min(a, b), max: Math.max(a, b), minOpen: false, maxOpen: false };
}

/** Whether a point's position lies in its range, an open end excluded. */
export const inPointRange = (range: BoxPointRange, percent: number, tolerance = 0): boolean =>
  (range.minOpen ? percent > range.min : percent >= range.min - tolerance) &&
  (range.maxOpen ? percent < range.max : percent <= range.max + tolerance);

/** A face's line that some plane through it divides usably, and the edges whose points do so for some position. */
export interface BoxLineChoice {
  readonly line: BoxSegment;
  readonly pointEdges: readonly BoxSegment[];
}

/**
 * The choices of a plane through a line that lead to a usable plane of this solid by the proportional rule, see
 * `BoxPartRule`, face by face in the fields' order: a face with none of its lines left out, a line with no usable angle, an edge
 * no point of which gives a usable plane, such as one in the face adjacent at an edge, all of whose points give that face.
 */
export function boxThroughLineChoices(shape: BoxLikeShape): Readonly<Record<BoxFace, readonly BoxLineChoice[]>> {
  // The proportional rule does not depend on the scale.
  const vertices = boxVertices(shape, { longestDimensionMm: 100 });
  const topology = topologyOf(vertices);
  return Object.fromEntries(
    topology.faceNames.map((face) => [
      face,
      boxFaceLines(topology, face).flatMap((line) => {
        const bounds = lineAngleBounds(vertices, face, line, 'proportional');
        if (bounds === null) return [];
        const pointEdges = boxPointEdges(topology, face).filter(
          (edge) => pointRange(vertices, face, line, edge, bounds) !== null,
        );
        return [{ line, pointEdges }];
      }),
    ]),
  );
}

/** The lines of a triangular base through a vertex. */
export type BoxVertexTrace = 'median' | 'height' | 'bisector';

/**
 * The longitudinal planes through a line of the base that leave both parts usable by the proportional rule, see `BoxPartRule`:
 * the base's diagonals; for a triangle, the vertices whose median, altitude or bisector does so, and the sides whose midline
 * does. An altitude from a vertex at whose neighbour the triangle is obtuse leaves it, and its plane only touches the solid
 * along a lateral edge. `sameLines` names, per vertex, the lines from it that coincide, all three in an equilateral triangle.
 */
export interface BoxTraceChoices {
  readonly diagonal: readonly BoxSegment[];
  readonly median: readonly BoxVertex[];
  readonly height: readonly BoxVertex[];
  readonly bisector: readonly BoxVertex[];
  readonly midline: readonly BoxSegment[];
  readonly sameLines: Readonly<Partial<Record<BoxVertex, readonly BoxVertexTrace[]>>>;
}

export function boxTraceChoices(shape: BoxLikeShape): BoxTraceChoices {
  const vertices = boxVertices(shape, { longestDimensionMm: 100 });
  const topology = topologyOf(vertices);
  const usable = (spec: Extract<BoxSectionSpec, { type: 'longitudinal' }>) => {
    const plane = boxPlane(vertices, spec);
    const reach = Math.min(plane.offset - plane.extent.min, plane.extent.max - plane.offset);
    return reach >= partMinimum('proportional', plane.extent);
  };
  const through = (fields: Partial<Extract<BoxSectionSpec, { type: 'longitudinal' }>>) =>
    usable({ type: 'longitudinal', trace: 'angle', traceAngleDeg: 0, positionPercent: 50, through: true, ...fields });
  const lines = boxFaceLines(topology, topology.lowerBase);
  const diagonal = lines.filter((line) => boxFaceSegmentKind(topology, topology.lowerBase, line) === 'diagonal');
  if (topology.sides !== 3) {
    return {
      diagonal: diagonal.filter((segment) => through({ trace: 'diagonal', traceSegment: segment })),
      median: [],
      height: [],
      bisector: [],
      midline: [],
      sameLines: {},
    };
  }
  const corners = cornersOf(topology, topology.lowerBase);
  const kinds: readonly BoxVertexTrace[] = ['median', 'height', 'bisector'];
  const byKind = (kind: BoxVertexTrace) => corners.filter((vertex) => through({ trace: kind, traceVertex: vertex }));
  const sameLines = Object.fromEntries(
    corners.map((vertex) => {
      const directions = kinds.map((kind) => {
        const line = boxTraceLine(vertices, {
          type: 'longitudinal',
          trace: kind,
          traceAngleDeg: 0,
          positionPercent: 50,
          traceVertex: vertex,
        });
        return unit((line as { direction: Vec3 }).direction);
      });
      const same = kinds.filter((_, index) =>
        directions.some(
          (other, otherIndex) =>
            otherIndex !== index && length(cross(directions[index] as Vec3, other)) <= COLLINEAR_RELATIVE * 1e3,
        ),
      );
      return [vertex, same];
    }),
  );
  return {
    diagonal: [],
    median: byKind('median'),
    height: byKind('height'),
    bisector: byKind('bisector'),
    midline: lines.filter((side) => through({ trace: 'midline', traceSegment: side })),
    sameLines,
  };
}
