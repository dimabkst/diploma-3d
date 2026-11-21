import type { Vec2 as KernelVec2, Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import {
  CONSTRAINT_ROUNDOFF_MM,
  type FrameExtent,
  frameMatrix,
  framePoint,
  type PlateSection,
  type SectionFrame,
} from './connectors/frame.ts';
import type { GeometryKernel } from './kernel.ts';
import type { Vec3 } from './mesh.ts';
import type { Track } from './scope.ts';
import { circularSegments } from './shapes/round.ts';

/**
 * The plate's corner radius, at most its margin: the rounded corner of a rectangle grown by m around a box then lies at
 * least m from the box, since a box corner sits (m − ρ)·√2 inside the arc's centre and ρ + (m − ρ)·√2 ≥ m. The inscribed
 * arc's polygon gives up at most MAX_CIRCLE_DEVIATION_MM of that.
 */
export const PLATE_CORNER_RADIUS_MM = 2;

/** A section plate as built and recorded: a rounded rectangle in the cut's middle frame, T/2 to either side of it. */
export interface SectionPlateGeometry {
  readonly thickness: number;
  readonly margin: number;
  readonly cornerRadius: number;
  /** The cut's middle frame; the plate lies between −T/2 and T/2 along its n. */
  readonly frame: SectionFrame;
  /**
   * The outline's extent along the frame's u and v from its origin, as requested: the slab's own extent grown by the margin.
   * The plate is this outline, extruded, before the standing plane cuts it.
   */
  readonly outline: { readonly u: FrameExtent; readonly v: FrameExtent };
  /** The height of the plane the uncut solid stands on; the plate never reaches below it. */
  readonly standingLevel: number;
  /**
   * Whether the extruded outline would reach below the standing plane, which then cuts it off flat: the margin there is
   * smaller or none, everywhere else as requested. The solid stands on that plane, so the cut only takes plate outside it.
   */
  readonly clippedAtBase: boolean;
  /** The plate's actual extent along u and v from the origin, after that cut; the outline's own where nothing is cut. */
  readonly extent: { readonly u: FrameExtent; readonly v: FrameExtent };
  /**
   * Where the standing plane cuts the plate: the radius that rounds the two corners the cut makes at the ends of its flat
   * contact, the plate's own corner radius unless that would leave less than half of the contact flat; zero leaves them
   * sharp. Absent where nothing is cut.
   */
  readonly baseCornerRadius?: number;
}

type UnclippedPlate = Omit<SectionPlateGeometry, 'standingLevel' | 'clippedAtBase' | 'extent' | 'baseCornerRadius'>;

export function sectionPlateGeometry(section: PlateSection): SectionPlateGeometry {
  const { margin, slab, standingLevel } = section;
  const grown = ({ min, max }: FrameExtent): FrameExtent => ({ min: min - margin, max: max + margin });
  const unclipped: UnclippedPlate = {
    thickness: 2 * section.halfThickness,
    margin,
    cornerRadius: Math.min(PLATE_CORNER_RADIUS_MM, margin),
    frame: section.frame,
    outline: { u: grown(slab.u), v: grown(slab.v) },
  };
  const corners = prismCorners(unclipped);
  const clippedAtBase = Math.min(...corners.map((corner) => corner[2])) < standingLevel - CONSTRAINT_ROUNDOFF_MM;
  if (!clippedAtBase) return { ...unclipped, standingLevel, clippedAtBase, extent: unclipped.outline };
  const baseCornerRadius = baseCornerRadiusOf(unclipped, standingLevel);
  const points = openedPlate(unclipped, standingLevel, baseCornerRadius).map(({ point }) => point);
  return { ...unclipped, standingLevel, clippedAtBase, extent: extentOf(points, unclipped.frame), baseCornerRadius };
}

/**
 * The extruded outline's corners in the model's millimetres: the polygon at both faces, −T/2 and T/2 along n. The plate is
 * their convex hull, as the outline is convex, so these bound everything it reaches.
 */
function prismCorners(plate: UnclippedPlate): Vec3[] {
  const half = plate.thickness / 2;
  return [-half, half].flatMap((normal) =>
    plateOutline(plate as SectionPlateGeometry).map(([across, along]) => framePoint(plate.frame, [along, across, normal])),
  );
}

/** The extent along the frame's u and v of the points, from its origin. */
function extentOf(points: readonly Vec3[], { origin, u, v }: SectionFrame): { u: FrameExtent; v: FrameExtent } {
  const along = (axis: Vec3): FrameExtent => {
    const values = points.map(
      (point) => (point[0] - origin[0]) * axis[0] + (point[1] - origin[1]) * axis[1] + (point[2] - origin[2]) * axis[2],
    );
    return { min: Math.min(...values), max: Math.max(...values) };
  };
  return { u: along(u), v: along(v) };
}

/** An interval of directions in the plate's plane, as angles in its local (x, y) = (v, u), lo ≤ hi. */
interface Directions {
  readonly lo: number;
  readonly hi: number;
}

/** A corner of a convex solid with the in-plane directions of its outward normals, projected onto the plate's plane. */
interface Corner {
  readonly point: Vec3;
  readonly normals: Directions;
}

/** The smallest interval holding these directions, all within half a turn of the first. */
function spanOf(angles: readonly number[]): Directions {
  const first = angles[0] as number;
  const unwrapped = angles.map((angle) => first + Math.atan2(Math.sin(angle - first), Math.cos(angle - first)));
  return { lo: Math.min(...unwrapped), hi: Math.max(...unwrapped) };
}

// Far below the step between a polygon's normals, which is a full turn over at most a few hundred sides.
const ANGLE_ROUNDOFF = 1e-12;

/** Whether two intervals of directions share more than a boundary; a single direction counts where it falls. */
function overlap(a: Directions, b: Directions): boolean {
  return [-2 * Math.PI, 0, 2 * Math.PI].some((turn) => {
    const [lo, hi] = [a.lo + turn, a.hi + turn];
    if (hi - lo <= ANGLE_ROUNDOFF) return lo >= b.lo - ANGLE_ROUNDOFF && lo <= b.hi + ANGLE_ROUNDOFF;
    return Math.max(lo, b.lo) < Math.min(hi, b.hi) - ANGLE_ROUNDOFF;
  });
}

/**
 * The outline less `radius` all round, counter-clockwise in local (x, y) = (v, u), each corner with the directions of the
 * edges' normals that meet there: the arcs keep their centres and lose the radius, at the outline's own angles, so that the
 * disc of that radius added back gives exactly the outline's own corners.
 */
function erodedOutline(
  { outline, cornerRadius }: UnclippedPlate,
  radius: number,
): { x: number; y: number; normals: Directions }[] {
  const centres: [number, number][] = [
    [outline.v.max - cornerRadius, outline.u.max - cornerRadius],
    [outline.v.min + cornerRadius, outline.u.max - cornerRadius],
    [outline.v.min + cornerRadius, outline.u.min + cornerRadius],
    [outline.v.max - cornerRadius, outline.u.min + cornerRadius],
  ];
  const left = cornerRadius - radius;
  if (left <= CONSTRAINT_ROUNDOFF_MM) {
    return centres.map(([x, y], turn) => ({ x, y, normals: { lo: (turn * Math.PI) / 2, hi: ((turn + 1) * Math.PI) / 2 } }));
  }
  const quarter = circularSegments(cornerRadius) / 4;
  const half = Math.PI / 4 / quarter;
  return centres.flatMap(([x, y], turn) =>
    Array.from({ length: quarter + 1 }, (_, step) => {
      const angle = ((turn + step / quarter) * Math.PI) / 2;
      return {
        x: x + left * Math.cos(angle),
        y: y + left * Math.sin(angle),
        normals: { lo: step === 0 ? angle : angle - half, hi: step === quarter ? angle : angle + half },
      };
    }),
  );
}

/**
 * The plate as the standing plane cuts it, with the corners that cut makes rounded by `radius`, as the corners of a convex
 * solid with in-plane normals: the clipped prism opened by the disc of that radius in the plate's plane. That is the union of
 * every such disc inside the clipped plate in each plane parallel to its faces, so it only takes material away, and only
 * where no disc fits, at the corners: by the outline's own radius none is lost at its own corners, and the margin, at least
 * that radius, keeps everything within the solid's slab. Being the cut prism eroded and grown back, it is
 * (prism of the eroded outline, cut by the plane lifted by the disc's deepest reach) ⊕ disc, convex, and its corners are
 * the sums of a corner of the first and of the disc whose normals share a direction. The lift makes the disc's lowest point
 * touch the plane exactly, so that the flat contact stays on it, also where no corner of the disc points straight down;
 * it also works across the plate's thickness, where an oblique plate's two faces are cut at different places.
 */
function openedPlate(plate: UnclippedPlate, level: number, radius: number): Corner[] {
  const { origin, u, v, n } = plate.frame;
  const half = plate.thickness / 2;
  // In local (x, y, s), z = origin + x·v_z + y·u_z + s·n_z; the cut's face has its outward normal −Z, in the plane −(v_z, u_z).
  const zAt = (x: number, y: number, s: number) => origin[2] + x * v[2] + y * u[2] + s * n[2];
  const down = Math.atan2(-u[2], -v[2]);
  const count = circularSegments(plate.cornerRadius);
  const disc = Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    return {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      normals: { lo: angle - Math.PI / count, hi: angle + Math.PI / count },
    };
  });
  const lifted = level + Math.max(...disc.map(({ x, y }) => -(x * v[2] + y * u[2])));
  const outline = erodedOutline(plate, radius);
  const corners: { x: number; y: number; s: number; normals: Directions }[] = [];
  for (const s of [-half, half]) {
    outline.forEach((corner, index) => {
      const next = outline[(index + 1) % outline.length] as (typeof outline)[number];
      const [a, b] = [zAt(corner.x, corner.y, s) - lifted, zAt(next.x, next.y, s) - lifted];
      if (a >= 0) corners.push({ ...corner, s });
      if (a >= 0 !== b >= 0) {
        const share = a / (a - b);
        corners.push({
          x: corner.x + share * (next.x - corner.x),
          y: corner.y + share * (next.y - corner.y),
          s,
          normals: spanOf([corner.normals.hi, down]),
        });
      }
    });
  }
  // Where a side edge across the thickness crosses the lifted plane, between the faces.
  for (const corner of outline) {
    const [a, b] = [zAt(corner.x, corner.y, -half) - lifted, zAt(corner.x, corner.y, half) - lifted];
    if (a >= 0 === b >= 0) continue;
    corners.push({
      ...corner,
      s: -half + (a / (a - b)) * 2 * half,
      normals: spanOf([corner.normals.lo, corner.normals.hi, down]),
    });
  }
  return corners.flatMap((corner) =>
    disc
      .filter((offset) => radius === 0 || overlap(corner.normals, offset.normals))
      .map((offset) => ({
        point: framePoint(plate.frame, [corner.y + offset.y, corner.x + offset.x, corner.s]),
        normals: corner.normals,
      })),
  );
}

