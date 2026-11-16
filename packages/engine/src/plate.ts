import type { Vec2 as KernelVec2, Manifold } from 'manifold-3d';
import {
  CONSTRAINT_ROUNDOFF_MM,
  type ConePlateSection,
  type FrameExtent,
  frameMatrix,
  framePoint,
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
}

export function sectionPlateGeometry(section: ConePlateSection): SectionPlateGeometry {
  const { margin, slab, standingLevel } = section;
  const grown = ({ min, max }: FrameExtent): FrameExtent => ({ min: min - margin, max: max + margin });
  const unclipped = {
    thickness: 2 * section.halfThickness,
    margin,
    cornerRadius: Math.min(PLATE_CORNER_RADIUS_MM, margin),
    frame: section.frame,
    outline: { u: grown(slab.u), v: grown(slab.v) },
  };
  const corners = prismCorners(unclipped);
  const clippedAtBase = Math.min(...corners.map((corner) => corner[2])) < standingLevel - CONSTRAINT_ROUNDOFF_MM;
  return {
    ...unclipped,
    standingLevel,
    clippedAtBase,
    extent: clippedAtBase ? clippedExtent(unclipped, corners, standingLevel) : unclipped.outline,
  };
}

/**
 * The extruded outline's corners in the model's millimetres: the polygon at both faces, −T/2 and T/2 along n. The plate is
 * their convex hull, as the outline is convex, so these bound everything it reaches.
 */
function prismCorners(plate: Omit<SectionPlateGeometry, 'standingLevel' | 'clippedAtBase' | 'extent'>): Vec3[] {
  const half = plate.thickness / 2;
  return [-half, half].flatMap((normal) =>
    plateOutline(plate as SectionPlateGeometry).map(([across, along]) => framePoint(plate.frame, [along, across, normal])),
  );
}

/**
 * The extent along u and v of the convex plate cut by z ≥ level: of its corners that remain and of the points where its
 * edges cross the plane, at either face along the outline and between the faces.
 */
function clippedExtent(
  plate: Omit<SectionPlateGeometry, 'standingLevel' | 'clippedAtBase' | 'extent'>,
  corners: readonly Vec3[],
  level: number,
): { readonly u: FrameExtent; readonly v: FrameExtent } {
  const count = corners.length / 2;
  const edges: [Vec3, Vec3][] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    edges.push(
      [corners[index] as Vec3, corners[next] as Vec3],
      [corners[count + index] as Vec3, corners[count + next] as Vec3],
      [corners[index] as Vec3, corners[count + index] as Vec3],
    );
  }
  const kept = corners.filter((corner) => corner[2] >= level);
  for (const [a, b] of edges) {
    if (a[2] < level === b[2] < level) continue;
    const share = (level - a[2]) / (b[2] - a[2]);
    kept.push([a[0] + share * (b[0] - a[0]), a[1] + share * (b[1] - a[1]), level]);
  }
  const { origin, u, v } = plate.frame;
  const extentAlong = (axis: Vec3): FrameExtent => {
    const values = kept.map(
      (point) => (point[0] - origin[0]) * axis[0] + (point[1] - origin[1]) * axis[1] + (point[2] - origin[2]) * axis[2],
    );
    return { min: Math.min(...values), max: Math.max(...values) };
  };
  return { u: extentAlong(u), v: extentAlong(v) };
}

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
 * plane, its whole volume is cut by z ≥ that level, which leaves a flat face on the plane; it is not moved.
 */
export function buildSectionPlate(kernel: GeometryKernel, track: Track, plate: SectionPlateGeometry): Manifold {
  const { origin, n } = plate.frame;
  const half = plate.thickness / 2;
  const bottom: Vec3 = [origin[0] - half * n[0], origin[1] - half * n[1], origin[2] - half * n[2]];
  const local = track(kernel.Manifold.extrude(plateOutline(plate), plate.thickness));
  const placed = track(local.transform(frameMatrix(plate.frame, bottom)));
  return plate.clippedAtBase ? track(placed.trimByPlane([0, 0, 1], plate.standingLevel)) : placed;
}
