import type { Shape } from '@diploma-3d/schema';
import { cross, dot, length, subtract, type Vec3 } from '../mesh.ts';
import { boxProportions } from './box.ts';
import { parallelepipedProportions } from './parallelepiped.ts';
import type { Vec2 } from './polygon.ts';
import { prismShapeProportions } from './prism.ts';
import { pyramidShapeProportions } from './pyramid.ts';
import { regularPolygonVertices } from './regular-polygon.ts';

/**
 * Exported vertices are float32: in the mesh, in the GLB preview and, at nine significant digits, in the 3MF text. Each
 * coordinate is rounded by up to half a unit in its last place, 2⁻²⁴ of its magnitude; the uniform scale to
 * millimetres does not change this relative error.
 */
const FLOAT32_ROUNDING = 2 ** -24;

/**
 * The largest change that this rounding may cause in a solid's thinnest dimension, relative to that dimension. A very
 * flat lean makes a solid a thin slab far from the origin; past this limit the exported mesh may still be closed and
 * valid while its thickness and volume visibly differ from the requested solid, so the model is rejected rather than
 * silently altered. The limit is relative, so it does not depend on the export size, and 0,1 % keeps the volume of
 * every accepted solid within that of the requested one by about as much.
 */
export const MAX_RELATIVE_ROUNDING = 1e-3;

/**
 * Segments of the unit circle that stand in for the base of a cylinder or cone in this estimate. Their actual count
 * depends on the physical radius, but the thinnest dimension of the convex solid barely does.
 */
const CIRCLE_SAMPLES = 64;
const unitCircle = regularPolygonVertices(CIRCLE_SAMPLES, 2 * Math.sin(Math.PI / CIRCLE_SAMPLES));

/**
 * A convex solid, as the points that span it and the face normals along which it may be thinnest: the normal of the
 * bases and those of the lateral faces over every base edge.
 */
type ConvexOutline = { readonly points: readonly Vec3[]; readonly normals: readonly Vec3[] };

/** The polygon in z = 0 and its copy displaced by `offset` at z = height; lateral faces span an edge and that offset. */
function prismOutline(base: readonly Vec2[], height: number, [dx, dy]: Vec2): ConvexOutline {
  const lateral: Vec3 = [dx, dy, height];
  return {
    points: base.flatMap(([x, y]): Vec3[] => [
      [x, y, 0],
      [x + dx, y + dy, height],
    ]),
    normals: [[0, 0, 1], ...edges(base).map((edge) => cross(edge, lateral))],
  };
}

/** The polygon in z = 0 and the apex above its plane; each lateral face spans an edge and the apex. */
function pyramidOutline(base: readonly Vec2[], height: number, [ax, ay]: Vec2): ConvexOutline {
  const apex: Vec3 = [ax, ay, height];
  return {
    points: [apex, ...base.map(([x, y]): Vec3 => [x, y, 0])],
    normals: [
      [0, 0, 1],
      ...edges(base).map((edge, index) => {
        const [x, y] = base[index] as Vec2;
        return cross(edge, subtract(apex, [x, y, 0]));
      }),
    ],
  };
}

const edges = (base: readonly Vec2[]): Vec3[] =>
  base.map(([x, y], index) => {
    const [nextX, nextY] = base[(index + 1) % base.length] as Vec2;
    return [nextX - x, nextY - y, 0];
  });

/** The outline of every shape whose proportions are not fixed, in the coordinates the engine builds it in. */
function outlineOf(shape: Shape): ConvexOutline | undefined {
  switch (shape.kind) {
    case 'cuboid': {
      const [width, depth, height] = boxProportions(shape);
      return prismOutline(
        [
          [0, 0],
          [width, 0],
          [width, depth],
          [0, depth],
        ],
        height,
        [0, 0],
      );
    }
    case 'parallelepiped': {
      const { base, height, offset } = parallelepipedProportions(shape);
      return prismOutline(base, height, offset);
    }
    case 'prism': {
      const { base, height, offset } = prismShapeProportions(shape);
      return prismOutline(base, height, offset);
    }
    case 'pyramid': {
      const { base, height, apex } = pyramidShapeProportions(shape);
      return pyramidOutline(base, height, apex);
    }
    case 'cylinder':
      return prismOutline(unitCircle, shape.heightRatio, [shape.offsetRatio, 0]);
    case 'cone':
      return pyramidOutline(unitCircle, shape.heightRatio, [shape.offsetRatio, 0]);
    // Fixed proportions, far from any numerical limit.
    case 'cube':
    case 'tetrahedron':
    case 'octahedron':
    case 'icosahedron':
    case 'dodecahedron':
    case 'ball':
      return undefined;
  }
}

/**
 * The largest relative change of the solid's width that float32 rounding may cause, over the directions in which it may
 * be thinnest. Along a unit direction n the width is the spread of the points' projections, and rounding each coordinate
 * by 2⁻²⁴ of the largest magnitude Mᵢ on its axis moves a projection by at most 2⁻²⁴·Σ|nᵢ|·Mᵢ. Because the bound is
 * taken per axis, a slab that is thin mostly along Z, whose Z coordinates are small and precise, is judged by them
 * rather than by its long X or Y extent. Infinite when any value is not finite.
 */
function relativeRoundingError(outline: ConvexOutline): number {
  const magnitudes = [0, 1, 2].map((axis) => Math.max(...outline.points.map((point) => Math.abs(point[axis] as number))));
  let worst = 0;
  for (const normal of outline.normals) {
    const norm = length(normal);
    const projections = outline.points.map((point) => dot(point, normal) / norm);
    const width = Math.max(...projections) - Math.min(...projections);
    const error =
      FLOAT32_ROUNDING *
      normal.reduce((sum, component, axis) => sum + Math.abs(component / norm) * (magnitudes[axis] as number), 0);
    const ratio = error / width;
    if (!Number.isFinite(ratio)) return Number.POSITIVE_INFINITY;
    worst = Math.max(worst, ratio);
  }
  return worst;
}

export type NumericalFeasibility = {
  readonly feasible: boolean;
  /** The bound on the relative change of the thinnest dimension; 0 for solids with fixed proportions. */
  readonly relativeRounding: number;
};

/**
 * Whether the engine can represent the solid reliably: every coordinate finite and float32 rounding of the exported
 * vertices changing its thinnest dimension by at most MAX_RELATIVE_ROUNDING. The parameter domain, with its ratio and
 * offset limits and the minimum inclination, stays thousands of times inside this limit; the check guards the engine
 * against specifications from elsewhere. It says nothing about printability, which depends on the physical size, the
 * printer and the material.
 */
export function checkNumericalFeasibility(shape: Shape): NumericalFeasibility {
  const outline = outlineOf(shape);
  if (outline === undefined) return { feasible: true, relativeRounding: 0 };
  const relativeRounding = relativeRoundingError(outline);
  return { feasible: relativeRounding <= MAX_RELATIVE_ROUNDING, relativeRounding };
}
