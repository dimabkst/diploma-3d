import type { Vec2 as KernelVec2, Manifold } from 'manifold-3d';
import { type ConePlateSection, type FrameExtent, frameMatrix, type SectionFrame } from './connectors/frame.ts';
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
  /** The outline's extent along the frame's u and v from its origin: the slab's own extent grown by the margin. */
  readonly outline: { readonly u: FrameExtent; readonly v: FrameExtent };
}

export function sectionPlateGeometry(section: ConePlateSection): SectionPlateGeometry {
  const { margin, slab } = section;
  const grown = ({ min, max }: FrameExtent): FrameExtent => ({ min: min - margin, max: max + margin });
  return {
    thickness: 2 * section.halfThickness,
    margin,
    cornerRadius: Math.min(PLATE_CORNER_RADIUS_MM, margin),
    frame: section.frame,
    outline: { u: grown(slab.u), v: grown(slab.v) },
  };
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

/** The plate as a solid in the model's millimetres; tracked. */
export function buildSectionPlate(kernel: GeometryKernel, track: Track, plate: SectionPlateGeometry): Manifold {
  const { origin, n } = plate.frame;
  const half = plate.thickness / 2;
  const bottom: Vec3 = [origin[0] - half * n[0], origin[1] - half * n[1], origin[2] - half * n[2]];
  const local = track(kernel.Manifold.extrude(plateOutline(plate), plate.thickness));
  return track(local.transform(frameMatrix(plate.frame, bottom)));
}
