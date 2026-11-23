import type { ParallelSection } from '@diploma-3d/schema';
import type { Box, Manifold } from 'manifold-3d';
import { GeometryError } from './errors.ts';
import type { Vec3 } from './mesh.ts';
import type { Track } from './scope.ts';

/** The plane of the points p with normal·p = offset; the normal has unit length. */
export interface Plane {
  readonly normal: Vec3;
  readonly offset: number;
}

/** The two parts of a split solid: on the side the plane's normal points to, and on the opposite side. */
export interface SplitParts {
  readonly positive: Manifold;
  readonly negative: Manifold;
}

/**
 * Splits the solid along the plane into two closed solids. Each part is capped where the plane cut it, and both caps
 * share the same cut boundary; the plane has no thickness, so nothing is removed between the parts. manifold-3d returns
 * the part on the normal's side first. Both parts are tracked, and a part that is missing or invalid, as when the plane
 * misses the solid, is an error.
 */
export function splitByPlane(track: Track, solid: Manifold, plane: Plane): SplitParts {
  const [positive, negative] = solid.splitByPlane(plane.normal, plane.offset).map(track);
  for (const part of [positive, negative]) {
    if (part === undefined || part.status() !== 'NoError' || part.isEmpty()) {
      throw new GeometryError(`The plane does not split the solid into two parts (${part?.status() ?? 'missing'}).`);
    }
  }
  return { positive: positive as Manifold, negative: negative as Manifold };
}

/** The three regions of a solid between two parallel planes, from the negative side of the normal to the positive one. */
export interface ParallelParts {
  readonly lower: Manifold;
  readonly middle: Manifold;
  readonly upper: Manifold;
}

/**
 * Splits a solid by two parallel planes n·x = low and n·x = high, low < high, with the shared unit normal n: the solid is cut
 * at the lower plane and the rest at the upper one, so that each region is made once from the solid and no material is
 * duplicated; every cut face is closed. Throws where a plane misses the solid's interior or the planes do not leave a
 * nonempty middle region.
 */
export function splitByParallelPlanes(
  track: Track,
  solid: Manifold,
  normal: Plane['normal'],
  [low, high]: readonly [number, number],
): ParallelParts {
  if (!(low < high)) throw new GeometryError(`The parallel planes at ${low} and ${high} leave no region between them.`);
  const below = splitByPlane(track, solid, { normal, offset: low });
  const above = splitByPlane(track, below.positive, { normal, offset: high });
  return { lower: below.negative, middle: above.negative, upper: above.positive };
}

/**
 * The cutting plane of a section of a solid with horizontal bases in z = zBottom and z = zBottom + h, where h is the
 * perpendicular distance between them: z = zBottom + t·h with normal +Z. It stays parallel to the bases when the solid
 * leans, so it is not perpendicular to an oblique cylinder's axis; there, every horizontal section is the base circle
 * moved by t times the upper base's displacement.
 */
export function sectionPlane(section: ParallelSection, bounds: Box): Plane {
  const [, , zBottom] = bounds.min;
  const height = bounds.max[2] - zBottom;
  return { normal: [0, 0, 1], offset: zBottom + (section.positionPercent / 100) * height };
}