/**
 * How wide the flat contact on the standing plane is, along the plane's horizontal direction within the plate: the extent of
 * the opened plate's corners on it.
 */
function contactWidth(plate: UnclippedPlate, level: number, radius: number): number {
  const { u, v } = plate.frame;
  const slope = Math.hypot(u[2], v[2]);
  // Horizontal and in the plate's plane: (−u_z, v_z) in local (x, y).
  const across: Vec3 = [(-u[2] * v[0] + v[2] * u[0]) / slope, (-u[2] * v[1] + v[2] * u[1]) / slope, 0];
  const onPlane = openedPlate(plate, level, radius)
    .map(({ point }) => point)
    .filter((point) => point[2] <= level + CONTACT_ROUNDOFF_MM);
  if (onPlane.length === 0) return 0;
  const along = onPlane.map((point) => point[0] * across[0] + point[1] * across[1]);
  return Math.max(...along) - Math.min(...along);
}

// Positions of a model some hundred millimetres across, recomputed from the frame: far below a printed feature.
const CONTACT_ROUNDOFF_MM = 1e-7;

/**
 * The radius for the corners the standing plane cuts: the plate's own corner radius, unless rounding by it would leave less
 * than half the flat contact the cut makes, as where the plane only nicks a corner; then the largest radius that keeps half.
 * Below a twentieth of a millimetre, which no print shows, the corners stay sharp.
 */
function baseCornerRadiusOf(plate: UnclippedPlate, level: number): number {
  const { u, v } = plate.frame;
  if (Math.hypot(u[2], v[2]) <= CONSTRAINT_ROUNDOFF_MM) return plate.cornerRadius;
  const needed = contactWidth(plate, level, 0) / 2;
  const keeps = (radius: number) => contactWidth(plate, level, radius) >= needed;
  if (keeps(plate.cornerRadius)) return plate.cornerRadius;
  let [low, high] = [0, plate.cornerRadius];
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (keeps(middle)) low = middle;
    else high = middle;
  }
  return low < MIN_BASE_CORNER_RADIUS_MM ? 0 : low;
}

const MIN_BASE_CORNER_RADIUS_MM = 0.05;

/** The outline counter-clockwise in the frame's local (x, y) = (v, u), each corner an inscribed quarter circle. */
export function plateOutline({ outline, cornerRadius: radius }: SectionPlateGeometry): KernelVec2[] {
  const quarter = circularSegments(radius) / 4;
  const corners: [number, number, number][] = [
    [outline.v.max - radius, outline.u.max - radius, 0],
    [outline.v.min + radius, outline.u.max - radius, 1],
    [outline.v.min + radius, outline.u.min + radius, 2],
    [outline.v.max - radius, outline.u.min + radius, 3],
  ];
  return corners.flatMap(([x, y, turn]) =>
    Array.from({ length: quarter + 1 }, (_, step): KernelVec2 => {
      const angle = ((turn + step / quarter) * Math.PI) / 2;
      return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
    }),
  );
}

/**
 * The plate as a solid in the model's millimetres, in the assembled position; tracked. Where it would reach below the standing
 * plane, its whole volume is cut by z ≥ that level, which leaves a flat face on the plane; it is not moved. The two corners that
 * cut makes are rounded across the whole thickness, see `openedPlate`; the solid is convex, and built as the hull of its
 * corners, none three of which lie on one edge, which manifold-3d's hull can get wrong.
 */
export function buildSectionPlate(kernel: GeometryKernel, track: Track, plate: SectionPlateGeometry): Manifold {
  const { origin, n } = plate.frame;
  const half = plate.thickness / 2;
  if (plate.clippedAtBase && (plate.baseCornerRadius ?? 0) > 0) {
    const corners = openedPlate(plate, plate.standingLevel, plate.baseCornerRadius as number);
    return track(kernel.Manifold.hull(corners.map(({ point }) => [...point] as KernelVec3)));
  }
  const bottom: Vec3 = [origin[0] - half * n[0], origin[1] - half * n[1], origin[2] - half * n[2]];
  const local = track(kernel.Manifold.extrude(plateOutline(plate), plate.thickness));
  const placed = track(local.transform(frameMatrix(plate.frame, bottom)));
  return plate.clippedAtBase ? track(placed.trimByPlane([0, 0, 1], plate.standingLevel)) : placed;
}
